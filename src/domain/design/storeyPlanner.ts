import { EPS, roundToPrecision } from "../geometry/numeric";
import type { Rect } from "../geometry/vector";
import { STAIR_PRESET } from "../plan/defaults";
import type { Point2, RoomType } from "../plan/types";
import type { Program, SpaceSpec } from "./program";
import { clearMin, proportionOk, ROOM_RULES, SLOT_WALLS } from "./roomRules";
import { distributeWidths, type LabeledRoom, type LayoutPlan } from "./wingLayout";
import { dayRow, frameOf, MIN_DAY_WIDTH, nightOrders, nightSpaces, slotBand, slotMin, type Box, type Frame, type Placed, type ZoneOptions } from "./zonePlanner";

/**
 * Two-storey layouts for rectangular houses, built round a spine: a strip
 * from the street towards the garden along one side of the house, holding
 * the hall and the stairs on the ground floor and the landing over them
 * upstairs. The stairs climb from beside the front door towards the garden
 * against the outside wall, so the way past them on both floors runs beside
 * the rooms.
 *
 *        ground floor                     first floor
 *           street                           street
 *   ┌──────┬─────────────┐          ┌──────┬─────────────┐
 *   │ Hall │ Living      │          │      │ Bedroom 2   │
 *   │ ┃up  ├─────────────┤          │Landing────────────┤
 *   │ ┃    │ Dining      │          │ ┃    │ Bedroom 3   │
 *   ├──────┼─────────────┤          ├──────┼─────────────┤
 *   │ WC   │ Kitchen     │          │ Bath │ Master      │
 *   │ Util │  ↓ garden   │          │      │             │
 *   └──────┴─────────────┘          └──────┴─────────────┘
 *           garden                           garden
 *
 * Downstairs the living spaces are one row beside the hall, as in a zone
 * layout's day zone; behind the hall go a WC, a utility or a store.
 * Upstairs the bedrooms are a band beside the landing, which runs as far as
 * the last door it serves; behind it, over the WC, goes a bathroom, so the
 * wet rooms stack.
 *
 * Everything is in the house's own frame: u along the street front, v from
 * the street (0) to the garden, on the wall centrelines. Pure and deterministic.
 */

export interface StoreyOptions extends ZoneOptions {
  externalThickness: number;
  /** Risers per storey, from the floor-to-floor height. */
  risers: number;
}

export interface StoreyPlan {
  /** Stable for the same house and brief: spine, ground and upper layout. */
  id: string;
  ground: LayoutPlan;
  upper: LayoutPlan;
  /** The flight in plan: its rectangle, the middle of its bottom step, and the way it climbs. */
  stairs: { rect: Rect; foot: Point2; rotation: 0 | 90 | 180 | 270 };
  /** Lower is better. */
  score: number;
}

/** From the front wall's inside face to the bottom step: room to come in and turn, m. */
const LOBBY = 1.2;
/**
 * Longer halls in front of the stairs, m, so the floor above can have a room
 * across the whole front of the house, over the front of the hall.
 */
const FRONT_DEPTHS = [3, 3.3, 3.6, 3.9, 4.2];
/** Clear way past the stairs, m: room for a door beside the top of the flight. */
const PASSAGE = 1.1;
const HALF = 0.05;
/** Widest column of rooms beside the spine, m. */
const MAX_COLUMN = 7;
const LIVING: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining"]);
const WET: ReadonlySet<RoomType> = new Set(["bathroom", "ensuite", "wc"]);
const PLUMBED: ReadonlySet<RoomType> = new Set(["bathroom", "ensuite", "wc", "kitchen", "kitchen_dining", "utility"]);
/** What can go behind the hall downstairs, and behind the landing upstairs. */
const BEHIND_HALL: ReadonlySet<RoomType> = new Set(["wc", "utility", "storage"]);
const BEHIND_LANDING: ReadonlySet<RoomType> = new Set(["bathroom", "wc", "storage", "bedroom"]);

const len = (r: [number, number]) => r[1] - r[0];
const GRID = 0.05;
const up = (v: number) => roundToPrecision(Math.ceil(v / GRID - 1e-9) * GRID);
const area = (b: Box) => (b.u1 - b.u0) * (b.v1 - b.v0);
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0)) * Math.max(0, Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0));

/**
 * Where the stairs and the halls round them fall along v, for a given wall
 * thickness and storey: the bottom step `lobby` in from the front wall.
 */
export function stairLine(externalThickness: number, risers: number, lobby = LOBBY) {
  const front = lobby > LOBBY + EPS;
  const foot = up(externalThickness / 2 + lobby);
  // Under a room across the front, the flight starts just past its wall.
  const start = front ? roundToPrecision(foot + HALF) : foot;
  const top = roundToPrecision(start + (risers - 1) * STAIR_PRESET.going);
  return {
    /** A room across the whole front of the floor above, as deep as the hall in front of the stairs. */
    front,
    /** Where the room across the front ends, and where the flight starts. */
    foot,
    start,
    top,
    /** Where the hall can end: just past the top of the flight. */
    hallEnd: up(top + HALF),
    /** Where the landing can end at the least: past the floor you step off onto. */
    landingEnd: up(top + STAIR_PRESET.approach + HALF),
  };
}

/** The spine's width beside the outside wall: the stairs and the way past them. */
export const spineWidth = (externalThickness: number) => up(externalThickness / 2 + STAIR_PRESET.width + PASSAGE + HALF);

