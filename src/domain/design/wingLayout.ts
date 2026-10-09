import { EPS, roundToPrecision } from "../geometry/numeric";
import { OPPOSITE_SIDE, outlineEdges, type EnvelopeSide } from "../geometry/outline";
import { partitionOutline, sharedSide, type FringePiece } from "../geometry/partition";
import type { Ring } from "../geometry/polygons";
import type { Rect } from "../geometry/vector";
import type { RoomType } from "../plan/types";
import type { Program, SpaceSpec } from "./program";
import { ENSUITE_TARGET } from "./roomRules";

/**
 * Plans rooms inside any right-angle outline, as labelled rectangles; no
 * walls yet (the emitter draws walls wherever two labels meet).
 *
 * The outline is split into wings (`partitionOutline`). Every wing gets a
 * hall strip along its length, either beside one long side (single-loaded)
 * or between two bands of rooms (double-loaded); a small wing can instead be
 * one band opening off its parent's hall. Halls of neighbouring wings are
 * joined, through a short connector where they don't already meet, so the
 * hall is one space. Bands are cut into rooms along their length, in
 * proportion to the rooms' target areas, and every room keeps a stretch of
 * hall to open onto. Thin fringe (a bay, the strip beside a notch) joins
 * the room or hall next to it.
 *
 * Coordinates are wall centrelines, metres. Everything here is pure and
 * deterministic.
 */

export const MIN_BAND = 3;
const MAX_BAND = 5.6;
/** Bathrooms, WCs, utility rooms and stores can be shallower than other rooms. */
const SHALLOW = 2;
const MAX_SINGLE = 6.2;
const MAX_OPEN = 7;
const MAX_DEPTH_RATIO = 3;
const MAX_SERVICE_RATIO = 4.5;
const GRID = 0.05;
const snap = (v: number) => roundToPrecision(Math.round(v / GRID) * GRID);

export type WingArrangement = "garden-living" | "quiet-garden" | "living-wing" | "sleeping-wing";

export const WING_ARRANGEMENTS: ReadonlyArray<{ id: WingArrangement; title: string; summary: string }> = [
  { id: "garden-living", title: "Living spaces on the garden side", summary: "Living spaces face the garden; bedrooms sit on the street side." },
  { id: "living-wing", title: "Living wing and sleeping wing", summary: "The main wing holds the living spaces, the other wings the bedrooms." },
  { id: "quiet-garden", title: "Bedrooms on the quiet side", summary: "Bedrooms face the garden; living spaces sit on the street side." },
  { id: "sleeping-wing", title: "Sleeping wing first", summary: "The main wing holds the bedrooms, the other wings the living spaces." },
];

export interface LabeledRoom {
  key: string;
  kind: "hall" | "room" | "ensuite" | "storage";
  name: string;
  type: RoomType;
  target?: number;
  window: SpaceSpec["window"];
  rects: Rect[];
  /** An ensuite's bedroom. */
  of?: string;
}

export interface LayoutPlan {
  /** Stable across requests for the same outline and brief: arrangement, partition and hall choice. */
  id: string;
  arrangement: WingArrangement;
  rooms: LabeledRoom[];
  fringe: FringePiece[];
  notes: string[];
  /** Lower is better. */
  score: number;
}

export interface WingLayoutOptions {
  hallWidth: number;
  /** Widest door, for the stretch of hall each room needs. */
  doorWidth: number;
  rearSide: EnvelopeSide;
  arrangements?: readonly WingArrangement[];
  /** Most hall choices tried per partition. */
  maxCombos?: number;
}

type Axis = "x" | "y";

interface Seg {
  /** A horizontal segment runs along x at y = line. */
  horizontal: boolean;
  line: number;
  lo: number;
  hi: number;
}

interface Wing {
  index: number;
  rect: Rect;
  along: Axis;
  parent: number | null;
  junction: Seg | null;
  children: number[];
}

type HallChoice = { kind: "single" | "double"; lo: number; hi: number } | { kind: "open" };

interface Band {
  wing: number;
  rect: Rect;
  along: Axis;
  /** The side facing the hall. */
  hallSide: EnvelopeSide;
  /** Along-coordinates of the longest stretch of hall on the hall side. */
  contact: [number, number] | null;
  /** Hall at either end of the band. */
  endContact: { lo: boolean; hi: boolean };
  /** Fringe beyond the band's outer side: along-range and extra depth. */
  extra: Array<{ lo: number; hi: number; depth: number }>;
  /** Which way the band's outer side faces, when it is mostly outline. */
  facing: EnvelopeSide | null;
}

