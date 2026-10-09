import { EPS, roundToPrecision } from "../geometry/numeric";
import type { EnvelopeSide } from "../geometry/outline";
import type { Rect } from "../geometry/vector";
import type { RoomType } from "../plan/types";
import { shapeOf, type Footprint, type PlotLimits } from "./footprint";
import type { Program, SpaceSpec } from "./program";
import { ENSUITE_TARGET, ROOM_RULES } from "./roomRules";
import { distributeWidths, type LabeledRoom, type LayoutPlan } from "./wingLayout";

/**
 * Zone layouts for rectangular houses: a day zone and a night zone side by
 * side, each running from the street to the garden.
 *
 *            street
 *   ┌──────────────┬─────┬──────────────┐
 *   │ Living       │Entry│ Bedroom 3    │
 *   ├──────────────┤  │  ├──────────────┤
 *   │ Dining       │ hall│ Bathroom     │   day zone: rooms open onto each
 *   ├──────────────┤  │  ├──────────────┤   other, one door from the entry
 *   │ Kitchen      │Store├──────────────┤   night zone: a short hall from
 *   │   ↓ garden   │     │ Master       │   the front door to the bedrooms
 *   └──────────────┴─────┴──────────────┘
 *            garden
 *
 * The front door opens into the hall at the street end of the night zone.
 * The hall is single-loaded (bedrooms on the outside wall, the hall along
 * the day zone) or double-loaded (bathrooms on the inner side, where they
 * need no window, and an entry at the street end reaching the day zone).
 * It stops at the last room it serves; a linen store fills the rest of its
 * strip. The day zone is one row of rooms from street to garden, joined by
 * doors in the order that suits them best (kitchen beside dining, the
 * utility off the kitchen), with garden doors from the room at the garden
 * end. The ensuite has its own slot beside the master bedroom, so the master
 * stays a rectangle.
 *
 * Everything is in the house's own frame: u along the street front, v from
 * the street (0) to the garden. Pure and deterministic.
 */

export interface ZoneOptions {
  hallWidth: number;
  doorWidth: number;
  rearSide: EnvelopeSide;
}