interface Spine {
  tag: "l" | "r";
  u: [number, number];
  stair: [number, number];
  column: [number, number];
}

function spinesFor(W: number, t: number): Spine[] {
  const s = spineWidth(t);
  const column = roundToPrecision(W - s);
  if (column < MIN_DAY_WIDTH - EPS || column > MAX_COLUMN + EPS) return [];
  const w = STAIR_PRESET.width;
  return [
    { tag: "l", u: [0, s], stair: [t / 2, t / 2 + w], column: [s, W] },
    { tag: "r", u: [roundToPrecision(W - s), W], stair: [roundToPrecision(W - t / 2 - w), roundToPrecision(W - t / 2)], column: [0, roundToPrecision(W - s)] },
  ];
}

interface FloorLayout {
  tag: string;
  hall: Box;
  /** A second part of the hall: the strip in from the front door. */
  entry?: Box;
  rooms: Placed[];
  score: number;
}

const miss = (rooms: Placed[]) => rooms.reduce((sum, r) => sum + (r.target ? Math.abs(area(r.box) - r.target) / Math.max(r.target, 2) : 0), 0);

/**
 * The ground floor: the hall up the spine to the top of the stairs (or the
 * whole way), what goes behind it, and the living spaces in a row beside it.
 */
function groundLayouts(spine: Spine, spaces: SpaceSpec[], V: number, line: ReturnType<typeof stairLine>, opts: ZoneOptions): FloorLayout[] {
  const out: FloorLayout[] = [];
  const door = opts.doorWidth;
  const rear: [number, number] = [line.hallEnd, V];
  const service = spaces.filter((s) => BEHIND_HALL.has(s.type));
  const store: SpaceSpec = { key: "store", type: "storage", name: "Store", target: 2, minWidth: 0.9, zone: "day", window: "none", ensuite: false };
  // What goes behind the hall: nothing (the hall runs to the garden), one room off the hall, or two
  // (the second opening off the living space beside it, as a utility off the kitchen).
  const options: Array<{ tag: string; behind: SpaceSpec[] }> = [{ tag: "h", behind: [] }];
  if (len(rear) >= 1.2) {
    for (const a of service) options.push({ tag: `1${a.type[0]}`, behind: [a] });
    for (const a of service) for (const b of [...service, store]) if (a !== b && a.type !== "utility") options.push({ tag: `2${a.type[0]}${b.type[0]}`, behind: [a, b] });
  }
  for (const { tag, behind } of options) {
    const hallEnd = behind.length ? line.hallEnd : V;
    const hall: Box = { u0: spine.u[0], u1: spine.u[1], v0: 0, v1: hallEnd };
    const placedBehind = behind.length ? slotBand(behind, spine.u, rear, door, (s) => (s === behind[0] ? "hall" : "beside")) : [];
    if (!placedBehind) continue;
    const rest = spaces.filter((s) => !behind.includes(s));
    const row = dayRow(rest, spine.column, [0, V], [0, hallEnd], opts);
    if (!row) continue;
    // A second room behind the hall opens off the living space beside it.
    let ok = true;
    for (const p of placedBehind) {
      if (p.via !== "beside") continue;
      const beside = row.rooms.filter((r) => LIVING.has(r.type) && Math.min(r.box.v1, p.box.v1) - Math.max(r.box.v0, p.box.v0) >= door + 0.3);
      if (!beside.length) ok = false;
      else p.via = beside[0].key;
    }
    if (!ok) continue;
    const rooms = [...row.rooms, ...placedBehind];
    // Hall area weighs as in zone layouts; a long hall or an oversized WC costs.
    const score = row.score + miss(placedBehind) + (area(hall) / ((len(spine.column) + len(spine.u)) * V)) * 25;
    out.push({ tag, hall, rooms, score });
  }
  return out.sort((a, b) => a.score - b.score);
}

/**
 * The first floor: bedrooms in a band beside the landing, the landing as far
 * as the last door it serves (and at least past the top of the stairs), and
 * a bathroom, an ensuite, a small bedroom or a store behind it. With a long
 * hall downstairs, a bedroom spans the whole front of the house over it.
 */