const alongOf = (r: Rect, a: Axis): [number, number] => (a === "x" ? [r.minX, r.maxX] : [r.minY, r.maxY]);
const crossOf = (r: Rect, a: Axis): [number, number] => (a === "x" ? [r.minY, r.maxY] : [r.minX, r.maxX]);
const make = (a: Axis, a0: number, a1: number, c0: number, c1: number): Rect =>
  a === "x" ? { minX: a0, maxX: a1, minY: c0, maxY: c1 } : { minX: c0, maxX: c1, minY: a0, maxY: a1 };
/** The side of a rectangle at its low or high cross coordinate. */
const crossSide = (a: Axis, high: boolean): EnvelopeSide => (a === "x" ? (high ? "north" : "south") : high ? "east" : "west");
const area = (r: Rect) => (r.maxX - r.minX) * (r.maxY - r.minY);
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

function sideSeg(r: Rect, side: EnvelopeSide): Seg {
  if (side === "north") return { horizontal: true, line: r.maxY, lo: r.minX, hi: r.maxX };
  if (side === "south") return { horizontal: true, line: r.minY, lo: r.minX, hi: r.maxX };
  if (side === "east") return { horizontal: false, line: r.maxX, lo: r.minY, hi: r.maxY };
  return { horizontal: false, line: r.minX, lo: r.minY, hi: r.maxY };
}

/** The part of `j` that one side of `r` lies along. */
function touch(r: Rect, j: Seg): [number, number] | null {
  const sides: EnvelopeSide[] = j.horizontal ? ["north", "south"] : ["east", "west"];
  for (const side of sides) {
    const s = sideSeg(r, side);
    if (Math.abs(s.line - j.line) > EPS) continue;
    const lo = Math.max(s.lo, j.lo);
    const hi = Math.min(s.hi, j.hi);
    if (hi - lo > EPS) return [lo, hi];
  }
  return null;
}

const within = (inner: Rect, outer: Rect) =>
  inner.minX >= outer.minX - EPS && inner.maxX <= outer.maxX + EPS && inner.minY >= outer.minY - EPS && inner.maxY <= outer.maxY + EPS;

/** A strip of hall from a hall rectangle straight to a junction, over `range` along the junction. */
function connectorTo(hall: Rect, j: Seg, range: [number, number], wing: Rect): Rect | null {
  const [lo, hi] = range;
  let r: Rect;
  if (j.horizontal) {
    if (hall.maxY <= j.line + EPS) r = { minX: lo, maxX: hi, minY: hall.maxY, maxY: j.line };
    else r = { minX: lo, maxX: hi, minY: j.line, maxY: hall.minY };
  } else if (hall.maxX <= j.line + EPS) r = { minX: hall.maxX, maxX: j.line, minY: lo, maxY: hi };
  else r = { minX: j.line, maxX: hall.minX, minY: lo, maxY: hi };
  if (r.maxX - r.minX <= EPS || r.maxY - r.minY <= EPS) return null;
  return within(r, wing) ? r : null;
}

/** A strip of hall along a junction, inside the wing, joining two hall ends that miss each other. */
function jogAlong(j: Seg, range: [number, number], wing: Rect, depth: number): Rect | null {
  const [lo, hi] = range;
  let r: Rect;
  if (j.horizontal) r = Math.abs(wing.maxY - j.line) < EPS ? { minX: lo, maxX: hi, minY: j.line - depth, maxY: j.line } : { minX: lo, maxX: hi, minY: j.line, maxY: j.line + depth };
  else r = Math.abs(wing.maxX - j.line) < EPS ? { minX: j.line - depth, maxX: j.line, minY: lo, maxY: hi } : { minX: j.line, maxX: j.line + depth, minY: lo, maxY: hi };
  return within(r, wing) ? r : null;
}

/** A centred sub-range of `range` no wider than `width`. */
function centred(range: [number, number], width: number): [number, number] {
  const mid = (range[0] + range[1]) / 2;
  if (range[1] - range[0] <= width + EPS) return range;
  return [snap(mid - width / 2), snap(mid - width / 2) + width];
}

/** `r` minus `cut`, as up to four rectangles. */
function subtract(r: Rect, cut: Rect): Rect[] {
  const ox = overlap(r.minX, r.maxX, cut.minX, cut.maxX);
  const oy = overlap(r.minY, r.maxY, cut.minY, cut.maxY);
  if (ox <= EPS || oy <= EPS) return [r];
  const out: Rect[] = [];
  const x0 = Math.max(r.minX, cut.minX);
  const x1 = Math.min(r.maxX, cut.maxX);
  if (cut.minY > r.minY + EPS) out.push({ ...r, maxY: cut.minY });
  if (cut.maxY < r.maxY - EPS) out.push({ ...r, minY: cut.maxY });
  const y0 = Math.max(r.minY, cut.minY);
  const y1 = Math.min(r.maxY, cut.maxY);
  if (x0 > r.minX + EPS) out.push({ minX: r.minX, maxX: x0, minY: y0, maxY: y1 });
  if (x1 < r.maxX - EPS) out.push({ minX: x1, maxX: r.maxX, minY: y0, maxY: y1 });
  return out;
}