interface Box {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

interface Frame {
  /** Along the street front, m. */
  W: number;
  /** From the street to the garden, m. */
  V: number;
  world: (b: Box) => Rect;
}

interface Placed {
  key: string;
  kind: LabeledRoom["kind"];
  name: string;
  type: RoomType;
  target?: number;
  window: SpaceSpec["window"];
  box: Box;
  via: string;
  of?: string;
  links?: string[];
  gardenDoor?: boolean;
}

interface ZoneLayout {
  /** Distinguishes layouts of the same zone, for stable ids. */
  tag: string;
  rooms: Placed[];
  halls: Box[];
  /** The stretch along v where the night zone's hall meets the day zone. */
  contact: [number, number];
  /** Lower is better. */
  score: number;
}

const GRID = 0.05;
const snap = (v: number) => roundToPrecision(Math.round(v / GRID) * GRID);
const len = (r: [number, number]) => r[1] - r[0];
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

const LIVING: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining"]);
/** Rooms that can do without a window: lit and aired some other way. */
const INNER: ReadonlySet<RoomType> = new Set(["bathroom", "wc", "ensuite", "storage", "utility"]);
/** Band thicknesses tried for bedrooms on the outside wall, and for bathrooms on the inner side, m. */
const OUTER_BANDS = [3.2, 3.6, 4.0, 4.4];
const INNER_BANDS = [2.0, 2.4, 2.8, 3.2];
/** Longest entrance hall at the street end of a double-loaded hall, and the most floor a coat cupboard takes, m and m². */
const MAX_ENTRY = 3;
const COATS = 2.5;
/** A bedroom on the inner side needs at least this thickness of band, m. */
const INNER_BEDROOM = 2.8;
/** Longest day zone laid out as a single row of rooms, m. */
const MAX_DAY_WIDTH = 6.4;
const MIN_DAY_WIDTH = 3.1;

function frameOf(r: Rect, rear: EnvelopeSide): Frame {
  const across = rear === "north" || rear === "south";
  const W = across ? r.maxX - r.minX : r.maxY - r.minY;
  const V = across ? r.maxY - r.minY : r.maxX - r.minX;
  const point = (u: number, v: number) =>
    rear === "north" ? { x: r.minX + u, y: r.minY + v }
    : rear === "south" ? { x: r.maxX - u, y: r.maxY - v }
    : rear === "east" ? { x: r.minX + v, y: r.maxY - u }
    : { x: r.maxX - v, y: r.minY + u };
  const world = (b: Box): Rect => {
    const p = point(b.u0, b.v0);
    const q = point(b.u1, b.v1);
    return { minX: roundToPrecision(Math.min(p.x, q.x)), maxX: roundToPrecision(Math.max(p.x, q.x)), minY: roundToPrecision(Math.min(p.y, q.y)), maxY: roundToPrecision(Math.max(p.y, q.y)) };
  };
  return { W: roundToPrecision(W), V: roundToPrecision(V), world };
}

/** The night zone's rooms with an ensuite as its own space beside its bedroom. */
function nightSpaces(program: Program): SpaceSpec[] {
  const out: SpaceSpec[] = [];
  for (const s of program.spaces.filter((x) => x.zone === "night")) {
    out.push({ ...s, ensuite: false });
    if (s.ensuite) out.push({ key: `${s.key}-ensuite`, type: "ensuite", name: "Ensuite", target: ENSUITE_TARGET, minWidth: 1.6, zone: "night", window: "small", ensuite: false });
  }
  return out;
}

const rank = (s: SpaceSpec) => ({ utility: 0, wc: 0.5, bathroom: 1, office: 1.5, bedroom: 2, ensuite: 4, primary_bedroom: 5 })[s.type as string] ?? 3;

/** Night rooms from the street to the garden: bathrooms, bedrooms smallest first, then the ensuite and master at the garden end. */
function nightOrders(spaces: SpaceSpec[]): SpaceSpec[][] {
  const sorted = [...spaces].sort((a, b) => rank(a) - rank(b) || a.target - b.target || a.key.localeCompare(b.key));
  const orders = [sorted];
  // A bedroom on the street, then the bathrooms.
  const firstBed = sorted.findIndex((s) => s.type === "bedroom");
  if (firstBed > 0) orders.push([sorted[firstBed], ...sorted.filter((_, i) => i !== firstBed)]);
  return orders;
}

/**
 * The narrowest slot a room may take along a band of the given thickness:
 * its own minimum, room for its door to the hall, and wide enough not to be
 * a corridor (a WC in a deep band becomes a cloakroom rather than a slot).
 */
function slotMin(s: SpaceSpec, thickness: number, door: number, viaHall: boolean): number {
  return Math.max(s.minWidth, viaHall ? door + 0.3 : 0, clearMin(s.type, thickness));
}

/** The shortest a room may run beside a given width and still keep its proportion and floor area. */
const clearMin = (type: RoomType, across: number) => {
  const rule = ROOM_RULES[type];
  return Math.max((across - WALLS) / rule.maxProportion, rule.minArea / Math.max(across - WALLS, 0.5)) + WALLS + 0.05;
};

/** Wall centre to wall centre, less the walls: roughly the clear size a room ends up with, m. */
const WALLS = 0.2;
/** Whether a slot's clear floor stays within its room type's proportion. */
const proportionOk = (type: RoomType, a: number, b: number) => Math.max(a, b) - WALLS <= (Math.min(a, b) - WALLS) * ROOM_RULES[type].maxProportion + EPS;

/** Rooms cut from a band along v, in order; null if they don't fit or one would be too long and narrow. */
function slotBand(spaces: SpaceSpec[], u: [number, number], v: [number, number], door: number, via: (s: SpaceSpec) => string): Placed[] | null {
  const thickness = len(u);
  const mins = spaces.map((s) => slotMin(s, thickness, door, via(s) === "hall"));
  const cuts = spaces.length === 1 ? [0, roundToPrecision(len(v))] : distributeWidths(len(v), spaces, mins);
  if (!cuts) return null;
  const out: Placed[] = [];
  for (const [i, s] of spaces.entries()) {
    const v0 = roundToPrecision(v[0] + cuts[i]);
    const v1 = roundToPrecision(v[0] + cuts[i + 1]);
    const width = v1 - v0;
    if (!proportionOk(s.type, width, thickness)) return null;
    const box: Box = { u0: u[0], u1: u[1], v0, v1 };
    out.push({
      key: s.key,
      kind: s.type === "ensuite" ? "ensuite" : s.type === "storage" ? "storage" : "room",
      name: s.name,
      type: s.type,
      target: s.target,
      window: s.window,
      box,
      via: via(s),
      ...(s.type === "ensuite" ? { of: via(s) } : {}),
    });
  }
  return out;
}

/**
 * The inner side of a double-loaded hall: its rooms, and a coat store by the
 * entry taking whatever length they don't need, so a lone bathroom doesn't
 * stretch the length of the house.
 */
function innerBand(spaces: SpaceSpec[], u: [number, number], entry: number, V: number, door: number, via: (s: SpaceSpec) => string): { rooms: Placed[]; entry: number } | null {
  const thickness = len(u);
  const natural = spaces.reduce((sum, s) => sum + Math.max(slotMin(s, thickness, door, via(s) === "hall"), s.target / thickness), 0);
  let left = V - entry - natural;
  if (left >= 1.5) {
    // Spare length makes a proper entrance hall and a coat cupboard rather than inflating the rooms.
    const grow = snap(Math.min(left - 0.9, MAX_ENTRY - entry));
    const start = roundToPrecision(entry + Math.max(0, grow));
    left -= Math.max(0, grow);
    const coats: SpaceSpec = { key: "coats", type: "storage", name: "Store", target: Math.min(left, COATS / thickness) * thickness, minWidth: 0.9, zone: "night", window: "none", ensuite: false };
    const rooms = slotBand([coats, ...spaces], u, [start, V], door, via);
    if (rooms) return { rooms, entry: start };
  }
  const rooms = slotBand(spaces, u, [entry, V], door, via);
  return rooms ? { rooms, entry } : null;
}

/** Where the hall can stop: just past the start of the last room it serves, leaving room for that room's door. */
function hallEnd(rooms: Placed[], V: number, door: number): number {
  const last = Math.max(0, ...rooms.filter((r) => r.via === "hall").map((r) => r.box.v0));
  const end = snap(last + door + 0.45);
  return V - end < 0.9 ? V : end;
}

/** A night zone with the hall along the day zone and bedrooms on the outside wall. */
function singleNight(spaces: SpaceSpec[], u: [number, number], dayLow: boolean, V: number, opts: ZoneOptions): ZoneLayout[] {
  const h = opts.hallWidth;
  const hallU: [number, number] = dayLow ? [u[0], u[0] + h] : [u[1] - h, u[1]];
  const bandU: [number, number] = dayLow ? [u[0] + h, u[1]] : [u[0], u[1] - h];
  if (len(bandU) < 3 - EPS || len(bandU) > 4.6 + EPS) return [];
  const master = spaces.find((s) => s.type === "primary_bedroom");
  const out: ZoneLayout[] = [];
  for (const [oi, order] of nightOrders(spaces).entries()) {
    const rooms = slotBand(order, bandU, [0, V], opts.doorWidth, (s) => (s.type === "ensuite" && master ? master.key : "hall"));
    if (!rooms) continue;
    out.push({ ...finishNight(rooms, [], hallU, V, opts), tag: `s${Math.round(len(bandU) * 10)}o${oi}` });
  }
  return out;
}

/** A night zone with bathrooms on the inner side of the hall, bedrooms on the outside wall, and an entry reaching the day zone. */
function doubleNight(spaces: SpaceSpec[], u: [number, number], dayLow: boolean, V: number, opts: ZoneOptions): ZoneLayout[] {
  const h = opts.hallWidth;
  const out: ZoneLayout[] = [];
  const master = spaces.find((s) => s.type === "primary_bedroom");
  const via = (s: SpaceSpec) => (s.type === "ensuite" && master ? master.key : "hall");
  for (const inner of INNER_BANDS) {
    const outer = len(u) - h - inner;
    if (outer < 3 - EPS || outer > 4.6 + EPS) continue;
    const innerU: [number, number] = dayLow ? [u[0], u[0] + inner] : [u[1] - inner, u[1]];
    const hallU: [number, number] = dayLow ? [u[0] + inner, u[0] + inner + h] : [u[1] - inner - h, u[1] - inner];
    const outerU: [number, number] = dayLow ? [u[0] + inner + h, u[1]] : [u[0], u[1] - inner - h];
    // The entry: the street end of the inner band, opening to the day zone.
    const entry = snap(Math.max(1.8, opts.doorWidth + 0.9));
    for (const [oi, order] of nightOrders(spaces).entries()) {
      // Bathrooms on the inner side; bedrooms, the ensuite and the master on the outside wall.
      const innerSpaces = order.filter((s) => INNER.has(s.type) && s.type !== "ensuite");
      let outerSpaces = order.filter((s) => !innerSpaces.includes(s));
      const fits = (list: SpaceSpec[], thickness: number, length: number) => list.reduce((sum, s) => sum + slotMin(s, thickness, opts.doorWidth, via(s) === "hall"), 0) <= length + EPS;
      // A bedroom moves to the garden end of the inner side if the outside wall is too short.
      let gardenBed: SpaceSpec | null = null;
      if (!fits(outerSpaces, outer, V)) {
        gardenBed = outerSpaces.find((s) => s.type === "bedroom") ?? null;
        if (!gardenBed) continue;
        outerSpaces = outerSpaces.filter((s) => s !== gardenBed);
        if (!fits(outerSpaces, outer, V)) continue;
      }
      // Also try a bedroom at the garden end of the inner side when the outside wall has room to spare.
      const spare = gardenBed ? null : outerSpaces.filter((s) => s.type === "bedroom").sort((a, b) => a.target - b.target)[0];
      for (const moved of [gardenBed, ...(spare ? [spare] : [])]) {
        if (moved && inner < INNER_BEDROOM - EPS) continue;
        const outerList = moved && !gardenBed ? outerSpaces.filter((s) => s !== moved) : outerSpaces;
        const innerList = moved ? [...innerSpaces, moved] : innerSpaces;
        if (!innerList.length) continue;
        const outerRooms = slotBand(outerList, outerU, [0, V], opts.doorWidth, via);
        const inside = innerBand(innerList, innerU, entry, V, opts.doorWidth, via);
        if (!outerRooms || !inside) continue;
        const entryBox: Box = { u0: innerU[0], u1: innerU[1], v0: 0, v1: inside.entry };
        const layout = finishNight([...outerRooms, ...inside.rooms], [entryBox], hallU, V, opts);
        // The day zone is reached from the entry only.
        out.push({ ...layout, tag: `d${Math.round(inner * 10)}-${Math.round(outer * 10)}o${oi}${moved ? "m" : ""}`, contact: [0, inside.entry], score: layout.score + 0.5 });
      }
    }
  }
  return out;
}

/** The hall strip along the night zone up to where it's needed, a linen store beyond it, and a score. */
function finishNight(rooms: Placed[], extraHalls: Box[], hallU: [number, number], V: number, opts: ZoneOptions): ZoneLayout {
  const end = hallEnd(rooms, V, opts.doorWidth);
  const strip: Box = { u0: roundToPrecision(hallU[0]), u1: roundToPrecision(hallU[1]), v0: 0, v1: end };
  const all = [...rooms];
  if (end < V - EPS) all.push({ key: "linen", kind: "storage", name: "Store", type: "storage", window: "none", box: { ...strip, v0: end, v1: V }, via: "hall" });
  let miss = 0;
  for (const r of rooms) if (r.target) miss += Math.abs((r.box.u1 - r.box.u0) * (r.box.v1 - r.box.v0) - r.target) / Math.max(r.target, 2);
  // A master on the garden side, away from the street, is quieter.
  const master = rooms.find((r) => r.type === "primary_bedroom");
  const quiet = master && master.box.v1 >= V - EPS ? 0 : 0.5;
  return { tag: "", rooms: all, halls: [strip, ...extraHalls], contact: [0, end], score: miss + quiet };
}

const PARENT: ReadonlySet<RoomType> = LIVING;

/** What it costs for `child` to open off `parent` (the hall, or another day room); Infinity when it shouldn't. */
function edgeCost(parent: RoomType | "hall", child: RoomType, rootTaken: boolean): number {
  if (parent === "hall") {
    if (LIVING.has(child)) return rootTaken ? 2 : 0;
    return child === "office" || child === "wc" || child === "storage" ? 0.3 : child === "garage" ? 0.5 : child === "utility" ? 1 : 1.5;
  }
  if (parent === "utility") return child === "garage" ? 0.5 : Infinity;
  if (!PARENT.has(parent)) return Infinity;
  if (LIVING.has(child)) return 0;
  if (child === "utility") return parent === "kitchen" || parent === "kitchen_dining" ? 0 : 2;
  if (child === "office") return 1;
  if (child === "wc") return 1.5;
  return Infinity;
}

/**
 * The day zone as one row of rooms from the street to the garden, in the
 * order whose doors and positions suit the rooms best; null if no order
 * works.
 */
function dayRow(spaces: SpaceSpec[], u: [number, number], V: number, contact: [number, number], opts: ZoneOptions): ZoneLayout | null {
  const width = len(u);
  if (!spaces.length) return { tag: "", rooms: [], halls: [], contact, score: 0 };
  const mins = (list: SpaceSpec[]) => list.map((s) => Math.max(s.minWidth, clearMin(s.type, width)));
  let best: ZoneLayout | null = null;
  for (const order of permutations(spaces)) {
    const cuts = order.length === 1 ? [0, roundToPrecision(V)] : distributeWidths(V, order, mins(order));
    if (!cuts) continue;
    const boxes = order.map((_, i): Box => ({ u0: u[0], u1: u[1], v0: roundToPrecision(cuts[i]), v1: roundToPrecision(cuts[i + 1]) }));
    if (boxes.some((b, i) => !proportionOk(order[i].type, width, b.v1 - b.v0))) continue;
    // Access: a cheapest tree from the hall over doors between neighbours, and from the hall where a room meets it.
    const reach = (b: Box) => overlap(b.v0, b.v1, contact[0], contact[1]) >= opts.doorWidth + 0.3 - EPS;
    const parent: Array<number | "hall" | null> = order.map(() => null);
    let cost = 0;
    let rootTaken = false;
    for (let added = 0; added < order.length; added++) {
      let pick: { i: number; from: number | "hall"; c: number } | null = null;
      for (let i = 0; i < order.length; i++) {
        if (parent[i] !== null) continue;
        const options: Array<{ from: number | "hall"; c: number }> = [];
        if (reach(boxes[i])) options.push({ from: "hall", c: edgeCost("hall", order[i].type, rootTaken) });
        for (const j of [i - 1, i + 1]) if (j >= 0 && j < order.length && parent[j] !== null) options.push({ from: j, c: edgeCost(order[j].type, order[i].type, rootTaken) });
        for (const o of options) if (Number.isFinite(o.c) && (!pick || o.c < pick.c)) pick = { i, ...o };
      }
      if (!pick) break;
      parent[pick.i] = pick.from;
      cost += pick.c;
      if (pick.from === "hall" && LIVING.has(order[pick.i].type)) rootTaken = true;
    }
    if (parent.some((p) => p === null)) continue;
    let score = cost;
    // Living spaces want the garden end (garden doors), the garage the street.
    const last = order[order.length - 1];
    if (!LIVING.has(last.type)) score += 4;
    const garage = order.findIndex((s) => s.type === "garage");
    if (garage > 0) score += 1.5;
    for (const [i, s] of order.entries()) score += Math.abs(width * (boxes[i].v1 - boxes[i].v0) - s.target) / Math.max(s.target, 2) * 0.5;
    if (best && score >= best.score - EPS) continue;
    const rooms: Placed[] = order.map((s, i) => {
      const p = parent[i]!;
      const links: string[] = [];
      // A kitchen reached from the hall still opens into the room beside it where people eat.
      if (s.type === "kitchen") {
        for (const j of [i - 1, i + 1]) if (j >= 0 && j < order.length && j !== p && LIVING.has(order[j].type) && parent[j] !== i) links.push(order[j].key);
      }
      return {
        key: s.key,
        kind: s.type === "storage" ? "storage" : "room",
        name: s.name,
        type: s.type,
        target: s.target,
        window: s.window,
        box: boxes[i],
        via: p === "hall" ? "hall" : order[p].key,
        ...(links.length ? { links } : {}),
        ...(LIVING.has(s.type) && i === order.length - 1 ? { gardenDoor: true } : {}),
      };
    });
    best = { tag: "", rooms, halls: [], contact, score };
  }
  return best;
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
  }
}

