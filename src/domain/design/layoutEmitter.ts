import { applyCommand } from "../commands/apply";
import type { PlanCommand } from "../commands/types";
import { validateDocument } from "../commands/validate";
import { deriveLevelGeometry, openingHostIntervals, roomFaceIndices } from "../geometry/derive";
import { analyzeEnvelope, type EnvelopeSide } from "../geometry/envelope";
import { findFaceIndexContaining } from "../geometry/faces";
import { EPS, roundToPrecision } from "../geometry/numeric";
import { OPPOSITE_SIDE } from "../geometry/outline";
import { pointInRing } from "../geometry/polygons";
import { dot, sub, type Rect } from "../geometry/vector";
import { axialParam, pointOnAxis } from "../geometry/walls";
import { DEFAULT_HOUSE, DOOR_PRESET } from "../plan/defaults";
import type { Level, Opening, PlanDocument, Point2 } from "../plan/types";
import { floorFor, type WindowSize } from "./program";
import type { LayoutPlan } from "./wingLayout";

/**
 * Turns a labelled layout into a plan document. Walls go wherever two
 * labels meet; every room is named; each room gets a door into the room it
 * is reached from (its `via`; by default the hall, and an ensuite its
 * bedroom), windows on its outside walls, garden doors where asked, and the
 * entrance room (the hall by default) the front door. Everything goes
 * through applyCommand, so the result is as valid and editable as a
 * hand-drawn plan.
 */

export const WINDOW_WIDTH: Record<WindowSize, number> = { large: 2.4, standard: 1.4, small: 0.7, none: 0 };
/** Garden doors from a living space: a pair of glazed doors. */
export const GARDEN_DOOR = 1.6;
/** Clearance between a corner door and the end of its stretch of wall. */
const CORNER_GAP = 0.15;
/** A door swings about this far each side of its wall, so it keeps this far from what it must avoid, m. */
const AVOID_REACH = 1;
/** Kept between a door and what it avoids, along the wall, m. */
const AVOID_GAP = 0.05;

export interface EmitOptions {
  prefix: string;
  hallWidth: number;
  doorWidth: number;
  naturalLight: boolean;
  /** An upper floor: its hall is a landing, with no front door and no doors to the garden. */
  upper?: boolean;
  /** Where doors mustn't go, nor swing: the stairs. */
  doorAvoid?: Rect[];
}

export type EmitResult = { ok: true; document: PlanDocument; notes: string[] } | { ok: false; reason: string };

/** A straight stretch of boundary between two labelled rooms, or a room and the outside. */
export interface Run {
  horizontal: boolean;
  line: number;
  lo: number;
  hi: number;
  /** For runs on the outline: which way the outside is. */
  facing?: EnvelopeSide;
  /** A point just inside the room the run bounds. */
  inside: Point2;
}

const key = (v: number) => Math.round(v * 1000);