function hallChoices(w: Wing, fringe: FringePiece[], h: number, root: boolean): HallChoice[] {
  const [c0, c1] = crossOf(w.rect, w.along);
  const T = c1 - c0;
  const extra = (high: boolean) => {
    const side = crossSide(w.along, high);
    return Math.max(0, ...fringe.filter((f) => f.core === w.index && f.toward === OPPOSITE_SIDE[side]).map((f) => (w.along === "x" ? f.rect.maxY - f.rect.minY : f.rect.maxX - f.rect.minX)));
  };
  const [eLo, eHi] = [extra(false), extra(true)];
  const out: HallChoice[] = [];
  const band = T - h;
  if (band >= SHALLOW - EPS && band <= MAX_SINGLE + EPS) {
    if (band + eHi >= MIN_BAND - EPS) out.push({ kind: "single", lo: c0, hi: snap(c0 + h) });
    if (band + eLo >= MIN_BAND - EPS) out.push({ kind: "single", lo: snap(c1 - h), hi: c1 });
  }
  const depths = new Set<number>();
  for (const a of [snap(band / 2), MIN_BAND, snap(band - MIN_BAND), snap(Math.max(SHALLOW, MIN_BAND - eLo)), snap(band - Math.max(SHALLOW, MIN_BAND - eHi))]) {
    const b = band - a;
    if (a < SHALLOW - EPS || b < SHALLOW - EPS || a + eLo < MIN_BAND - EPS || b + eHi < MIN_BAND - EPS || a > MAX_BAND + EPS || b > MAX_BAND + EPS) continue;
    depths.add(roundToPrecision(a));
  }
  for (const a of [...depths].sort((p, q) => p - q)) out.push({ kind: "double", lo: snap(c0 + a), hi: snap(c0 + a + h) });
  if (!root && w.junction) {
    // A wing one room deep, opening off its parent's hall.
    const depth = w.junction.horizontal ? w.rect.maxY - w.rect.minY : w.rect.maxX - w.rect.minX;
    if (depth >= MIN_BAND - EPS && depth <= MAX_OPEN + EPS) out.push({ kind: "open" });
  }
  return out;
}

/** Wings, rooted at the biggest, each joined to its parent at a junction. */
function wingTree(cores: Rect[]): Wing[] {
  const wings: Wing[] = cores.map((rect, index) => ({
    index,
    rect,
    along: rect.maxX - rect.minX >= rect.maxY - rect.minY - EPS ? "x" : "y",
    parent: null,
    junction: null,
    children: [],
  }));
  const root = wings.reduce((best, w) => (area(w.rect) > area(best.rect) + EPS ? w : best), wings[0]);
  const seen = new Set([root.index]);
  const queue = [root];
  while (queue.length) {
    const p = queue.shift()!;
    const next = wings
      .filter((c) => !seen.has(c.index))
      .map((c) => ({ c, s: sharedSide(p.rect, c.rect) }))
      .filter((x): x is { c: Wing; s: NonNullable<ReturnType<typeof sharedSide>> } => !!x.s)
      .sort((a, b) => b.s.length - a.s.length || a.c.index - b.c.index);
    for (const { c, s } of next) {
      const seg = sideSeg(p.rect, s.side);
      const cs = sideSeg(c.rect, OPPOSITE_SIDE[s.side]);
      c.parent = p.index;
      c.junction = { horizontal: seg.horizontal, line: seg.line, lo: Math.max(seg.lo, cs.lo), hi: Math.min(seg.hi, cs.hi) };
      p.children.push(c.index);
      seen.add(c.index);
      queue.push(c);
    }
  }
  return seen.size === wings.length ? wings.map((w) => (w.index === root.index ? w : w)).sort((a, b) => (a.index === root.index ? -1 : b.index === root.index ? 1 : a.index - b.index)) : [];
}

interface Geometry {
  halls: Rect[];
  bands: Band[];
}