/**
 * Zone layouts for a rectangle, best first. Each is a set of labelled
 * rectangles with an access graph; the emitter turns them into walls, rooms
 * and openings.
 */
export function planZones(axis: Rect, program: Program, opts: ZoneOptions): { plans: LayoutPlan[]; problem: string | null } {
  const frame = frameOf(axis, opts.rearSide);
  const night0 = nightSpaces(program);
  if (!night0.length) return { plans: [], problem: "there are no bedrooms or bathrooms to make a night zone of." };
  const plans: LayoutPlan[] = [];
  let problem: string | null = null;
  // A study and a utility work in either zone: off the hall with the bedrooms (the utility on the
  // inner side, where it needs no window), or with the living spaces.
  const flexible = program.spaces.filter((s) => s.type === "office" || s.type === "utility");
  for (let mask = 0; mask < 1 << flexible.length; mask++) {
    const moved = flexible.filter((_, i) => mask & (1 << i));
    const day = program.spaces.filter((s) => s.zone === "day" && !moved.includes(s));
    const night = [...night0, ...moved.map((s) => ({ ...s, zone: "night" as const }))];
    if (day.length > 7) {
      problem ??= "there are too many day rooms for one row.";
      continue;
    }
    const variant = moved.map((s) => (s.type === "office" ? "q" : "u")).join("");
    problem = zonePlans(frame, day, night, opts, variant, plans) ?? problem;
  }
  plans.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return { plans, problem: plans.length ? null : problem };
}