function upperLayouts(spine: Spine, program: Program, W: number, V: number, line: ReturnType<typeof stairLine>, opts: ZoneOptions): FloorLayout[] {
  const door = opts.doorWidth;
  const spaces = nightSpaces(program);
  const out: FloorLayout[] = [];
  const start = line.front ? line.foot : 0;
  for (const [oi, order] of nightOrders(spaces).entries()) {
    // The room across the front: a bedroom without an ensuite slot of its own beside it.
    const fronts: Array<SpaceSpec | null> = line.front ? [...new Map(order.filter((s) => (s.type === "bedroom" || s.type === "primary_bedroom") && !s.ensuite).map((s) => [`${s.type}${s.target}`, s])).values()] : [null];
    for (const front of fronts) {
      const frontBox: Box = { u0: 0, u1: W, v0: 0, v1: line.foot };
      if (front && !proportionOk(front.type, W, line.foot)) continue;
      const rest = order.filter((s) => s !== front);
      const kinds = [null, ...new Set(rest.filter((s) => BEHIND_LANDING.has(s.type)).map((s) => s.type))];
      for (const kind of kinds) {
        const behind = kind ? [rest.find((s) => s.type === kind)!] : [];
        const band = rest.filter((s) => !behind.includes(s));
        const master = rest.find((s) => s.type === "primary_bedroom");
        const via = (s: SpaceSpec) => (s.type === "ensuite" && master ? master.key : "hall");
        const rooms = slotBand(band, spine.column, [start, V], door, via);
        if (!rooms) continue;
        const served = rooms.filter((r) => r.via === "hall").map((r) => r.box.v0 + door + 0.45);
        let landingEnd = up(Math.max(line.landingEnd, ...served));
        if (V - landingEnd < 0.9) landingEnd = V;
        if (behind.length && V - landingEnd < slotMin(behind[0], len(spine.u), door, behind[0].type !== "ensuite") - EPS) continue;
        let placedBehind: Placed[] = [];
        if (behind.length) {
          const placed = slotBand(behind, spine.u, [landingEnd, V], door, via);
          if (!placed) continue;
          // An ensuite behind the landing opens off its bedroom beside it.
          if (behind[0].type === "ensuite") {
            const bedroom = rooms.find((r) => r.key === master?.key);
            const shared = bedroom ? Math.min(bedroom.box.v1, V) - Math.max(bedroom.box.v0, landingEnd) : 0;
            if (shared < door + 0.3) continue;
          }
          placedBehind = placed;
        } else if (landingEnd < V - EPS) {
          // What the landing doesn't need is a linen store.
          placedBehind = [{ key: "linen", kind: "storage", name: "Store", type: "storage", window: "none", box: { u0: spine.u[0], u1: spine.u[1], v0: landingEnd, v1: V }, via: "hall" }];
        }
        const frontRoom: Placed[] = front
          ? [{ key: front.key, kind: "room", name: front.name, type: front.type, target: front.target, window: front.window, box: frontBox, via: "hall" }]
          : [];
        const hall: Box = { u0: spine.u[0], u1: spine.u[1], v0: start, v1: landingEnd };
        const all = [...frontRoom, ...rooms, ...placedBehind];
        const masterBox = all.find((r) => r.type === "primary_bedroom");
        const quiet = masterBox && masterBox.box.v1 >= V - EPS ? 0 : 0.5;
        const score = miss(all) + quiet + (area(hall) / (W * V)) * 25;
        out.push({ tag: `o${oi}${front ? `f${front.type[0]}` : ""}${kind ? kind[0] : "s"}`, hall, rooms: all, score });
      }
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

/** Share of the upstairs wet rooms' floor that stands over plumbing downstairs. */
function stacked(ground: FloorLayout, upper: FloorLayout): number {
  const wet = upper.rooms.filter((r) => WET.has(r.type));
  const total = wet.reduce((sum, r) => sum + area(r.box), 0);
  if (!total) return 1;
  const below = ground.rooms.filter((r) => PLUMBED.has(r.type));
  return wet.reduce((sum, r) => sum + below.reduce((s, b) => s + overlapArea(r.box, b.box), 0), 0) / total;
}

function labelled(frame: Frame, p: Placed): LabeledRoom {
  return {
    key: p.key,
    kind: p.kind,
    name: p.name,
    type: p.type,
    ...(p.target !== undefined && p.kind !== "storage" ? { target: p.target } : {}),
    window: p.window,
    rects: [frame.world(p.box)],
    ...(p.via !== "hall" || p.kind === "ensuite" ? { via: p.via } : {}),
    ...(p.of ? { of: p.of } : {}),
    ...(p.links ? { links: p.links } : {}),
    ...(p.gardenDoor ? { gardenDoor: true } : {}),
  };
}

function floorPlan(frame: Frame, id: string, hallName: string, floor: FloorLayout): LayoutPlan {
  return {
    id,
    arrangement: "storeys",
    entrance: "hall",
    cornerDoors: true,
    rooms: [{ key: "hall", kind: "hall", name: hallName, type: "hall", window: "none", rects: [floor.hall, ...(floor.entry ? [floor.entry] : [])].map(frame.world) }, ...floor.rooms.map((p) => labelled(frame, p))],
    fringe: [],
    notes: [],
    score: floor.score,
  };
}

/** A point of the frame in plan. */
const pointOf = (frame: Frame, u: number, v: number): Point2 => {
  const r = frame.world({ u0: u, u1: u, v0: v, v1: v });
  return { x: r.minX, y: r.minY };
};

/** The flight in plan: the box it fills in the frame, climbing along v (from the street) or along u (from u0 to u1). */
function stairsOf(frame: Frame, box: Box, along: "u" | "v"): StoreyPlan["stairs"] {
  const foot = along === "v" ? pointOf(frame, (box.u0 + box.u1) / 2, box.v0) : pointOf(frame, box.u0, (box.v0 + box.v1) / 2);
  const top = along === "v" ? pointOf(frame, (box.u0 + box.u1) / 2, box.v1) : pointOf(frame, box.u1, (box.v0 + box.v1) / 2);
  const [dx, dy] = [top.x - foot.x, top.y - foot.y];
  const rotation = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 0 : 180) : dx < 0 ? 90 : 270;
  return { rect: frame.world(box), foot: { x: roundToPrecision(foot.x), y: roundToPrecision(foot.y) }, rotation };
}

/** The same house seen from the other side: u runs the other way along the street. */
function mirrored(frame: Frame): Frame {
  return { ...frame, world: (b: Box) => frame.world({ u0: frame.W - b.u1, u1: frame.W - b.u0, v0: b.v0, v1: b.v1 }) };
}

/**
 * Two-storey layouts for a rectangle (its wall centrelines), best first: each
 * spine side, with the best ground and upper layouts on it paired up.
 */
export function planStoreys(axis: Rect, ground: Program, upper: Program, opts: StoreyOptions): { plans: StoreyPlan[]; problem: string | null } {
  const frame = frameOf(axis, opts.rearSide);
  const { W, V } = frame;
  const line = stairLine(opts.externalThickness, opts.risers);
  if (!nightSpaces(upper).length) return { plans: [], problem: "there are no bedrooms or bathrooms to go upstairs." };
  // The stairs along one side suit narrow, deep houses; across the middle, squarer ones.
  const spines = V >= line.landingEnd + 1.5 ? spinesFor(W, opts.externalThickness) : [];
  const plans: StoreyPlan[] = [];
  let problem: string | null = spines.length ? null : "the house is too wide, or not deep enough, for stairs along one side.";
  // The stairs straight in from the front door, or a room's depth back with a bedroom across the front above.
  const lines = [line, ...FRONT_DEPTHS.map((d) => stairLine(opts.externalThickness, opts.risers, d)).filter((l) => V >= l.landingEnd + 1.5)];
  for (const l of lines) {
    for (const spine of spines) {
      const grounds = groundLayouts(spine, ground.spaces, V, l, opts).slice(0, 3);
      if (!grounds.length) problem = "the living spaces don't fit in a row beside the hall.";
      const uppers = upperLayouts(spine, upper, W, V, l, opts).slice(0, 3);
      if (!uppers.length) problem = "the bedrooms don't fit beside the landing.";
      for (const g of grounds) {
        for (const u of uppers) {
          const id = `storeys-${spine.tag}.${l.front ? `f${Math.round(l.foot * 10)}` : "n"}.${g.tag}.${u.tag}`;
          plans.push({
            id,
            ground: floorPlan(frame, `${id}.g`, "Hall", g),
            upper: floorPlan(frame, `${id}.u`, "Landing", u),
            stairs: stairsOf(frame, { u0: spine.stair[0], u1: spine.stair[1], v0: l.start, v1: l.top }, "v"),
            score: g.score + u.score + (1 - stacked(g, u)) * 2,
          });
        }
      }
    }
  }
  const cross = crossPlans(frame, ground, upper, opts);
  plans.push(...cross.plans);
  if (!plans.length) problem = cross.problem ?? problem;
  plans.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return { plans, problem: plans.length ? null : problem };
}

// ── Stairs across the middle ─────────────────────────────────────────────
//
//            street
//   ┌──────┬──────────────┐        ┌───────────┬──────────┐
//   │ Hall │ Living       │        │ Bedroom 2 │ Bedroom 3│   front band
//   │  ┌───┴──────────────┤        ├──┬────────┴──────────┤
//   │  │▓▓▓ stairs ▓▓▓│ WC│        │  ▓▓▓ void ▓▓▓│ Bath  │   middle: stairs and the way past
//   ├──┴──────────┬───┴───┤        ├──────────┬───┴───────┤
//   │ Kitchen /   │Utility│        │ Master   │ Ensuite   │   rear band
//   │ Dining      │       │        │          │           │
//   └─────────────┴───────┘        └──────────┴───────────┘
//            garden
//
// A hall strip runs in from the front door to a band across the middle of the
// house, where the stairs climb along it beside the way past them. Rooms fill
// a band across the front and one across the back; each opens off the hall or
// landing where its wall meets it clear of the stairs, or off the room beside
// it (a utility off the kitchen, an ensuite off its bedroom). Squarer houses
// than the spine suits, as most two-storey family houses are.

/** The hall strip in from the front door, wall centre to wall centre, m. */
const ENTRY = 1.45;
/** The band across the middle: the stairs and the way past them, m. */
const MIDDLE = roundToPrecision(HALF + STAIR_PRESET.width + PASSAGE + HALF);
/** Depths tried for the band across the front, m. */
const FRONT_BANDS = [3, 3.4, 3.8, 4.2];
/** The shallowest band of rooms across the back, m. */
const MIN_BAND = 2.6;
/** The most rooms in a band. */
const MAX_IN_BAND = 4;
/** What can take the end of the middle band past the hall or landing. */
const FAR_DOWN: ReadonlySet<RoomType> = new Set(["wc", "utility", "storage", "office"]);
const FAR_UP: ReadonlySet<RoomType> = new Set(["bathroom", "wc", "storage", "ensuite"]);

interface Cross {
  tag: string;
  /** The front band's back wall, and the middle band, along v. */
  middle: [number, number];
  /** Doors from the front band (true) or the back band can't open where the stairs run beside them. */
  stairFront: boolean;
  stair: Box;
  /** Where the hall downstairs, and the landing upstairs, end along u. */
  hallEnd: number;
  landingEnd: number;
}

function crossesFor(W: number, V: number, opts: StoreyOptions): Cross[] {
  const run = (opts.risers - 1) * STAIR_PRESET.going;
  const top = roundToPrecision(ENTRY + run);
  const hallEnd = up(top + HALF);
  const landingEnd = up(top + STAIR_PRESET.approach + HALF);
  if (landingEnd > W - opts.externalThickness / 2 - 0.2) return [];
  const out: Cross[] = [];
  for (const f of FRONT_BANDS) {
    const middle: [number, number] = [f, roundToPrecision(f + MIDDLE)];
    if (V - middle[1] < MIN_BAND - EPS) continue;
    for (const stairFront of [true, false]) {
      const v0 = roundToPrecision(stairFront ? f + HALF : middle[1] - HALF - STAIR_PRESET.width);
      out.push({ tag: `x${Math.round(f * 10)}${stairFront ? "f" : "r"}`, middle, stairFront, stair: { u0: ENTRY, u1: top, v0, v1: roundToPrecision(v0 + STAIR_PRESET.width) }, hallEnd, landingEnd });
    }
  }
  return out;
}

interface BandRules {
  /** What it costs a room to open off the hall or landing; Infinity when it can't. */
  hall: (s: SpaceSpec) => number;
  /** What it costs `child` to open off the room beside it; Infinity when it shouldn't. */
  via: (parent: SpaceSpec, child: SpaceSpec) => number;
}

const DOWN: BandRules = {
  hall: (s) => (LIVING.has(s.type) ? 0 : s.type === "office" || s.type === "wc" || s.type === "storage" ? 0.3 : s.type === "garage" ? 0.5 : s.type === "utility" ? 1 : 1.5),
  via: (parent, child) => {
    if (parent.type === "utility") return child.type === "garage" ? 0.5 : Infinity;
    if (!LIVING.has(parent.type)) return Infinity;
    if (LIVING.has(child.type)) return 0;
    if (child.type === "utility") return parent.type === "kitchen" || parent.type === "kitchen_dining" ? 0 : 2;
    return child.type === "office" ? 1 : child.type === "wc" ? 1.5 : Infinity;
  },
};

const UP: BandRules = {
  hall: (s) => (s.type === "ensuite" ? Infinity : 0),
  // An ensuite opens off its own bedroom only (nightSpaces keys it after the bedroom).
  via: (parent, child) => (child.type === "ensuite" && child.key === `${parent.key}-ensuite` ? 0 : Infinity),
};

function* orders<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) for (const rest of orders([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
}

/**
 * Rooms side by side along a band, in the order whose doors and sizes suit
 * them best: each opening off the hall where the band meets it clear of the
 * stairs (or, with `entryFirst`, the first room off the hall strip at its
 * end), or off the room beside it. Null if no order works.
 */
function bandOf(spaces: SpaceSpec[], along: [number, number], depth: [number, number], contacts: Array<[number, number]>, entryFirst: boolean, rules: BandRules, door: number): { rooms: Placed[]; score: number } | null {
  if (!spaces.length) return { rooms: [], score: 0 };
  const thickness = len(depth);
  // Every room is at least as wide as it needs across the band, once the walls are off.
  if (spaces.some((x) => thickness - SLOT_WALLS < ROOM_RULES[x.type].minWidth - 0.005)) return null;
  const mins = (list: SpaceSpec[]) => list.map((x) => Math.max(x.minWidth, clearMin(x.type, thickness)));
  if (mins(spaces).reduce((a, b) => a + b, 0) > len(along) + EPS) return null;
  let best: { rooms: Placed[]; score: number } | null = null;
  for (const order of orders(spaces)) {
    const cuts = order.length === 1 ? [0, roundToPrecision(len(along))] : distributeWidths(len(along), order, mins(order));
    if (!cuts) continue;
    const boxes = order.map((_, i): Box => ({ u0: roundToPrecision(along[0] + cuts[i]), u1: roundToPrecision(along[0] + cuts[i + 1]), v0: depth[0], v1: depth[1] }));
    if (boxes.some((b, i) => !proportionOk(order[i].type, b.u1 - b.u0, thickness))) continue;
    const reaches = (b: Box, i: number) => (entryFirst && i === 0) || contacts.some(([a, c]) => Math.min(b.u1, c) - Math.max(b.u0, a) >= door + 0.3 - EPS);
    // A cheapest tree from the hall over doors between neighbours.
    const parent: Array<number | "hall" | null> = order.map(() => null);
    let cost = 0;
    for (let added = 0; added < order.length; added++) {
      let pick: { i: number; from: number | "hall"; c: number } | null = null;
      for (let i = 0; i < order.length; i++) {
        if (parent[i] !== null) continue;
        const options: Array<{ from: number | "hall"; c: number }> = reaches(boxes[i], i) ? [{ from: "hall", c: rules.hall(order[i]) }] : [];
        for (const j of [i - 1, i + 1]) if (j >= 0 && j < order.length && parent[j] !== null) options.push({ from: j, c: rules.via(order[j], order[i]) });
        for (const o of options) if (Number.isFinite(o.c) && (!pick || o.c < pick.c)) pick = { i, ...o };
      }
      if (!pick) break;
      parent[pick.i] = pick.from;
      cost += pick.c;
    }
    if (parent.some((x) => x === null)) continue;
    const score = cost + order.reduce((sum, x, i) => sum + Math.abs(area(boxes[i]) - x.target) / Math.max(x.target, 2), 0);
    if (best && score >= best.score - EPS) continue;
    best = {
      score,
      rooms: order.map((x, i): Placed => {
        const from = parent[i]!;
        const via = from === "hall" ? "hall" : order[from].key;
        return { key: x.key, kind: x.type === "ensuite" ? "ensuite" : x.type === "storage" ? "storage" : "room", name: x.name, type: x.type, target: x.target, window: x.window, box: boxes[i], via, ...(x.type === "ensuite" ? { of: via } : {}) };
      }),
    };
  }
  return best;
}

/** Ways to split rooms between the front and back bands: every subset for the front, at most three to a band. */
function* splits<T>(items: readonly T[]): Generator<[T[], T[]]> {
  for (let mask = 0; mask < 1 << items.length; mask++) {
    const front = items.filter((_, i) => mask & (1 << i));
    const back = items.filter((_, i) => !(mask & (1 << i)));
    if (front.length && back.length && front.length <= MAX_IN_BAND && back.length <= MAX_IN_BAND) yield [front, back];
  }
}

/** Free stretches of the hall's edge along a band: all of it, or either side of the stairs. */
const edgeContacts = (end: number, stair: Box, beside: boolean): Array<[number, number]> => (beside ? [[0, stair.u0], [stair.u1, end]] : [[0, end]]);

/** How far along the hall must run for a room to have a door onto it, clear of the stairs. */
function reachEnd(room: Placed, free: Array<[number, number]>, door: number): number {
  for (const [a, c] of free) {
    const start = Math.max(room.box.u0, a);
    if (Math.min(room.box.u1, c) - start >= door + 0.3 - EPS) return start + door + 0.45;
  }
  return Infinity;
}

/** The end of the middle band past the hall or landing, and the room it takes, if it's long enough for one. */
function farRoom(space: SpaceSpec, from: number, W: number, middle: [number, number]): Placed | null {
  const box: Box = { u0: from, u1: W, v0: middle[0], v1: middle[1] };
  if (W - from < Math.max(space.minWidth, 1.2) - EPS || !proportionOk(space.type, W - from, len(middle))) return null;
  // Big enough once the walls are off.
  if ((W - from - SLOT_WALLS / 2) * (len(middle) - SLOT_WALLS / 2) < ROOM_RULES[space.type].minArea - EPS) return null;
  return { key: space.key, kind: space.type === "ensuite" ? "ensuite" : space.type === "storage" ? "storage" : "room", name: space.name, type: space.type, target: space.target, window: space.window, box, via: "hall" };
}

/** Ground floors with the stairs across the middle: the hall strip and middle band, a front band beside the strip, a back band. */
function crossGround(c: Cross, spaces: SpaceSpec[], W: number, V: number, door: number): FloorLayout[] {
  const out: FloorLayout[] = [];
  const front: [number, number] = [0, c.middle[0]];
  const back: [number, number] = [c.middle[1], V];
  const farOptions = [null, ...new Map(spaces.filter((x) => FAR_DOWN.has(x.type)).map((x) => [x.type, x])).values()];
  const cache = new Map<string, ReturnType<typeof bandOf>>();
  const band = (list: SpaceSpec[], along: [number, number], depth: [number, number], contacts: Array<[number, number]>, entryFirst: boolean) => {
    const key = `${along}|${depth}|${JSON.stringify(contacts)}|${list.map((x) => x.key).sort()}`;
    if (!cache.has(key)) cache.set(key, bandOf(list, along, depth, contacts, entryFirst, DOWN, door));
    return cache.get(key)!;
  };
  for (const far of farOptions) {
    // The hall can run on along the middle band as far as the room at its end allows.
    const limit = far ? W - Math.max(far.minWidth, 1.2) : W;
    const frontFree: Array<[number, number]> = c.stairFront ? [[c.stair.u1, limit]] : [[ENTRY, limit]];
    const backFree = edgeContacts(limit, c.stair, !c.stairFront);
    const rest = spaces.filter((x) => x !== far);
    for (const [frontSet, backSet] of splits(rest)) {
      // Living spaces with a door to the garden belong at the back, and one faces the street at the front.
      if (!backSet.some((x) => LIVING.has(x.type)) || !frontSet.some((x) => LIVING.has(x.type) || x.type === "office")) continue;
      const f = band(frontSet, [ENTRY, W], front, frontFree, true);
      const b = f && band(backSet, [0, W], back, backFree, false);
      if (!f || !b) continue;
      const needs = [...f.rooms.filter((r) => r.via === "hall" && r.box.u0 > ENTRY + EPS).map((r) => reachEnd(r, frontFree, door)), ...b.rooms.filter((r) => r.via === "hall").map((r) => reachEnd(r, backFree, door))];
      let hallEnd = up(Math.max(c.hallEnd, ...needs));
      if (hallEnd > limit + EPS) continue;
      if (!far && W - hallEnd < 1.2) hallEnd = W;
      const farPlaced = far ? farRoom(far, hallEnd, W, c.middle) : null;
      if (far && !farPlaced) continue;
      // Without a room there, what's left of the middle band is a store.
      const extra = !far && hallEnd < W ? [{ key: "cloaks", kind: "storage" as const, name: "Store", type: "storage" as const, window: "none" as const, box: { u0: hallEnd, u1: W, v0: c.middle[0], v1: c.middle[1] }, via: "hall" }] : [];
      const rooms = [...f.rooms, ...b.rooms.map((r) => (LIVING.has(r.type) ? { ...r, gardenDoor: true } : r)), ...(farPlaced ? [farPlaced] : []), ...extra];
      const hallArea = ENTRY * c.middle[0] + hallEnd * MIDDLE;
      const score = f.score + b.score + miss(farPlaced ? [farPlaced] : []) + (hallArea / (W * V)) * 25;
      out.push({ tag: `${far ? far.type[0] : "n"}${frontSet.map((x) => x.key).join("")}`, hall: { u0: 0, u1: hallEnd, v0: c.middle[0], v1: c.middle[1] }, rooms, score, entry: { u0: 0, u1: ENTRY, v0: 0, v1: c.middle[0] } });
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 3);
}

/** Upper floors with the stairs across the middle: bedrooms front and back, off the landing beside the stairwell. */
function crossUpper(c: Cross, program: Program, W: number, V: number, door: number): FloorLayout[] {
  const spaces = nightSpaces(program);
  const out: FloorLayout[] = [];
  const front: [number, number] = [0, c.middle[0]];
  const back: [number, number] = [c.middle[1], V];
  const farOptions = [null, ...new Map(spaces.filter((x) => FAR_UP.has(x.type)).map((x) => [x.type, x])).values()];
  const cache = new Map<string, ReturnType<typeof bandOf>>();
  const band = (list: SpaceSpec[], depth: [number, number], contacts: Array<[number, number]>) => {
    const key = `${depth}|${JSON.stringify(contacts)}|${list.map((x) => x.key).sort()}`;
    if (!cache.has(key)) cache.set(key, bandOf(list, [0, W], depth, contacts, false, UP, door));
    return cache.get(key)!;
  };
  for (const far of farOptions) {
    // The landing can run on along the middle band as far as the room at its end allows.
    const limit = far ? W - Math.max(far.minWidth, 1.2) : W;
    const frontFree = edgeContacts(limit, c.stair, c.stairFront);
    const backFree = edgeContacts(limit, c.stair, !c.stairFront);
    const rest = spaces.filter((x) => x !== far);
    for (const [frontSet, backSet] of splits(rest)) {
      const f = band(frontSet, front, frontFree);
      const b = f && band(backSet, back, backFree);
      if (!f || !b) continue;
      const needs = [...f.rooms.filter((r) => r.via === "hall").map((r) => reachEnd(r, frontFree, door)), ...b.rooms.filter((r) => r.via === "hall").map((r) => reachEnd(r, backFree, door))];
      let landingEnd = up(Math.max(c.landingEnd, ...needs));
      if (landingEnd > limit + EPS) continue;
      if (!far && W - landingEnd < 1.2) landingEnd = W;
      let farPlaced = far ? farRoom(far, landingEnd, W, c.middle) : null;
      if (far && !farPlaced) continue;
      const extra = !far && landingEnd < W ? [{ key: "linen", kind: "storage" as const, name: "Store", type: "storage" as const, window: "none" as const, box: { u0: landingEnd, u1: W, v0: c.middle[0], v1: c.middle[1] }, via: "hall" }] : [];
      // An ensuite at the end of the middle band opens off the bedroom beside it.
      if (farPlaced?.type === "ensuite") {
        const bedroom = [...f.rooms, ...b.rooms].find((r) => farPlaced!.key === `${r.key}-ensuite` && Math.min(r.box.u1, W) - Math.max(r.box.u0, landingEnd) >= door + 0.3);
        if (!bedroom) continue;
        farPlaced = { ...farPlaced, via: bedroom.key, of: bedroom.key };
      }
      const rooms = [...f.rooms, ...b.rooms, ...(farPlaced ? [farPlaced] : []), ...extra];
      const master = rooms.find((r) => r.type === "primary_bedroom");
      // The master bedroom on the garden side, and the biggest bedroom.
      const quiet = (master && master.box.v0 >= c.middle[1] - EPS ? 0 : 0.5) + (master && rooms.some((r) => r.type === "bedroom" && area(r.box) > area(master.box) + 0.2) ? 2 : 0);
      const score = f.score + b.score + miss(farPlaced ? [farPlaced] : []) + quiet + ((landingEnd * MIDDLE) / (W * V)) * 25;
      out.push({ tag: `${far ? far.type[0] : "n"}${frontSet.map((x) => x.key).join("")}`, hall: { u0: 0, u1: landingEnd, v0: c.middle[0], v1: c.middle[1] }, rooms, score });
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 3);
}

/** Plans with the stairs across the middle, each way round. */
function crossPlans(frame: Frame, ground: Program, upper: Program, opts: StoreyOptions): { plans: StoreyPlan[]; problem: string | null } {
  const { W, V } = frame;
  const plans: StoreyPlan[] = [];
  let problem: string | null = null;
  for (const c of crossesFor(W, V, opts)) {
    const grounds = crossGround(c, ground.spaces, W, V, opts.doorWidth);
    if (!grounds.length) problem = "the living spaces don't fit round the hall.";
    const uppers = grounds.length ? crossUpper(c, upper, W, V, opts.doorWidth) : [];
    if (grounds.length && !uppers.length) problem = "the bedrooms don't fit round the landing.";
    for (const g of grounds) {
      for (const u of uppers) {
        for (const [side, f] of [["a", frame], ["b", mirrored(frame)]] as const) {
          const id = `storeys-${side}.${c.tag}.${g.tag}.${u.tag}`;
          plans.push({
            id,
            ground: floorPlan(f, `${id}.g`, "Hall", g),
            upper: floorPlan(f, `${id}.u`, "Landing", u),
            stairs: stairsOf(f, c.stair, "u"),
            score: g.score + u.score + (1 - stacked(g, u)) * 2,
          });
        }
      }
    }
  }
  return { plans, problem };
}

/** House sizes, outside dimensions, that suit two-storey layouts of the rooms: the floor needing more length sets the depth. */
export function storeyFootprints(ground: Program, upper: Program, opts: { externalThickness: number; doorWidth: number; risers: number; plot?: { maxWidth?: number; maxDepth?: number } }): Array<{ width: number; depth: number; key: string }> {
  const t = opts.externalThickness;
  const line = stairLine(t, opts.risers);
  const s = spineWidth(t);
  const night = nightSpaces(upper);
  const step = 0.5;
  const ceil = (v: number) => Math.ceil(v / step - 1e-9) * step;
  const out: Array<{ width: number; depth: number; area: number }> = [];
  for (const column of [3.6, 4.2, 4.8, 5.4, 6.0, 6.6]) {
    // Downstairs, the WC and utility go behind the hall; upstairs, the bathroom behind the landing.
    const groundRow = ground.spaces.filter((x) => !BEHIND_HALL.has(x.type));
    const groundLength = groundRow.reduce((sum, x) => sum + Math.max(x.minWidth, clearMin(x.type, column), x.target / column), 0);
    const bath = night.find((x) => x.type === "bathroom");
    const ensuite = night.find((x) => x.type === "ensuite");
    const bandLength = (list: SpaceSpec[]) => list.reduce((sum, x) => sum + Math.max(slotMin(x, column, opts.doorWidth, x.type !== "ensuite"), x.target / column), 0);
    // Every bedroom beside the landing with the bathroom behind it, or the biggest bedroom across the front and the ensuite behind.
    const beside = bandLength(night.filter((x) => x !== bath));
    const biggest = [...night].filter((x) => x.type === "bedroom" || x.type === "primary_bedroom").sort((a, b) => b.target - a.target)[0];
    const frontDepth = biggest ? Math.max(FRONT_DEPTHS[0], biggest.target / (s + column)) : 0;
    const across = biggest ? frontDepth + bandLength(night.filter((x) => x !== biggest && x !== (ensuite ?? bath))) : Infinity;
    const upperLength = Math.min(beside, across);
    const length = Math.max(groundLength, upperLength, line.landingEnd + 2);
    const width = ceil(s + column + t);
    const depth = ceil(length + 0.2 + t);
    if (Math.max(width, depth) / Math.min(width, depth) > 2.2) continue;
    if ((opts.plot?.maxWidth && width > opts.plot.maxWidth + EPS) || (opts.plot?.maxDepth && depth > opts.plot.maxDepth + EPS)) continue;
    if (!out.some((o) => o.width === width && o.depth === depth)) out.push({ width, depth, area: width * depth });
  }
  // Stairs across the middle: bands front and back across the whole width, as deep as the rooms need.
  const total = (list: SpaceSpec[]) => list.reduce((sum, x) => sum + x.target, 0) * 1.12;
  for (let width = 6.5; width <= 11 + EPS; width += 0.5) {
    const W = width - t;
    for (const f of FRONT_BANDS) {
      const back = Math.max(MIN_BAND, (total(night) - W * f) / W, (total(ground.spaces) - (W - ENTRY) * f) / W);
      const depth = ceil(f + MIDDLE + back + 0.1 + t);
      if (Math.max(width, depth) / Math.min(width, depth) > 1.8) continue;
      if ((opts.plot?.maxWidth && width > opts.plot.maxWidth + EPS) || (opts.plot?.maxDepth && depth > opts.plot.maxDepth + EPS)) continue;
      if (!out.some((o) => o.width === width && o.depth === depth)) out.push({ width, depth, area: width * depth });
    }
  }
  out.sort((a, b) => a.area - b.area || a.width - b.width);
  if (!out.length) return [];
  // Within a little of the smallest: the most square, the widest and the deepest.
  const near = out.filter((o) => o.area <= out[0].area * 1.15 + EPS);
  const picks = [
    [...near].sort((a, b) => Math.abs(Math.log(a.width / a.depth)) - Math.abs(Math.log(b.width / b.depth)) || a.area - b.area)[0],
    [...near].sort((a, b) => b.width / b.depth - a.width / a.depth || a.area - b.area)[0],
    [...near].sort((a, b) => a.width / a.depth - b.width / b.depth || a.area - b.area)[0],
    ...out,
  ];
  const result: Array<{ width: number; depth: number; key: string }> = [];
  for (const p of picks) if (!result.some((r) => r.width === p.width && r.depth === p.depth)) result.push({ width: p.width, depth: p.depth, key: `${p.width}x${p.depth}` });
  // A few a size up from each, since the estimate is rough: the caller tries them in turn until enough fit.
  for (const p of [...result]) {
    for (const [dw, dd] of [[0, 0.5], [0.5, 0], [0.5, 0.5], [0, 1]]) {
      const width = p.width + dw;
      const depth = p.depth + dd;
      if ((opts.plot?.maxWidth && width > opts.plot.maxWidth + EPS) || (opts.plot?.maxDepth && depth > opts.plot.maxDepth + EPS)) continue;
      if (!result.some((r) => r.width === width && r.depth === depth)) result.push({ width, depth, key: `${width}x${depth}` });
    }
  }
  return result;
}