/** Halls joined across every junction, and the bands of rooms left around them; null if they can't be joined. */
function buildGeometry(wings: Wing[], choices: HallChoice[], fringe: FringePiece[], ring: Ring, opts: WingLayoutOptions): Geometry | null {
  const h = opts.hallWidth;
  const byIndex = new Map(wings.map((w, i) => [w.index, i]));
  const choiceOf = (w: Wing) => choices[byIndex.get(w.index)!];
  const strip = new Map<number, Rect>();
  for (const w of wings) {
    const c = choiceOf(w);
    if (c.kind === "open") {
      if (w.children.length) return null;
      continue;
    }
    const [a0, a1] = alongOf(w.rect, w.along);
    strip.set(w.index, make(w.along, a0, a1, c.lo, c.hi));
  }
  const connectors: Rect[] = [];
  for (const c of wings) {
    if (c.parent === null || !c.junction) continue;
    const p = wings.find((w) => w.index === c.parent)!;
    const hp = strip.get(p.index);
    if (!hp) return null;
    const j = c.junction;
    const hc = strip.get(c.index);
    const tp = touch(hp, j);
    if (!hc) {
      // An open wing needs its parent's hall along the junction.
      if (tp && tp[1] - tp[0] >= opts.doorWidth + 0.3 - EPS) continue;
      const k = connectorTo(hp, j, centred([j.lo, j.hi], h), p.rect);
      if (!k) return null;
      connectors.push(k);
      continue;
    }
    const tc = touch(hc, j);
    if (tp && tc && overlap(tp[0], tp[1], tc[0], tc[1]) >= h - EPS) continue;
    if (tc && tp) {
      const k = jogAlong(j, [Math.min(tp[0], tc[0]), Math.max(tp[1], tc[1])], p.rect, h);
      if (!k) return null;
      connectors.push(k);
    } else if (tc) {
      const k = connectorTo(hp, j, centred(tc, h), p.rect);
      if (!k) return null;
      connectors.push(k);
    } else if (tp) {
      const span: [number, number] = [Math.max(tp[0], j.lo), Math.min(tp[1], j.hi)];
      const k = connectorTo(hc, j, centred(span, h), c.rect);
      if (!k) return null;
      connectors.push(k);
    } else {
      const range = centred([j.lo, j.hi], h);
      const k1 = connectorTo(hp, j, range, p.rect);
      const k2 = connectorTo(hc, j, range, c.rect);
      if (!k1 || !k2) return null;
      connectors.push(k1, k2);
    }
  }
  const halls = [...strip.values(), ...connectors];

  // Bands: each wing minus its hall strip, then minus connectors.
  const raw: Array<Omit<Band, "contact" | "endContact" | "extra" | "facing">> = [];
  for (const w of wings) {
    const c = choiceOf(w);
    if (c.kind === "open") {
      const j = w.junction!;
      const along: Axis = j.horizontal ? "x" : "y";
      const onJ = touch(w.rect, j);
      if (!onJ) return null;
      const side: EnvelopeSide = j.horizontal ? (Math.abs(w.rect.minY - j.line) < EPS ? "south" : "north") : Math.abs(w.rect.minX - j.line) < EPS ? "west" : "east";
      raw.push({ wing: w.index, rect: w.rect, along, hallSide: side });
      continue;
    }
    const [a0, a1] = alongOf(w.rect, w.along);
    const [c0, c1] = crossOf(w.rect, w.along);
    if (c.lo - c0 > EPS) raw.push({ wing: w.index, rect: make(w.along, a0, a1, c0, c.lo), along: w.along, hallSide: crossSide(w.along, true) });
    if (c1 - c.hi > EPS) raw.push({ wing: w.index, rect: make(w.along, a0, a1, c.hi, c1), along: w.along, hallSide: crossSide(w.along, false) });
  }
  let pieces = raw;
  for (const k of connectors) pieces = pieces.flatMap((b) => subtract(b.rect, k).map((rect) => ({ ...b, rect })));
  const bands: Band[] = [];
  for (const b of pieces) {
    const [a0, a1] = alongOf(b.rect, b.along);
    const [x0, x1] = crossOf(b.rect, b.along);
    // Slivers left beside a connector become hall.
    if (a1 - a0 < 1 - EPS || x1 - x0 < 1 - EPS) {
      halls.push(b.rect);
      continue;
    }
    bands.push({ ...b, contact: null, endContact: { lo: false, hi: false }, extra: [], facing: null });
  }
  if (!hallConnected(halls, h)) return null;

  const edges = outlineEdges(ring);
  for (const b of bands) {
    const [a0, a1] = alongOf(b.rect, b.along);
    const hs = sideSeg(b.rect, b.hallSide);
    const spans: Array<[number, number]> = [];
    for (const k of halls) {
      const t = touch(k, hs);
      if (t) spans.push(t);
    }
    spans.sort((p, q) => p[0] - q[0]);
    const merged: Array<[number, number]> = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1] + EPS) last[1] = Math.max(last[1], s[1]);
      else merged.push([...s]);
    }
    b.contact = merged.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0] ?? null;
    const lowEnd = b.along === "x" ? "west" : "south";
    const highEnd = b.along === "x" ? "east" : "north";
    const [x0, x1] = crossOf(b.rect, b.along);
    const endTouch = (side: EnvelopeSide) =>
      halls.some((k) => {
        const t = touch(k, sideSeg(b.rect, side));
        return !!t && t[1] - t[0] >= Math.min(x1 - x0, opts.doorWidth + 0.3) - EPS;
      });
    b.endContact = { lo: endTouch(lowEnd), hi: endTouch(highEnd) };
    if (!b.contact && !b.endContact.lo && !b.endContact.hi) return null;
    const outer = OPPOSITE_SIDE[b.hallSide];
    const os = sideSeg(b.rect, outer);
    for (const f of fringe) {
      if (f.core !== b.wing || f.toward !== b.hallSide) continue;
      const fs = sideSeg(f.rect, f.toward);
      if (Math.abs(fs.line - os.line) > EPS) continue;
      const lo = Math.max(fs.lo, a0);
      const hi = Math.min(fs.hi, a1);
      if (hi - lo > EPS) b.extra.push({ lo, hi, depth: b.along === "x" ? f.rect.maxY - f.rect.minY : f.rect.maxX - f.rect.minX });
    }
    let onOutline = 0;
    for (const e of edges) {
      if (e.horizontal !== os.horizontal || Math.abs(e.line - os.line) > EPS || e.facing !== outer) continue;
      onOutline += Math.max(0, overlap(e.min, e.max, os.lo, os.hi));
    }
    b.facing = onOutline >= (a1 - a0) / 2 ? outer : null;
  }
  return { halls, bands };
}