/** Zone layouts for one split of the rooms into day and night, added to `plans`; why none fit, if none did. */
function zonePlans(frame: Frame, day: SpaceSpec[], night: SpaceSpec[], opts: ZoneOptions, variant: string, plans: LayoutPlan[]): string | null {
  const { W, V } = frame;
  let problem: string | null = `the house is too narrow (${W.toFixed(1)} m) for a row of living spaces beside the bedrooms and their hall.`;
  let widthFits = false;
  // Each width once: double-loaded zones try every inner and outer band that adds up to it.
  const nightWidths = [
    ...OUTER_BANDS.map((t) => ({ loading: "s" as const, width: snap(opts.hallWidth + t) })),
    ...[...new Set(INNER_BANDS.flatMap((i) => OUTER_BANDS.map((t) => snap(opts.hallWidth + i + t))))].map((width) => ({ loading: "d" as const, width })),
  ];
  for (const dayLow of [true, false]) {
    for (const { loading, width } of nightWidths) {
      const dayWidth = roundToPrecision(W - width);
      if (dayWidth < MIN_DAY_WIDTH - EPS || dayWidth > MAX_DAY_WIDTH + EPS) continue;
      if (!widthFits) [widthFits, problem] = [true, null];
      const dayU: [number, number] = dayLow ? [0, dayWidth] : [W - dayWidth, W];
      const nightU: [number, number] = dayLow ? [dayWidth, W] : [0, W - dayWidth];
      const nights = loading === "s" ? singleNight(night, nightU, dayLow, V, opts) : doubleNight(night, nightU, dayLow, V, opts);
      if (!nights.length) {
        problem ??= "the bedrooms don't fit along the house.";
        continue;
      }
      for (const n of nights) {
        const d = dayRow(day, dayU, V, n.contact, opts);
        if (!d) {
          // Further along than the bedrooms not fitting, so the better reason.
          problem = "the living spaces can't all be reached in a row beside the bedrooms.";
          continue;
        }
        const placed = [...d.rooms, ...n.rooms];
        const hallArea = n.halls.reduce((sum, b) => sum + (b.u1 - b.u0) * (b.v1 - b.v0), 0);
        const rooms: LabeledRoom[] = [
          { key: "hall", kind: "hall", name: "Hall", type: "hall", window: "none", rects: n.halls.map(frame.world) },
          ...placed.map((p): LabeledRoom => ({
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
          })),
        ];
        const id = `zones-${dayLow ? "l" : "r"}.${n.tag}${variant}`;
        plans.push({ id, arrangement: "zones", entrance: "hall", cornerDoors: true, rooms, fringe: [], notes: [], score: d.score + n.score + (hallArea / (W * V)) * 25 });
      }
    }
  }
  return problem;
}