export function emitLayout(shell: PlanDocument, plan: LayoutPlan, opts: EmitOptions): EmitResult {
  const env = analyzeEnvelope(shell.levels[0]);
  if (!env.ok) return { ok: false, reason: "the house outline is invalid." };
  const ring = env.info.axisRing;
  const rear: EnvelopeSide = (shell.levels[0].rearWallId && env.info.sideOfWall[shell.levels[0].rearWallId]) || "north";
  const front = OPPOSITE_SIDE[rear];

  // A grid through every corner of the outline and every room.
  const xs = [...new Map([...ring.map((p) => p.x), ...plan.rooms.flatMap((r) => r.rects.flatMap((q) => [q.minX, q.maxX]))].map((v) => [key(v), roundToPrecision(v)])).values()].sort((a, b) => a - b);
  const ys = [...new Map([...ring.map((p) => p.y), ...plan.rooms.flatMap((r) => r.rects.flatMap((q) => [q.minY, q.maxY]))].map((v) => [key(v), roundToPrecision(v)])).values()].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const at = (i: number, j: number) => j * nx + i;
  const centre = (i: number, j: number) => ({ x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 });
  const inside: boolean[] = [];
  const label: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = centre(i, j);
      inside.push(pointInRing(ring, c));
      label.push(plan.rooms.findIndex((r) => r.rects.some((q) => c.x > q.minX && c.x < q.maxX && c.y > q.minY && c.y < q.maxY)));
    }
  }
  // Fringe takes the label of whatever lies next to it towards its core.
  const step: Record<EnvelopeSide, [number, number]> = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
  for (let pass = 0; pass < plan.fringe.length + 1; pass++) {
    for (const f of plan.fringe) {
      const [di, dj] = step[f.toward];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = at(i, j);
          if (!inside[k] || label[k] >= 0) continue;
          const c = centre(i, j);
          if (c.x < f.rect.minX || c.x > f.rect.maxX || c.y < f.rect.minY || c.y > f.rect.maxY) continue;
          for (let a = i + di, b = j + dj; a >= 0 && a < nx && b >= 0 && b < ny && inside[at(a, b)]; a += di, b += dj) {
            if (label[at(a, b)] >= 0) {
              label[k] = label[at(a, b)];
              break;
            }
          }
        }
      }
    }
  }
  for (let k = 0; k < inside.length; k++) if (inside[k] && label[k] < 0) return { ok: false, reason: "part of the house belongs to no room." };
  for (let r = 0; r < plan.rooms.length; r++) {
    const cells = label.map((l, k) => (l === r && inside[k] ? k : -1)).filter((k) => k >= 0);
    if (!cells.length) return { ok: false, reason: `${plan.rooms[r].name} has no floor.` };
    const seen = new Set([cells[0]]);
    const queue = [cells[0]];
    while (queue.length) {
      const k = queue.pop()!;
      const [i, j] = [k % nx, Math.floor(k / nx)];
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || a >= nx || b < 0 || b >= ny) continue;
        const n = at(a, b);
        if (inside[n] && label[n] === r && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    if (seen.size !== cells.length) return { ok: false, reason: `${plan.rooms[r].name} is in two pieces.` };
  }

  // Boundaries: between two rooms (walls to draw) and between a room and the outside (outline).
  const between = new Map<string, Run[]>();
  const outside = new Map<number, Run[]>();
  const walls: Array<Omit<Run, "inside">> = [];
  const push = (list: Run[], run: Run) => {
    const last = list[list.length - 1];
    if (last && last.horizontal === run.horizontal && Math.abs(last.line - run.line) < EPS && Math.abs(last.hi - run.lo) < EPS && last.facing === run.facing) last.hi = run.hi;
    else list.push(run);
  };
  const record = (a: number, b: number, run: Run, runB: Run) => {
    if (a === b) return;
    const pair = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (!between.has(pair)) between.set(pair, []);
    // Each pair keeps the run from the lower label's side.
    push(between.get(pair)!, a < b ? run : runB);
  };
  for (let i = 0; i <= nx; i++) {
    let open: Omit<Run, "inside"> | null = null;
    for (let j = 0; j < ny; j++) {
      const l = i > 0 && inside[at(i - 1, j)] ? label[at(i - 1, j)] : -1;
      const r = i < nx && inside[at(i, j)] ? label[at(i, j)] : -1;
      const seg = { horizontal: false, line: xs[i], lo: ys[j], hi: ys[j + 1] };
      const mid = (ys[j] + ys[j + 1]) / 2;
      if (l >= 0 && r >= 0 && l !== r) {
        record(l, r, { ...seg, inside: { x: xs[i] - 0.3, y: mid } }, { ...seg, inside: { x: xs[i] + 0.3, y: mid } });
        if (open && Math.abs(open.hi - seg.lo) < EPS) open.hi = seg.hi;
        else walls.push((open = { ...seg }));
      } else {
        open = null;
        if (l >= 0 && r < 0) push(outside.get(l) ?? (outside.set(l, []), outside.get(l)!), { ...seg, facing: "east", inside: { x: xs[i] - 0.3, y: mid } });
        if (r >= 0 && l < 0) push(outside.get(r) ?? (outside.set(r, []), outside.get(r)!), { ...seg, facing: "west", inside: { x: xs[i] + 0.3, y: mid } });
      }
    }
  }
  for (let j = 0; j <= ny; j++) {
    let open: Omit<Run, "inside"> | null = null;
    for (let i = 0; i < nx; i++) {
      const d = j > 0 && inside[at(i, j - 1)] ? label[at(i, j - 1)] : -1;
      const u = j < ny && inside[at(i, j)] ? label[at(i, j)] : -1;
      const seg = { horizontal: true, line: ys[j], lo: xs[i], hi: xs[i + 1] };
      const mid = (xs[i] + xs[i + 1]) / 2;
      if (d >= 0 && u >= 0 && d !== u) {
        record(d, u, { ...seg, inside: { x: mid, y: ys[j] - 0.3 } }, { ...seg, inside: { x: mid, y: ys[j] + 0.3 } });
        if (open && Math.abs(open.hi - seg.lo) < EPS) open.hi = seg.hi;
        else walls.push((open = { ...seg }));
      } else {
        open = null;
        if (d >= 0 && u < 0) push(outside.get(d) ?? (outside.set(d, []), outside.get(d)!), { ...seg, facing: "north", inside: { x: mid, y: ys[j] - 0.3 } });
        if (u >= 0 && d < 0) push(outside.get(u) ?? (outside.set(u, []), outside.get(u)!), { ...seg, facing: "south", inside: { x: mid, y: ys[j] + 0.3 } });
      }
    }
  }

  let doc: PlanDocument = shell;
  const run = (command: PlanCommand): string | null => {
    const result = applyCommand(doc, command);
    if (!result.ok) return result.issues[0]?.message ?? "invalid edit";
    doc = result.document;
    return null;
  };
  let wallCount = 0;
  for (const w of walls) {
    const wallId = `${opts.prefix}-w${++wallCount}`;
    const start = w.horizontal ? { x: w.lo, y: w.line } : { x: w.line, y: w.lo };
    const end = w.horizontal ? { x: w.hi, y: w.line } : { x: w.line, y: w.hi };
    const problem = run({ type: "addWall", wallId, start, end, thickness: DEFAULT_HOUSE.internalThickness, idPrefix: wallId });
    if (problem) return { ok: false, reason: problem };
  }

  // Name every room from a point in its biggest cell.
  for (const [r, room] of plan.rooms.entries()) {
    let best = -1;
    let bestArea = 0;
    label.forEach((l, k) => {
      if (l !== r || !inside[k]) return;
      const [i, j] = [k % nx, Math.floor(k / nx)];
      const a = (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      if (a > bestArea) [best, bestArea] = [k, a];
    });
    const point = centre(best % nx, Math.floor(best / nx));
    const level = doc.levels[0];
    const face = findFaceIndexContaining(deriveLevelGeometry(level).faces, point);
    const roomId = [...roomFaceIndices(level)].find(([, f]) => f === face)?.[0];
    if (!roomId) return { ok: false, reason: `couldn't find the region for ${room.name}.` };
    const problem = run({ type: "updateRoom", roomId, changes: { name: room.name, type: room.type, targetArea: room.target ?? null, floorMaterial: floorFor(room.type) } });
    if (problem) return { ok: false, reason: problem };
  }

  // Openings. One that doesn't fit is left out rather than failing the layout.
  let openingCount = 0;
  let skipped = 0;
  /** Places an opening with fitOpening and adds it; false (and counted as skipped) if it doesn't fit. */
  const place = (kind: "door" | "window", r: Run, width: number, margin: number, size: WindowSize = "standard", toward?: Point2): boolean => {
    const opening = fitOpening(doc.levels[0], r, kind, width, margin, size, `${opts.prefix}-o${++openingCount}`, toward, kind === "door" ? opts.doorAvoid : undefined);
    if (!opening) {
      skipped++;
      return false;
    }
    if (run({ type: "addOpening", opening })) {
      skipped++;
      return false;
    }
    return true;
  };

  const hall = plan.rooms.findIndex((r) => r.kind === "hall");
  const entry = plan.entrance ? plan.rooms.findIndex((r) => r.key === plan.entrance) : hall;
  const runsBetween = (a: number, b: number) => [...(between.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? [])].map((r) => (a < b ? r : { ...r, inside: flip(r) }));
  const longest = (runs: Run[]) => [...runs].sort((p, q) => q.hi - q.lo - (p.hi - p.lo))[0];
  const light = opts.naturalLight ? 1.3 : 1;
  const notes: string[] = [];
  // The entrance room's outside walls, street side first, then the sides, then the garden.
  const rank = (o: Run) => (o.facing === front ? 0 : o.facing === rear ? 2 : 1);
  const entryOuts = [...(entry >= 0 ? (outside.get(entry) ?? []) : [])].sort((p, q) => rank(p) - rank(q) || q.hi - q.lo - (p.hi - p.lo));
  // With corner doors, each door sits at the end of its wall nearer the way in.
  const wayIn = plan.cornerDoors && entryOuts[0] ? midpoint(entryOuts[0]) : undefined;
  // The front door into the entrance room, before any window can take its wall: on the street side if it reaches it, else a side, else the garden side.
  const hallOuts = [...(hall >= 0 ? (outside.get(hall) ?? []) : [])];
  let entrance: Run | null = null;
  for (const o of opts.upper ? [] : entryOuts) {
    if (place("door", o, 1, 0.2)) {
      entrance = o;
      break;
    }
  }
  if (!entrance && !opts.upper) {
    const day = plan.rooms.findIndex((x) => x.type === "living" || x.type === "kitchen_dining");
    const o = day >= 0 ? [...(outside.get(day) ?? [])].sort((p, q) => rank(p) - rank(q) || q.hi - q.lo - (p.hi - p.lo))[0] : undefined;
    if (o && place("door", o, 1, 0.3)) notes.push(`The front door opens into the ${plan.rooms[day].name.toLowerCase()}; the hall doesn't reach an outside wall.`);
    else notes.push("There is no front door; the hall doesn't reach an outside wall.");
  }
  for (const [r, room] of plan.rooms.entries()) {
    if (room.kind === "hall" && !room.via) continue;
    // The room the front door opens into, when it isn't the hall and isn't reached from anywhere: the way in, so no door to a parent.
    const root = r === entry && room.kind !== "hall" && !room.via;
    if (!root) {
      const parent = room.via ? plan.rooms.findIndex((x) => x.key === room.via) : room.kind === "ensuite" ? plan.rooms.findIndex((x) => x.key === room.of) : hall;
      const shared = parent >= 0 ? longest(runsBetween(r, parent)) : undefined;
      if (!shared) return { ok: false, reason: `${room.name} doesn't reach the ${parent >= 0 ? plan.rooms[parent].name.toLowerCase() : "hall"}.` };
      const narrow = room.type === "bathroom" || room.type === "wc" || room.type === "storage" || room.type === "ensuite";
      const width = narrow ? Math.min(opts.doorWidth, 0.8) : opts.doorWidth;
      // Where doors must keep clear of something (the stairs), any stretch of the shared wall will do, longest first.
      const tries = opts.doorAvoid?.length ? [...runsBetween(r, parent)].sort((p, q) => q.hi - q.lo - (p.hi - p.lo)) : [shared];
      // Only a door that fits nowhere counts as left out, not each stretch tried on the way.
      const before = skipped;
      if (!tries.some((run) => place("door", run, width, room.kind === "ensuite" ? 0.4 : 0.3, "standard", wayIn))) return { ok: false, reason: `there's no room for a door into ${room.name.toLowerCase()}.` };
      skipped = before;
    }
    for (const link of room.links ?? []) {
      const other = plan.rooms.findIndex((x) => x.key === link);
      const run = other >= 0 ? longest(runsBetween(r, other)) : undefined;
      if (run) place("door", run, opts.doorWidth, 0.3, "standard", wayIn);
    }
    const outs = [...(outside.get(r) ?? [])].sort((p, q) => q.hi - q.lo - (p.hi - p.lo));
    let doorOut: Run | undefined;
    if (room.gardenDoor && !opts.upper) {
      const toGarden = outs.find((o) => o.facing === rear && o.hi - o.lo >= GARDEN_DOOR + 0.6);
      if (toGarden && place("door", toGarden, GARDEN_DOOR, 0.6)) doorOut = toGarden;
    }
    if (room.window === "none" || !outs.length) continue;
    // A wall taken by garden doors comes last for windows.
    const lit = doorOut ? [...outs.filter((o) => o !== doorOut), doorOut] : outs;
    // Its window on the longest outside wall that takes it; failing that, a narrower one beside the garden doors, so the room has one.
    const before = skipped;
    const windowed =
      lit.some((o) => place("window", o, WINDOW_WIDTH[room.window] * light, 0.6, room.window)) ||
      (!!doorOut && [WINDOW_WIDTH.standard, WINDOW_WIDTH.small].some((w) => w < WINDOW_WIDTH[room.window] * light && place("window", doorOut!, w, 0.4, room.window)));
    // Only a room left without any window counts as one that didn't fit.
    skipped = before + (windowed ? 0 : 1);
    if (room.window === "large" || opts.naturalLight) {
      // Not beside the garden doors: a window there would overlap them.
      for (const o of lit.slice(1)) if (o !== doorOut && o.hi - o.lo >= 1.4) place("window", o, WINDOW_WIDTH[room.window] * light, 0.8, room.window);
    }
  }

  const garden = opts.upper ? undefined : hallOuts.find((o) => o !== entrance && o.facing === rear);
  if (garden) place("door", garden, 0.9, 0.2);
  // Long stretches of hall along the outside get a window.
  for (const o of hallOuts) if (o !== entrance && o !== garden && o.hi - o.lo >= 3) place("window", o, 1.2, 0.6);
  if (skipped) notes.push(`${skipped} door${skipped > 1 ? "s or windows" : " or window"} didn't fit and ${skipped > 1 ? "were" : "was"} left out.`);

  const issues = validateDocument(doc);
  if (issues.length) return { ok: false, reason: issues[0].message };
  return { ok: true, document: doc, notes };
}

/**
 * An opening on the clear part of a run, as wide as it allows up to `width`
 * less `margin`: centred, or near the end of the clear stretch closest to
 * `toward`, swinging into the room `run.inside` is in. Null if it doesn't fit.
 */
export function fitOpening(level: Level, r: Run, kind: "door" | "window", width: number, margin: number, size: WindowSize, id: string, toward?: Point2, avoid?: readonly Rect[]): Opening | null {
  const mid = (r.lo + r.hi) / 2;
  const p = r.horizontal ? { x: mid, y: r.line } : { x: r.line, y: mid };
  const geometry = deriveLevelGeometry(level);
  const axis = [...geometry.axes.values()].find((a) => (a.orientation === "horizontal") === r.horizontal && pointOnAxis(a, p, 1e-6));
  if (!axis) return null;
  const s0 = axialParam(axis, r.horizontal ? { x: r.lo, y: r.line } : { x: r.line, y: r.lo });
  const s1 = axialParam(axis, r.horizontal ? { x: r.hi, y: r.line } : { x: r.line, y: r.hi });
  const [lo, hi] = [Math.min(s0, s1), Math.max(s0, s1)];
  // Stretches kept clear: anything to avoid within a door's swing of the wall.
  const blocked: Array<[number, number]> = [];
  for (const q of avoid ?? []) {
    const [near0, near1] = r.horizontal ? [q.minY, q.maxY] : [q.minX, q.maxX];
    const gap = r.line < near0 ? near0 - r.line : r.line > near1 ? r.line - near1 : 0;
    if (gap >= AVOID_REACH) continue;
    const a = axialParam(axis, r.horizontal ? { x: q.minX, y: r.line } : { x: r.line, y: q.minY });
    const b = axialParam(axis, r.horizontal ? { x: q.maxX, y: r.line } : { x: r.line, y: q.maxY });
    blocked.push([Math.min(a, b) - AVOID_GAP, Math.max(a, b) + AVOID_GAP]);
  }
  // The widest clear stretch of the run between junctions.
  let span: [number, number] | null = null;
  for (const [a, b] of openingHostIntervals(geometry, axis.wallId)) {
    let pieces: Array<[number, number]> = [[Math.max(a, lo), Math.min(b, hi)]];
    for (const [c, d] of blocked) pieces = pieces.flatMap(([x0, x1]): Array<[number, number]> => (d <= x0 || c >= x1 ? [[x0, x1]] : [[x0, Math.min(x1, c)], [Math.max(x0, d), x1]]));
    for (const [x0, x1] of pieces) if (x1 - x0 > EPS && (!span || x1 - x0 > span[1] - span[0])) span = [x0, x1];
  }
  if (!span) return null;
  const w = roundToPrecision(Math.min(width, span[1] - span[0] - margin));
  if (w < (kind === "door" ? 0.6 : 0.5)) return null;
  let offset = roundToPrecision((span[0] + span[1]) / 2 - w / 2);
  if (toward && span[1] - span[0] >= w + 2 * CORNER_GAP) {
    // Whichever end of the clear stretch lies nearer `toward`.
    const t = axialParam(axis, toward);
    offset = roundToPrecision(Math.abs(t - span[0]) <= Math.abs(t - span[1]) ? span[0] + CORNER_GAP : span[1] - CORNER_GAP - w);
  }
  const swingSide = dot(sub(r.inside, axis.start), axis.normal) < 0 ? "right" : "left";
  return kind === "door"
    ? { id, wallId: axis.wallId, kind, offset, width: w, height: DOOR_PRESET.height, hinge: "start", swingSide }
    : size === "small"
      ? { id, wallId: axis.wallId, kind, offset, width: w, height: 0.6, sillHeight: 1.4 }
      : { id, wallId: axis.wallId, kind, offset, width: w, height: size === "large" ? 1.5 : 1.2, sillHeight: size === "large" ? 0.6 : 0.9 };
}

const midpoint = (r: Run): Point2 => (r.horizontal ? { x: (r.lo + r.hi) / 2, y: r.line } : { x: r.line, y: (r.lo + r.hi) / 2 });

/** The point on the other side of a run from its `inside`. */
function flip(r: Run): Point2 {
  return r.horizontal ? { x: r.inside.x, y: 2 * r.line - r.inside.y } : { x: 2 * r.line - r.inside.x, y: r.inside.y };
}