function hallConnected(halls: Rect[], h: number): boolean {
  if (halls.length <= 1) return true;
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.pop()!;
    halls.forEach((r, j) => {
      if (seen.has(j)) return;
      const a = halls[i];
      const ox = overlap(a.minX, a.maxX, r.minX, r.maxX);
      const oy = overlap(a.minY, a.maxY, r.minY, r.maxY);
      const joined = (ox > EPS && oy > EPS) || (Math.abs(oy) < EPS && ox >= Math.min(h, 0.9) - EPS) || (Math.abs(ox) < EPS && oy >= Math.min(h, 0.9) - EPS);
      if (joined) {
        seen.add(j);
        queue.push(j);
      }
    });
  }
  return seen.size === halls.length;
}

const listOf = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]);

const SERVICE: ReadonlySet<RoomType> = new Set(["bathroom", "wc", "utility", "storage", "ensuite"]);
const DAY_RANK: Partial<Record<RoomType, number>> = { living: 0, dining: 1, kitchen_dining: 2, kitchen: 2, utility: 3, office: 4, garage: 5 };
const NIGHT_RANK: Partial<Record<RoomType, number>> = { primary_bedroom: 0, bedroom: 1, bathroom: 2, wc: 3 };

const contactNeed = (s: SpaceSpec, door: number) => (s.type === "bathroom" || s.type === "wc" ? Math.min(door, 0.8) : door) + 0.3;

interface Slot {
  spec: SpaceSpec;
  rect: Rect;
  a0: number;
  a1: number;
  band: Band;
}

/** Cuts a band into rooms; null when a room can't have its width, depth or a stretch of hall. */
function slotBand(b: Band, spaces: SpaceSpec[], door: number): Slot[] | null {
  const [a0, a1] = alongOf(b.rect, b.along);
  const [c0, c1] = crossOf(b.rect, b.along);
  const L = a1 - a0;
  const n = spaces.length;
  const mins = spaces.map((s) => Math.max(s.minWidth, contactNeed(s, door)));
  const contact = b.contact;
  if (contact && !b.endContact.lo) mins[0] = Math.max(mins[0], contact[0] - a0 + contactNeed(spaces[0], door));
  if (contact && !b.endContact.hi) mins[n - 1] = Math.max(mins[n - 1], a1 - contact[1] + contactNeed(spaces[n - 1], door));
  const cuts = n === 1 ? [0, roundToPrecision(L)] : distributeWidths(L, spaces, mins);
  if (!cuts) return null;
  const depthAt = (lo: number, hi: number) => {
    const covered = b.extra.reduce((acc, e) => acc + Math.max(0, overlap(e.lo, e.hi, lo, hi)) * e.depth, 0);
    return c1 - c0 + covered / (hi - lo);
  };
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = roundToPrecision(a0 + cuts[i]);
    const s1 = roundToPrecision(a0 + cuts[i + 1]);
    const spec = spaces[i];
    const reach = contact ? overlap(contact[0], contact[1], s0, s1) : 0;
    const atEnd = (i === 0 && b.endContact.lo) || (i === n - 1 && b.endContact.hi);
    if (reach < contactNeed(spec, door) - EPS && !atEnd) return null;
    const depth = depthAt(s0, s1);
    if (depth < (SERVICE.has(spec.type) ? SHALLOW : MIN_BAND) - EPS) return null;
    // A room much deeper than it is wide is a corridor, not a room; bathrooms and WCs can be narrower.
    if (depth > (s1 - s0) * (SERVICE.has(spec.type) ? MAX_SERVICE_RATIO : MAX_DEPTH_RATIO) + EPS) return null;
    slots.push({ spec, rect: make(b.along, s0, s1, c0, c1), a0: s0, a1: s1, band: b });
  }
  return slots;
}