/**
 * House sizes that suit a zone layout of the program, outside dimensions in
 * metres (width along the street, depth to the garden): the day zone's row
 * and the night zone's bands, each as long as its rooms need, side by side.
 * The smallest, the widest and the deepest that work, as for strip layouts.
 */
export function zoneFootprints(program: Program, opts: { hallWidth: number; doorWidth: number; externalThickness: number; plot?: PlotLimits }): Footprint[] {
  const night = nightSpaces(program);
  const day = program.spaces.filter((s) => s.zone === "day");
  if (!night.length) return [];
  const natural = (list: SpaceSpec[], thickness: number) => list.reduce((sum, s) => sum + Math.max(slotMin(s, thickness, opts.doorWidth, s.type !== "ensuite"), s.target / thickness), 0);
  const utilities = day.filter((s) => s.type === "utility");
  const inner = night.filter((s) => INNER.has(s.type) && s.type !== "ensuite");
  const outer = night.filter((s) => !inner.includes(s));
  const nights = [
    ...OUTER_BANDS.map((t) => ({ width: opts.hallWidth + t, length: natural(night, t), day })),
    // Double-loaded zones take the utility on the inner side, with the entry and a coat cupboard.
    ...INNER_BANDS.flatMap((i) => OUTER_BANDS.map((t) => ({ width: opts.hallWidth + i + t, length: Math.max(natural(outer, t), 1.8 + 0.9 + natural([...inner, ...utilities], i)), day: day.filter((s) => s.type !== "utility") }))),
  ];
  const step = 0.5;
  const up = (v: number) => Math.ceil(v / step - 1e-9) * step;
  const sizes = new Map<string, { width: number; depth: number; area: number }>();
  for (const n of nights) {
    for (const dayWidth of [3.6, 4.2, 4.8, 5.4, 6.0]) {
      const dayLength = n.day.reduce((sum, s) => sum + Math.max(s.minWidth, clearMin(s.type, dayWidth), s.target / dayWidth), 0);
      const width = up(dayWidth + n.width + opts.externalThickness);
      const depth = up(Math.max(n.length, dayLength) + 0.2 + opts.externalThickness);
      if (Math.max(width, depth) / Math.min(width, depth) > 2.2 + EPS) continue;
      if ((opts.plot?.maxWidth && width > opts.plot.maxWidth + EPS) || (opts.plot?.maxDepth && depth > opts.plot.maxDepth + EPS)) continue;
      sizes.set(`${width}x${depth}`, { width, depth, area: width * depth });
    }
  }
  const all = [...sizes.values()].sort((a, b) => a.area - b.area || a.width - b.width);
  if (!all.length) return [];
  // Within a little of the smallest: the most square, the widest and the deepest.
  const near = all.filter((o) => o.area <= all[0].area * 1.15 + EPS);
  const picks = [
    [...near].sort((a, b) => Math.abs(Math.log(a.width / a.depth)) - Math.abs(Math.log(b.width / b.depth)) || a.area - b.area)[0],
    [...near].sort((a, b) => b.width / b.depth - a.width / a.depth || a.area - b.area)[0],
    [...near].sort((a, b) => a.width / a.depth - b.width / b.depth || a.area - b.area)[0],
  ];
  const out: Footprint[] = [];
  for (const p of picks) if (p && !out.some((o) => o.width === p.width && o.depth === p.depth)) out.push({ width: p.width, depth: p.depth, shape: shapeOf(p.width, p.depth) });
  return out;
}