/** Widths along a band in proportion to target areas, never below the minimums, snapped to the grid. */
export function distributeWidths(length: number, spaces: SpaceSpec[], mins: number[]): number[] | null {
  if (mins.reduce((a, b) => a + b, 0) > length + 1e-9) return null;
  const widths = spaces.map(() => 0);
  const fixed = new Set<number>();
  for (;;) {
    const free = spaces.map((_, i) => i).filter((i) => !fixed.has(i));
    const remaining = length - [...fixed].reduce((sum, i) => sum + mins[i], 0);
    const total = free.reduce((sum, i) => sum + spaces[i].target, 0);
    free.forEach((i) => (widths[i] = (remaining * spaces[i].target) / total));
    const short = free.filter((i) => widths[i] < mins[i] - 1e-9);
    if (!short.length) break;
    short.forEach((i) => {
      fixed.add(i);
      widths[i] = mins[i];
    });
  }
  const cuts = [0];
  let acc = 0;
  for (let i = 0; i < spaces.length - 1; i++) {
    acc += widths[i];
    const lo = cuts[i] + mins[i];
    const hi = length - mins.slice(i + 1).reduce((a, b) => a + b, 0);
    cuts.push(roundToPrecision(Math.min(Math.max(snap(acc), Math.ceil((lo - 1e-9) / GRID) * GRID), Math.floor((hi + 1e-9) / GRID) * GRID)));
    if (cuts[i + 1] - cuts[i] < mins[i] - 1e-6) return null;
  }
  cuts.push(roundToPrecision(length));
  if (length - cuts[cuts.length - 2] < mins[mins.length - 1] - 1e-6) return null;
  return cuts;
}

function dayPreference(b: Band, arrangement: WingArrangement, rear: EnvelopeSide, rootWing: number): number {
  const front = OPPOSITE_SIDE[rear];
  const garden = b.facing === rear ? 1 : b.facing === front ? -1 : 0;
  const root = b.wing === rootWing ? 1 : 0;
  switch (arrangement) {
    case "garden-living":
      return garden * 2 + root * 0.5;
    case "quiet-garden":
      return -garden * 2 + root * 0.5;
    case "living-wing":
      return root * 3 + garden;
    case "sleeping-wing":
      return (1 - root) * 3 + garden;
  }
}

const bandLength = (b: Band) => {
  const [a0, a1] = alongOf(b.rect, b.along);
  return a1 - a0;
};
const bandArea = (b: Band) => area(b.rect) + b.extra.reduce((acc, e) => acc + (e.hi - e.lo) * e.depth, 0);

/** Which spaces go in which band, in order along it; null if they don't fit. */
function zone(bands: Band[], program: Program, arrangement: WingArrangement, rear: EnvelopeSide, rootWing: number, door: number, notes: string[]): SpaceSpec[][] | null {
  const pref = bands.map((b) => dayPreference(b, arrangement, rear, rootWing));
  const order = bands.map((_, i) => i);
  const dayOrder = [...order].sort((a, b) => pref[b] - pref[a] || a - b);
  const nightOrder = [...order].sort((a, b) => pref[a] - pref[b] || a - b);
  const assigned: SpaceSpec[][] = bands.map(() => []);
  const fits = (i: number, s: SpaceSpec) => {
    const b = bands[i];
    const list = [...assigned[i], s];
    const need = list.reduce((acc, x) => acc + Math.max(x.minWidth, contactNeed(x, door)), 0);
    const target = list.reduce((acc, x) => acc + x.target + (x.ensuite ? ENSUITE_TARGET : 0), 0);
    if (need > bandLength(b) + EPS || target > bandArea(b) * 1.35 + 2) return false;
    // Every room needs its own stretch of hall: rooms between the ends lie wholly along it.
    const reach = b.contact ? b.contact[1] - b.contact[0] : 0;
    if (list.length === 1) return reach >= contactNeed(s, door) - EPS || b.endContact.lo || b.endContact.hi;
    const ends = (b.endContact.lo ? 0 : 1) + (b.endContact.hi ? 0 : 1);
    const middle = list.length - 2;
    const widest = Math.max(...list.map((x) => Math.max(x.minWidth, contactNeed(x, door))));
    return reach >= middle * widest * 0.6 + ends * (door + 0.3) - EPS;
  };
  const day = program.spaces.filter((s) => s.zone === "day");
  const night = program.spaces.filter((s) => s.zone === "night");
  const place = (s: SpaceSpec, orderList: number[], avoid?: (i: number) => boolean): boolean => {
    for (const i of orderList) {
      if (avoid?.(i)) continue;
      if (fits(i, s)) {
        assigned[i].push(s);
        return true;
      }
    }
    return false;
  };
  for (const s of day) if (!place(s, dayOrder)) return null;
  const hasDay = (i: number) => assigned[i].some((s) => s.zone === "day");
  for (const s of night) {
    if (place(s, nightOrder, hasDay)) continue;
    if (!place(s, nightOrder)) return null;
  }
  // Worth saying only when a bedroom shares its row with the living room or kitchen.
  const LIVELY: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining"]);
  const mixed = assigned.flatMap((list) => (list.some((s) => LIVELY.has(s.type)) ? list.filter((s) => s.type === "bedroom" || s.type === "primary_bedroom").map((s) => s.name) : []));
  if (mixed.length) notes.push(`${listOf(mixed)} ${mixed.length > 1 ? "share a row" : "shares a row"} with the living spaces to fit the house.`);
  // A band left empty takes a room from a crowded band, or becomes a store if it is small.
  for (let i = 0; i < bands.length; i++) {
    if (assigned[i].length) continue;
    const donor = order
      .filter((d) => assigned[d].length > 1)
      .sort((a, b) => assigned[b].length - assigned[a].length || a - b)
      .find((d) => assigned[d].some((s) => fits(i, s)));
    if (donor !== undefined) {
      const s = [...assigned[donor]].reverse().find((x) => fits(i, x))!;
      assigned[donor] = assigned[donor].filter((x) => x !== s);
      assigned[i].push(s);
    } else if (bandArea(bands[i]) < 6.5) {
      assigned[i].push({ key: `store${i}`, type: "storage", name: "Store", target: bandArea(bands[i]), minWidth: 0.8, zone: "night", window: "none", ensuite: false });
    } else return null;
  }
  return assigned.map((list) => {
    const rank = (s: SpaceSpec) => (s.zone === "day" ? (DAY_RANK[s.type] ?? 6) : 10 + (NIGHT_RANK[s.type] ?? 6));
    return [...list].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
  });
}

/** Spaces in a band, reordered so the biggest room takes an end with no hall of its own. */
function orderForBand(b: Band, spaces: SpaceSpec[], reverse: boolean): SpaceSpec[] {
  let list = reverse ? [...spaces].reverse() : [...spaces];
  if (list.length < 2 || !b.contact) return list;
  const [a0, a1] = alongOf(b.rect, b.along);
  const loBlind = b.endContact.lo ? 0 : b.contact[0] - a0;
  const hiBlind = b.endContact.hi ? 0 : a1 - b.contact[1];
  if (loBlind < 1 && hiBlind < 1) return list;
  const biggest = list.reduce((best, s) => (s.target > best.target ? s : best), list[0]);
  list = list.filter((s) => s !== biggest);
  return loBlind >= hiBlind ? [biggest, ...list] : [...list, biggest];
}

/** Carves an ensuite from the hall-side corner of a bedroom slot, keeping the bedroom's own stretch of hall. */
function carveEnsuite(slot: Slot, door: number): { bedroom: Rect[]; ensuite: Rect } | null {
  const b = slot.band;
  const [c0, c1] = crossOf(slot.rect, b.along);
  const width = slot.a1 - slot.a0;
  const ensW = snap(Math.min(1.6, width - 1.9));
  const ensD = snap(Math.min(2, c1 - c0 - 1.6));
  if (ensW < 1.3 || ensD < 1.5) return null;
  const hallHigh = b.hallSide === crossSide(b.along, true);
  const [e0, e1] = hallHigh ? [c1 - ensD, c1] : [c0, c0 + ensD];
  const need = door + 0.3;
  for (const atHigh of [true, false]) {
    const [s0, s1] = atHigh ? [slot.a1 - ensW, slot.a1] : [slot.a0, slot.a0 + ensW];
    const [r0, r1] = atHigh ? [slot.a0, slot.a1 - ensW] : [slot.a0 + ensW, slot.a1];
    const reach = b.contact ? overlap(b.contact[0], b.contact[1], r0, r1) : 0;
    if (reach < need - EPS) continue;
    const ensuite = make(b.along, s0, s1, e0, e1);
    const bedroom = [make(b.along, r0, r1, c0, c1), make(b.along, s0, s1, hallHigh ? c0 : e1, hallHigh ? e0 : c1)];
    return { bedroom, ensuite };
  }
  return null;
}

/**
 * Every layout this outline offers for the program, best first. Each is a
 * set of labelled rectangles with notes; the emitter turns them into walls,
 * rooms and openings.
 */
export function planWings(axisRing: Ring, program: Program, opts: WingLayoutOptions): { plans: LayoutPlan[]; problem: string | null } {
  const partitions = partitionOutline(axisRing);
  if (!partitions.length) return { plans: [], problem: "the outline has a part too narrow, or too many inward corners, to lay rooms out in." };
  const arrangements = opts.arrangements ?? WING_ARRANGEMENTS.map((a) => a.id);
  const plans: LayoutPlan[] = [];
  let problem: string | null = null;
  partitions.forEach((partition, pi) => {
    const wings = wingTree(partition.cores);
    if (!wings.length) return;
    const options = wings.map((w) => hallChoices(w, partition.fringe, opts.hallWidth, w.parent === null));
    const narrow = wings.find((w, i) => !options[i].length);
    if (narrow) {
      const [c0, c1] = crossOf(narrow.rect, narrow.along);
      problem = `part of the house is ${(c1 - c0).toFixed(1)} m across; a hall and a row of rooms need ${(MIN_BAND + opts.hallWidth).toFixed(1)} m.`;
      return;
    }
    const combos: HallChoice[][] = [];
    const max = opts.maxCombos ?? 48;
    const walk = (i: number, acc: HallChoice[]) => {
      if (combos.length >= max) return;
      if (i === wings.length) {
        combos.push(acc);
        return;
      }
      for (const c of options[i]) walk(i + 1, [...acc, c]);
    };
    walk(0, []);
    const rootWing = wings[0].index;
    combos.forEach((choice, ci) => {
      const geometry = buildGeometry(wings, choice, partition.fringe, axisRing, opts);
      if (!geometry) {
        problem ??= "the halls of the wings can't be joined.";
        return;
      }
      for (const arrangement of arrangements) {
        const notes: string[] = [];
        const zoned = zone(geometry.bands, program, arrangement, opts.rearSide, rootWing, opts.doorWidth, notes);
        if (!zoned) {
          problem = "the rooms don't fit the wings at their minimum sizes.";
          continue;
        }
        const plan = roomsFor(geometry, zoned, arrangement === "quiet-garden" || arrangement === "sleeping-wing", opts, notes);
        if (!plan) {
          problem = "the rooms don't fit the wings at their minimum sizes.";
          continue;
        }
        plans.push({ id: `wings-${arrangement}.p${pi}.c${ci}`, arrangement, rooms: plan.rooms, fringe: partition.fringe, notes, score: plan.score });
      }
    });
  });
  plans.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return { plans, problem };
}

function roomsFor(geometry: Geometry, zoned: SpaceSpec[][], reverse: boolean, opts: WingLayoutOptions, notes: string[]): { rooms: LabeledRoom[]; score: number } | null {
  const rooms: LabeledRoom[] = [{ key: "hall", kind: "hall", name: "Hall", type: "hall", window: "none", rects: geometry.halls }];
  let error = 0;
  let aspect = 0;
  for (const [i, band] of geometry.bands.entries()) {
    const spaces = zoned[i];
    let slots = slotBand(band, orderForBand(band, spaces, reverse), opts.doorWidth);
    if (!slots) slots = slotBand(band, orderForBand(band, spaces, !reverse), opts.doorWidth);
    if (!slots) return null;
    for (const slot of slots) {
      const s = slot.spec;
      const kind = s.type === "storage" ? "storage" : "room";
      if (s.ensuite) {
        const carved = carveEnsuite(slot, opts.doorWidth);
        if (carved) {
          rooms.push({ key: s.key, kind, name: s.name, type: s.type, target: s.target, window: s.window, rects: carved.bedroom });
          rooms.push({ key: `${s.key}-ensuite`, kind: "ensuite", name: "Ensuite", type: "ensuite", target: ENSUITE_TARGET, window: "small", rects: [carved.ensuite], of: s.key });
        } else {
          notes.push(`${s.name} was too small to hold an ensuite.`);
          rooms.push({ key: s.key, kind, name: s.name, type: s.type, target: s.target, window: s.window, rects: [slot.rect] });
        }
      } else rooms.push({ key: s.key, kind, name: s.name, type: s.type, target: s.type === "storage" ? undefined : s.target, window: s.window, rects: [slot.rect] });
      const w = slot.rect.maxX - slot.rect.minX;
      const d = slot.rect.maxY - slot.rect.minY;
      error += Math.abs(area(slot.rect) - s.target - (s.ensuite ? ENSUITE_TARGET : 0)) / Math.max(s.target, 2);
      const ratio = Math.max(w / d, d / w);
      if (ratio > 2.4) aspect += ratio > 3 ? 2 : 1;
    }
  }
  const hallArea = geometry.halls.reduce((acc, r) => acc + area(r), 0);
  const total = rooms.reduce((acc, r) => acc + r.rects.reduce((a, x) => a + area(x), 0), 0);
  // Hall is floor no room gets: weigh it heavily, so wings open off one hall where they can.
  return { rooms, score: error + 25 * (hallArea / total) + aspect + notes.length * 0.3 };
}
