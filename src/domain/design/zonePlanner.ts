import { EPS, roundToPrecision } from "../geometry/numeric";
import type { EnvelopeSide } from "../geometry/outline";
import type { Ring } from "../geometry/polygons";
import type { Rect } from "../geometry/vector";
import type { Point2, RoomType } from "../plan/types";
import { shapeOf, type Footprint, type PlotLimits } from "./footprint";
import type { Program, SpaceSpec } from "./program";
import { clearMin, ENSUITE_TARGET, proportionOk } from "./roomRules";
import { distributeWidths, type LabeledRoom, type LayoutPlan } from "./wingLayout";
import { programGraph } from "./concept/programGraph";

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
 * The front door opens into the hall at the street end of the night zone,
 * or (direct entry) into the living space at the street end of the day zone:
 * then a bedroom or study takes the street end of the night zone, and its
 * hall starts behind that room, opening off a living space beside it, so the
 * bedrooms are reached through the living spaces by a short inner hall.
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
  /** The brief wants the kitchen at the garden end (`kitchen_faces_garden`). */
  kitchenGarden?: boolean;
  /** The brief wants the master bedroom private (`primary_bedroom_private`): on the quiet garden side, never by the front door. */
  primaryPrivate?: boolean;
  /** The brief wants the utility through the kitchen (`utility_near_kitchen`). */
  utilityNearKitchen?: boolean;
}

/** What it costs a plan to put the master anywhere but the quiet garden end, by whether the brief asks for privacy (the program graph's). */
export const quietCost = (opts: Pick<ZoneOptions, "primaryPrivate">) => programGraph(opts).quiet;

export interface Box {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export interface Frame {
  /** Along the street front, m. */
  W: number;
  /** From the street to the garden, m. */
  V: number;
  world: (b: Box) => Rect;
  /** A world point in the house's frame. */
  local: (p: { x: number; y: number }) => { u: number; v: number };
}

export interface Placed {
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

export interface ZoneLayout {
  /** Distinguishes layouts of the same zone, for stable ids. */
  tag: string;
  rooms: Placed[];
  halls: Box[];
  /** The stretch along v where the night zone's hall meets the day zone. */
  contact: [number, number];
  /** Lower is better. */
  score: number;
  /** Direct entry: the front door opens into the day zone, and the hall opens off a living space. */
  direct?: boolean;
}

const GRID = 0.05;
export const snap = (v: number) => roundToPrecision(Math.round(v / GRID) * GRID);
const up = (v: number) => roundToPrecision(Math.ceil(v / GRID - 1e-9) * GRID);
const len = (r: [number, number]) => r[1] - r[0];
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

const LIVING: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining"]);
const KITCHENS: ReadonlySet<RoomType> = new Set(["kitchen", "kitchen_dining"]);
/** Rooms that can do without a window: lit and aired some other way. */
const INNER: ReadonlySet<RoomType> = new Set(["bathroom", "wc", "ensuite", "storage", "utility"]);
/** Band thicknesses tried for bedrooms on the outside wall, and for bathrooms on the inner side, m. */
const OUTER_BANDS = [3.2, 3.6, 4.0, 4.4];
const INNER_BANDS = [2.0, 2.4, 2.8, 3.2];
/** Longest entrance hall at the street end of a double-loaded hall, and the most floor a coat cupboard takes, m and m². */
const MAX_ENTRY = 3;
const COATS = 2.5;
/** The least floor, m², the end of a hall strip needs to become a walk-in wardrobe rather than a linen cupboard. */
const WARDROBE = 2.5;
/** A bedroom on the inner side needs at least this thickness of band, m. */
const INNER_BEDROOM = 2.8;
/** Longest day zone laid out as a single row of rooms, m. */
export const MAX_DAY_WIDTH = 6.4;
export const MIN_DAY_WIDTH = 3.1;

export function frameOf(r: Rect, rear: EnvelopeSide): Frame {
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
  const local = (p: { x: number; y: number }) =>
    rear === "north" ? { u: p.x - r.minX, v: p.y - r.minY }
    : rear === "south" ? { u: r.maxX - p.x, v: r.maxY - p.y }
    : rear === "east" ? { u: r.maxY - p.y, v: p.x - r.minX }
    : { u: p.y - r.minY, v: r.maxX - p.x };
  return { W: roundToPrecision(W), V: roundToPrecision(V), world, local };
}

/** The night zone's rooms with an ensuite as its own space beside its bedroom. */
export function nightSpaces(program: Program): SpaceSpec[] {
  const out: SpaceSpec[] = [];
  for (const s of program.spaces.filter((x) => x.zone === "night")) {
    out.push({ ...s, ensuite: false });
    if (s.ensuite) out.push({ key: `${s.key}-ensuite`, type: "ensuite", name: "Ensuite", target: ENSUITE_TARGET, minWidth: 1.6, zone: "night", window: "small", ensuite: false });
  }
  return out;
}

/** A walk-in wardrobe off the master bedroom, beyond it at the garden end (the ensuite takes the other side). */
const DRESSING = "dressing";
const rank = (s: SpaceSpec) => (s.key === DRESSING ? 6 : ({ utility: 0, wc: 0.5, bathroom: 1, office: 1.5, bedroom: 2, ensuite: 4, primary_bedroom: 5 })[s.type as string] ?? 3);

/** Night rooms from the street to the garden: bathrooms, bedrooms smallest first, then the ensuite and master at the garden end. */
export function nightOrders(spaces: SpaceSpec[]): SpaceSpec[][] {
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
export function slotMin(s: SpaceSpec, thickness: number, door: number, viaHall: boolean): number {
  return Math.max(s.minWidth, viaHall ? door + 0.3 : 0, clearMin(s.type, thickness));
}





/** Rooms cut from a band along v, in order; null if they don't fit or one would be too long and narrow. */
export function slotBand(spaces: SpaceSpec[], u: [number, number], v: [number, number], door: number, via: (s: SpaceSpec) => string): Placed[] | null {
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
function innerBand(spaces: SpaceSpec[], u: [number, number], entry: number, v1: number, door: number, via: (s: SpaceSpec) => string): { rooms: Placed[]; entry: number } | null {
  const thickness = len(u);
  const natural = spaces.reduce((sum, s) => sum + Math.max(slotMin(s, thickness, door, via(s) === "hall"), s.target / thickness), 0);
  let left = v1 - entry - natural;
  if (left >= 1.5) {
    // Spare length makes a proper entrance hall and a coat cupboard rather than inflating the rooms.
    const grow = snap(Math.min(left - 0.9, MAX_ENTRY - entry));
    const start = roundToPrecision(entry + Math.max(0, grow));
    left -= Math.max(0, grow);
    const coats: SpaceSpec = { key: "coats", type: "storage", name: "Store", target: Math.min(left, COATS / thickness) * thickness, minWidth: 0.9, zone: "night", window: "none", ensuite: false };
    const rooms = slotBand([coats, ...spaces], u, [start, v1], door, via);
    if (rooms) return { rooms, entry: start };
  }
  const rooms = slotBand(spaces, u, [entry, v1], door, via);
  return rooms ? { rooms, entry } : null;
}

/** Where the hall can stop: just past the start of the last room it serves, leaving room for that room's door. */
function hallEnd(rooms: Placed[], v: [number, number], door: number): number {
  const last = Math.max(v[0], ...rooms.filter((r) => r.via === "hall").map((r) => r.box.v0));
  const end = snap(last + door + 0.45);
  return v[1] - end < 0.9 ? v[1] : end;
}

/** A night zone with the hall along the day zone and bedrooms on the outside wall. */
function singleNight(spaces: SpaceSpec[], u: [number, number], dayLow: boolean, v: [number, number], opts: ZoneOptions): ZoneLayout[] {
  const h = opts.hallWidth;
  const hallU: [number, number] = dayLow ? [u[0], u[0] + h] : [u[1] - h, u[1]];
  const bandU: [number, number] = dayLow ? [u[0] + h, u[1]] : [u[0], u[1] - h];
  if (len(bandU) < 3 - EPS || len(bandU) > 4.6 + EPS) return [];
  const master = spaces.find((s) => s.type === "primary_bedroom");
  const out: ZoneLayout[] = [];
  for (const [oi, order] of nightOrders(spaces).entries()) {
    const rooms = slotBand(order, bandU, v, opts.doorWidth, (s) => ((s.type === "ensuite" || s.key === DRESSING) && master ? master.key : "hall"));
    if (!rooms) continue;
    out.push({ ...finishNight(rooms, [], hallU, v, opts), tag: `s${Math.round(len(bandU) * 10)}o${oi}` });
  }
  return out;
}

/** A night zone with bathrooms on the inner side of the hall, bedrooms on the outside wall, and an entry reaching the day zone. */
function doubleNight(spaces: SpaceSpec[], u: [number, number], dayLow: boolean, v: [number, number], opts: ZoneOptions): ZoneLayout[] {
  const h = opts.hallWidth;
  const out: ZoneLayout[] = [];
  const master = spaces.find((s) => s.type === "primary_bedroom");
  const via = (s: SpaceSpec) => ((s.type === "ensuite" || s.key === DRESSING) && master ? master.key : "hall");
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
      if (!fits(outerSpaces, outer, len(v))) {
        gardenBed = outerSpaces.find((s) => s.type === "bedroom") ?? null;
        if (!gardenBed) continue;
        outerSpaces = outerSpaces.filter((s) => s !== gardenBed);
        if (!fits(outerSpaces, outer, len(v))) continue;
      }
      // Also try a bedroom at the garden end of the inner side when the outside wall has room to spare.
      const spare = gardenBed ? null : outerSpaces.filter((s) => s.type === "bedroom").sort((a, b) => a.target - b.target)[0];
      for (const moved of [gardenBed, ...(spare ? [spare] : [])]) {
        if (moved && inner < INNER_BEDROOM - EPS) continue;
        const outerList = moved && !gardenBed ? outerSpaces.filter((s) => s !== moved) : outerSpaces;
        const innerList = moved ? [...innerSpaces, moved] : innerSpaces;
        if (!innerList.length) continue;
        const outerRooms = slotBand(outerList, outerU, v, opts.doorWidth, via);
        const inside = innerBand(innerList, innerU, v[0] + entry, v[1], opts.doorWidth, via);
        if (!outerRooms || !inside) continue;
        const entryBox: Box = { u0: innerU[0], u1: innerU[1], v0: v[0], v1: inside.entry };
        const layout = finishNight([...outerRooms, ...inside.rooms], [entryBox], hallU, v, opts);
        // The day zone is reached from the entry only.
        out.push({ ...layout, tag: `d${Math.round(inner * 10)}-${Math.round(outer * 10)}o${oi}${moved ? "m" : ""}`, contact: [v[0], inside.entry], score: layout.score + 0.5 });
      }
    }
  }
  return out;
}

/**
 * Night zones for direct entry: a room across the street end (a study, the
 * smallest bedroom, or a master without an ensuite), then the night zone
 * behind it laid out as usual, single- or double-loaded, its hall starting
 * behind that room. The hall doesn't reach the front door; it opens off a
 * living space beside it (double-loaded, through the lobby at the street end
 * of the inner band). A front room that would have to grow past 1.6 times
 * its size to span the zone isn't offered.
 */
function directNights(spaces: SpaceSpec[], u: [number, number], dayLow: boolean, v: [number, number], opts: ZoneOptions, loading: "s" | "d"): ZoneLayout[] {
  const width = len(u);
  const bedrooms = spaces.filter((s) => s.type === "bedroom").sort((a, b) => a.target - b.target || a.key.localeCompare(b.key));
  // Not the master when the brief wants it private: the front room shares a wall with the living space by the front door.
  const master = opts.primaryPrivate ? undefined : spaces.find((s) => s.type === "primary_bedroom" && !spaces.some((e) => e.type === "ensuite" && e.key === `${s.key}-ensuite`));
  const fronts = [spaces.find((s) => s.type === "office"), bedrooms[0], master].filter((s): s is SpaceSpec => !!s);
  const out: ZoneLayout[] = [];
  for (const front of fronts) {
    const depth = up(Math.max(front.minWidth, clearMin(front.type, width), front.target / width));
    if (!proportionOk(front.type, width, depth) || width * depth > front.target * 1.6) continue;
    const start = roundToPrecision(v[0] + depth);
    const rest = spaces.filter((s) => s !== front);
    const behind = loading === "s" ? singleNight(rest, u, dayLow, [start, v[1]], opts) : doubleNight(rest, u, dayLow, [start, v[1]], opts);
    const frontRoom: Placed = { key: front.key, kind: "room", name: front.name, type: front.type, target: front.target, window: front.window, box: { u0: u[0], u1: u[1], v0: v[0], v1: start }, via: "hall" };
    const miss = Math.abs(width * depth - front.target) / Math.max(front.target, 2);
    for (const n of behind) out.push({ ...n, rooms: [frontRoom, ...n.rooms], score: n.score + miss, tag: `e${front.type === "office" ? "q" : front.type === "primary_bedroom" ? "m" : "b"}${n.tag}`, direct: true });
  }
  return out;
}

/** What it costs the front door to open into a day room; Infinity where it shouldn't. */
function entryCost(type: RoomType): number {
  return type === "living" || type === "kitchen_dining" ? 0 : type === "dining" ? 0.5 : type === "kitchen" ? 1.5 : Infinity;
}

/** What it costs the bedrooms' hall to open off a day room, for direct entry; Infinity where it shouldn't. */
function hallParentCost(type: RoomType): number {
  return type === "living" ? 0 : type === "dining" ? 0.5 : type === "kitchen_dining" ? 0.7 : type === "kitchen" ? 2 : Infinity;
}

/** The hall strip along the night zone up to where it's needed, a linen store beyond it, and a score. */
function finishNight(rooms: Placed[], extraHalls: Box[], hallU: [number, number], v: [number, number], opts: ZoneOptions): ZoneLayout {
  const end = hallEnd(rooms, v, opts.doorWidth);
  const strip: Box = { u0: roundToPrecision(hallU[0]), u1: roundToPrecision(hallU[1]), v0: v[0], v1: end };
  const all = [...rooms];
  if (end < v[1] - EPS) {
    // Beyond the last door: a walk-in wardrobe for the bedroom beside it when it's big enough to be one, else a linen cupboard off the hall.
    const box: Box = { ...strip, v0: end, v1: v[1] };
    const beside = (r: Placed) => r.box.v0 <= end + EPS && r.box.v1 >= v[1] - EPS && (Math.abs(r.box.u0 - strip.u1) < EPS || Math.abs(r.box.u1 - strip.u0) < EPS);
    const owner = rooms.find((r) => r.type === "primary_bedroom" && beside(r)) ?? rooms.find((r) => r.type === "bedroom" && beside(r));
    const wardrobe = owner && (box.u1 - box.u0) * (box.v1 - box.v0) >= WARDROBE;
    all.push(wardrobe ? { key: "wardrobe", kind: "storage", name: "Wardrobe", type: "storage", window: "none", box, via: owner.key } : { key: "linen", kind: "storage", name: "Store", type: "storage", window: "none", box, via: "hall" });
  }
  let miss = 0;
  for (const r of rooms) if (r.target) miss += Math.abs((r.box.u1 - r.box.u0) * (r.box.v1 - r.box.v0) - r.target) / Math.max(r.target, 2);
  // A master on the garden side, away from the street, is quieter (with only its own wardrobe beyond it).
  const master = rooms.find((r) => r.type === "primary_bedroom");
  const dressing = rooms.find((r) => r.key === DRESSING);
  const atEnd = (r: Placed) => r.box.v1 >= v[1] - EPS;
  const quiet = master && (atEnd(master) || (dressing && atEnd(dressing) && dressing.box.v0 >= master.box.v1 - EPS)) ? 0 : quietCost(opts);
  return { tag: "", rooms: all, halls: [strip, ...extraHalls], contact: [v[0], end], score: miss + quiet };
}

/**
 * The day zone as one row of rooms from the street to the garden, in the
 * order whose doors and positions suit the rooms best; null if no order
 * works.
 */
export function dayRow(spaces: SpaceSpec[], u: [number, number], v: [number, number], contact: [number, number], opts: ZoneOptions, entryFirst = false): ZoneLayout | null {
  const width = len(u);
  if (!spaces.length) return { tag: "", rooms: [], halls: [], contact, score: 0 };
  // Which room may open off which, and what the placements are worth: the program's graph.
  const graph = programGraph(opts);
  const mins = (list: SpaceSpec[]) => list.map((s) => Math.max(s.minWidth, clearMin(s.type, width)));
  let best: ZoneLayout | null = null;
  for (const order of permutations(spaces)) {
    const cuts = order.length === 1 ? [0, roundToPrecision(len(v))] : distributeWidths(len(v), order, mins(order));
    if (!cuts) continue;
    const boxes = order.map((_, i): Box => ({ u0: u[0], u1: u[1], v0: roundToPrecision(v[0] + cuts[i]), v1: roundToPrecision(v[0] + cuts[i + 1]) }));
    if (boxes.some((b, i) => !proportionOk(order[i].type, width, b.v1 - b.v0))) continue;
    // Access: a cheapest tree from the hall over doors between neighbours, and from the hall where a room meets it;
    // with direct entry, from the front door into the room at the street end instead of from the hall.
    const reach = (b: Box) => !entryFirst && overlap(b.v0, b.v1, contact[0], contact[1]) >= opts.doorWidth + 0.3 - EPS;
    const parent: Array<number | "hall" | "entry" | null> = order.map(() => null);
    let cost = 0;
    let rootTaken = false;
    for (let added = 0; added < order.length; added++) {
      let pick: { i: number; from: number | "hall" | "entry"; c: number } | null = null;
      for (let i = 0; i < order.length; i++) {
        if (parent[i] !== null) continue;
        const options: Array<{ from: number | "hall" | "entry"; c: number }> = [];
        if (reach(boxes[i])) options.push({ from: "hall", c: graph.down("hall", order[i].type, rootTaken) });
        if (entryFirst && i === 0 && added === 0) options.push({ from: "entry", c: entryCost(order[i].type) });
        for (const j of [i - 1, i + 1]) if (j >= 0 && j < order.length && parent[j] !== null) options.push({ from: j, c: graph.down(order[j].type, order[i].type, rootTaken) });
        for (const o of options) if (Number.isFinite(o.c) && (!pick || o.c < pick.c)) pick = { i, ...o };
      }
      if (!pick) break;
      parent[pick.i] = pick.from;
      cost += pick.c;
      if (pick.from === "hall" && LIVING.has(order[pick.i].type)) rootTaken = true;
    }
    if (parent.some((p) => p === null)) continue;
    let score = cost;
    // Living spaces want the garden end (garden doors), the garage the street; the kitchen, if the brief asks.
    const last = order[order.length - 1];
    if (!LIVING.has(last.type)) score += graph.livingAway;
    if (order.some((s) => KITCHENS.has(s.type)) && !KITCHENS.has(last.type)) score += graph.kitchenAway;
    const garage = order.findIndex((s) => s.type === "garage");
    if (garage > 0) score += graph.garageBack;
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
        via: p === "hall" || p === "entry" ? p : order[p].key,
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
 * Rooms that work in either zone: a study, and a utility (on the bedrooms'
 * inner side, where it needs no window) unless the brief wants it through
 * the kitchen.
 */
const flexibleSpaces = (program: Program, opts: ZoneOptions) => program.spaces.filter((s) => s.type === "office" || (s.type === "utility" && !opts.utilityNearKitchen));

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
  const flexible = flexibleSpaces(program, opts);
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

/**
 * Zone layouts for a house of two columns side by side, each running from
 * the street towards the garden but to different depths (an L with its legs
 * that way round, as the planner draws when the bedrooms need more depth than
 * the living spaces). One column takes the day zone, the other the night
 * zone; the day zone is reached where the hall meets it. Empty, with a
 * reason, for outlines of any other kind.
 */
export function planZoneColumns(ring: Ring, program: Program, opts: ZoneOptions): { plans: LayoutPlan[]; problem: string | null } {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const frame = frameOf({ minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }, opts.rearSide);
  const columns = columnsOf(ring.map(frame.local));
  if (!columns) return { plans: [], problem: "the house isn't two or three wings side by side running back from the street." };
  if (columns.length === 3) return splitWingPlans(frame, columns, program, opts);
  const night0 = nightSpaces(program);
  if (!night0.length) return { plans: [], problem: "there are no bedrooms or bathrooms to make a night zone of." };
  const plans: LayoutPlan[] = [];
  let problem: string | null = null;
  const flexible = flexibleSpaces(program, opts);
  for (let mask = 0; mask < 1 << flexible.length; mask++) {
    const moved = flexible.filter((_, i) => mask & (1 << i));
    const day = program.spaces.filter((s) => s.zone === "day" && !moved.includes(s));
    const night = [...night0, ...moved.map((s) => ({ ...s, zone: "night" as const }))];
    if (day.length > 7) continue;
    const variant = moved.map((s) => (s.type === "office" ? "q" : "u")).join("");
    for (const [dayIndex, nightIndex] of [[0, 1], [1, 0]] as const) {
      const dayZone = columns[dayIndex];
      if (len(dayZone.u) < MIN_DAY_WIDTH - EPS || len(dayZone.u) > MAX_DAY_WIDTH + EPS) {
        problem ??= "neither wing is the right width for a row of living spaces.";
        continue;
      }
      problem = pairPlans(frame, day, night, dayZone, columns[nightIndex], dayIndex === 0, ["s", "d"], opts, `zones-${dayIndex === 0 ? "l" : "r"}.L.`, variant, plans) ?? problem;
    }
  }
  plans.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return { plans, problem: plans.length ? null : problem };
}

/**
 * The columns an outline splits into across the street front: two (an L
 * with its legs running back) or three (a U, or a T with its bar on the
 * street); null if it isn't rectangles side by side, each touching the next
 * for a metre or more.
 */
function columnsOf(points: Array<{ u: number; v: number }>): Zone[] | null {
  const us = [...new Set(points.map((p) => roundToPrecision(p.u)))].sort((a, b) => a - b);
  if (us.length !== 3 && us.length !== 4) return null;
  const column = (u0: number, u1: number): Zone | null => {
    // The v extent of the outline along the column's middle.
    const mid = (u0 + u1) / 2;
    const crossings = points
      .map((p, i) => [p, points[(i + 1) % points.length]] as const)
      .filter(([p, q]) => Math.abs(p.v - q.v) < EPS && Math.min(p.u, q.u) < mid && Math.max(p.u, q.u) > mid)
      .map(([p]) => p.v)
      .sort((a, b) => a - b);
    return crossings.length === 2 ? { u: [u0, u1], v: [roundToPrecision(crossings[0]), roundToPrecision(crossings[1])] } : null;
  };
  const columns: Zone[] = [];
  for (let i = 0; i + 1 < us.length; i++) {
    const c = column(us[i], us[i + 1]);
    if (!c) return null;
    columns.push(c);
  }
  // Rectangles that fill the outline exactly, and touch along each cut.
  const area = Math.abs(points.reduce((sum, p, i) => sum + p.u * points[(i + 1) % points.length].v - points[(i + 1) % points.length].u * p.v, 0)) / 2;
  if (Math.abs(columns.reduce((sum, c) => sum + len(c.u) * len(c.v), 0) - area) > 0.01) return null;
  for (let i = 0; i + 1 < columns.length; i++) if (Math.min(columns[i].v[1], columns[i + 1].v[1]) - Math.max(columns[i].v[0], columns[i + 1].v[0]) < 1) return null;
  return columns;
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
      const dayZone: Zone = { u: dayLow ? [0, dayWidth] : [W - dayWidth, W], v: [0, V] };
      const nightZone: Zone = { u: dayLow ? [dayWidth, W] : [0, W - dayWidth], v: [0, V] };
      problem = pairPlans(frame, day, night, dayZone, nightZone, dayLow, [loading], opts, `zones-${dayLow ? "l" : "r"}.`, variant, plans) ?? problem;
    }
  }
  return problem;
}

/** A rectangle of the house given to one zone, in the house's frame. */
interface Zone {
  u: [number, number];
  v: [number, number];
}

/**
 * Zone layouts with the night zone in one given rectangle and the day zone in
 * another beside it, added to `plans`; why none fit, if none did. The day
 * zone is reached where the night zone's hall (or entry) meets it.
 */
function pairPlans(frame: Frame, day: SpaceSpec[], night: SpaceSpec[], dayZone: Zone, nightZone: Zone, dayLow: boolean, loadings: ReadonlyArray<"s" | "d">, opts: ZoneOptions, idPrefix: string, variant: string, plans: LayoutPlan[]): string | null {
  let problem: string | null = null;
  const before = plans.length;
  // Where the two zones share a wall.
  const shared: [number, number] = [Math.max(dayZone.v[0], nightZone.v[0]), Math.min(dayZone.v[1], nightZone.v[1])];
  // Each night zone with its hall at the front door, and with a room across the street end and the front door into the day zone.
  const nights = loadings.flatMap((l) => [
    ...(l === "s" ? singleNight(night, nightZone.u, dayLow, nightZone.v, opts) : doubleNight(night, nightZone.u, dayLow, nightZone.v, opts)),
    ...directNights(night, nightZone.u, dayLow, nightZone.v, opts, l),
  ]);
  if (!nights.length) return "the bedrooms don't fit along the house.";
  const area = (len(dayZone.u) * len(dayZone.v)) + (len(nightZone.u) * len(nightZone.v));
  for (const n of nights) {
    const contact: [number, number] = [Math.max(n.contact[0], shared[0]), Math.min(n.contact[1], shared[1])];
    if (contact[1] - contact[0] < opts.doorWidth + 0.3) {
      problem = "the hall doesn't meet the living spaces.";
      continue;
    }
    const d = dayRow(day, dayZone.u, dayZone.v, contact, opts, !!n.direct);
    if (!d) {
      // Further along than the bedrooms not fitting, so the better reason.
      problem = "the living spaces can't all be reached in a row beside the bedrooms.";
      continue;
    }
    // Direct entry: the front door into the day room at the street end, and the hall off the living space beside it that suits it best.
    const entrance = n.direct ? d.rooms.find((p) => p.via === "entry")?.key : "hall";
    const hallVia = n.direct
      ? d.rooms
          .map((p) => ({ p, c: hallParentCost(p.type), reach: overlap(p.box.v0, p.box.v1, contact[0], contact[1]) }))
          .filter((x) => Number.isFinite(x.c) && x.reach >= opts.doorWidth + 0.3 - EPS)
          .sort((a, b) => a.c - b.c || b.reach - a.reach)[0]?.p.key
      : undefined;
    if (!entrance || (n.direct && !hallVia)) {
      problem = "the bedrooms' hall doesn't meet a living space.";
      continue;
    }
    const placed = [...d.rooms, ...n.rooms];
    const hallArea = n.halls.reduce((sum, b) => sum + (b.u1 - b.u0) * (b.v1 - b.v0), 0);
    const rooms: LabeledRoom[] = [
      { key: "hall", kind: "hall", name: "Hall", type: "hall", window: "none", rects: n.halls.map(frame.world), ...(hallVia ? { via: hallVia } : {}) },
      ...placed.map((p): LabeledRoom => ({
        key: p.key,
        kind: p.kind,
        name: p.name,
        type: p.type,
        ...(p.target !== undefined && p.kind !== "storage" ? { target: p.target } : {}),
        window: p.window,
        rects: [frame.world(p.box)],
        ...((p.via !== "hall" && p.via !== "entry") || p.kind === "ensuite" ? { via: p.via } : {}),
        ...(p.of ? { of: p.of } : {}),
        ...(p.links ? { links: p.links } : {}),
        ...(p.gardenDoor ? { gardenDoor: true } : {}),
      })),
    ];
    plans.push({ id: `${idPrefix}${n.tag}${variant}`, arrangement: "zones", entrance, cornerDoors: true, rooms, fringe: [], notes: [], score: d.score + n.score + (hallArea / area) * 25 });
  }
  return plans.length > before ? null : problem;
}

/**
 * The night rooms split between two bedroom wings: the master suite in one
 * (alone, or with the smallest bedroom or the study as a nursery or office
 * beside it), everything else in the other; without a master, the bedrooms
 * shared out, the bathrooms with the larger share. Each wing has a bedroom.
 */
export function splitNights(night: SpaceSpec[]): Array<[SpaceSpec[], SpaceSpec[]]> {
  const master = night.find((s) => s.type === "primary_bedroom");
  const out: Array<[SpaceSpec[], SpaceSpec[]]> = [];
  const bed = (s: SpaceSpec) => s.type === "bedroom" || s.type === "primary_bedroom";
  const ok = ([a, b]: [SpaceSpec[], SpaceSpec[]]) => a.some(bed) && b.some(bed);
  if (master) {
    const suite = night.filter((s) => s === master || s.key === `${master.key}-ensuite`);
    const rest = night.filter((s) => !suite.includes(s));
    out.push([suite, rest]);
    const extra = [...rest.filter((s) => s.type === "office"), ...rest.filter((s) => s.type === "bedroom").sort((a, b) => a.target - b.target)][0];
    if (extra && rest.filter(bed).length > (extra.type === "bedroom" ? 1 : 0)) out.push([[...suite, extra], rest.filter((s) => s !== extra)]);
  } else {
    const beds = night.filter(bed).sort((a, b) => b.target - a.target || a.key.localeCompare(b.key));
    const half = beds.filter((_, i) => i % 2 === 1);
    out.push([half, night.filter((s) => !half.includes(s))]);
  }
  return out.filter(ok);
}

/** U and T houses offered per shape, smallest first. */
const SPLIT_FOOTPRINTS = 8;

/** Night zones of a wing worth pairing up, best first. */
const WING_NIGHTS = 3;

/**
 * Split-bedroom layouts for a house of three columns: a bedroom wing either
 * side of the living spaces (a U, or a T with its bar on the street), the
 * master suite away from the other bedrooms. The front door opens into one
 * wing's hall, the other wing's hall opening off a living space; or (direct
 * entry) into the living spaces, both halls opening off them.
 */
function splitWingPlans(frame: Frame, columns: Zone[], program: Program, opts: ZoneOptions): { plans: LayoutPlan[]; problem: string | null } {
  const [left, dayZone, right] = columns;
  if (len(dayZone.u) < MIN_DAY_WIDTH - EPS || len(dayZone.u) > MAX_DAY_WIDTH + EPS) return { plans: [], problem: "the middle of the house isn't the right width for a row of living spaces." };
  const night0 = nightSpaces(program);
  if (!night0.length) return { plans: [], problem: "there are no bedrooms or bathrooms to make a night zone of." };
  const plans: LayoutPlan[] = [];
  let problem: string | null = "the bedrooms can't be split between the two wings.";
  const area = columns.reduce((sum, c) => sum + len(c.u) * len(c.v), 0);
  const flexible = flexibleSpaces(program, opts);
  // Where each wing shares a wall with the living spaces.
  const sharedWith = (z: Zone): [number, number] => [Math.max(z.v[0], dayZone.v[0]), Math.min(z.v[1], dayZone.v[1])];
  const clip = (c: [number, number], z: Zone): [number, number] => {
    const s = sharedWith(z);
    return [Math.max(c[0], s[0]), Math.min(c[1], s[1])];
  };
  const reaches = (c: [number, number]) => c[1] - c[0] >= opts.doorWidth + 0.3 - EPS;
  /** Whether a room down the middle reaches an outside wall: an end of the row, or a side where the wing beside it stops (a T's stem). */
  const lit = (b: Box) => {
    if (b.v0 <= dayZone.v[0] + EPS || b.v1 >= dayZone.v[1] - EPS) return true;
    const open = (z: Zone) => b.v1 - Math.max(b.v0, z.v[1]) >= 1.2 - EPS || Math.min(b.v1, z.v[0]) - b.v0 >= 1.2 - EPS;
    return open(left) || open(right);
  };
  /** The living space a wing's hall opens off, cheapest first. */
  const parentOf = (rooms: Placed[], contact: [number, number]) =>
    rooms
      .map((p) => ({ p, c: hallParentCost(p.type), reach: overlap(p.box.v0, p.box.v1, contact[0], contact[1]) }))
      .filter((x) => Number.isFinite(x.c) && x.reach >= opts.doorWidth + 0.3 - EPS)
      .sort((a, b) => a.c - b.c || b.reach - a.reach)[0]?.p.key;
  const nightsOf = (spaces: SpaceSpec[], z: Zone, dayLow: boolean) =>
    withFiller(spaces, z)
      .flatMap((list, fi) => [...singleNight(list, z.u, dayLow, z.v, opts), ...doubleNight(list, z.u, dayLow, z.v, opts)].map((n) => (fi ? { ...n, tag: `${n.tag}w` } : n)))
      .sort((a, b) => a.score - b.score || a.tag.localeCompare(b.tag))
      .slice(0, WING_NIGHTS);
  /**
   * A wing's rooms, and, where they leave a metre and a half or more of its
   * length spare, the same with a walk-in wardrobe off the master (or a store
   * off the hall) taking some of it, rather than every room growing.
   */
  const withFiller = (spaces: SpaceSpec[], z: Zone): SpaceSpec[][] => {
    const thickness = len(z.u) - opts.hallWidth;
    const used = spaces.reduce((sum, s) => sum + Math.max(slotMin(s, thickness, opts.doorWidth, s.type !== "ensuite"), s.target / thickness), 0);
    const slack = len(z.v) - used;
    if (slack < 1.5) return [spaces];
    const master = spaces.find((s) => s.type === "primary_bedroom");
    // At most 2.4 m of the wing: a walk-in wardrobe, or a dressing room once it's that big; the rooms take the rest.
    const length = Math.min(slack, 2.4);
    const name = master ? (length * thickness >= 6 ? "Dressing Room" : "Wardrobe") : "Store";
    const filler: SpaceSpec = { key: master ? DRESSING : "wing-store", type: "storage", name, target: length * thickness, minWidth: 0.9, zone: "night", window: "none", ensuite: false };
    return [spaces, [...spaces, filler]];
  };

  for (let mask = 0; mask < 1 << flexible.length; mask++) {
    const moved = flexible.filter((_, i) => mask & (1 << i));
    const day = program.spaces.filter((s) => s.zone === "day" && !moved.includes(s));
    if (day.length > 7) continue;
    const variant = moved.map((s) => (s.type === "office" ? "q" : "u")).join("");
    const night = [...night0, ...moved.map((s) => ({ ...s, zone: "night" as const }))];
    for (const [si, [suite, rest]] of splitNights(night).entries()) {
      // The suite on either side.
      for (const suiteLeft of [true, false]) {
        const a = nightsOf(suiteLeft ? suite : rest, left, false);
        const b = nightsOf(suiteLeft ? rest : suite, right, true);
        if (!a.length || !b.length) {
          problem = "the bedrooms don't fit along the wings.";
          continue;
        }
        for (const na of a) {
          for (const nb of b) {
            // Front door into the left wing's hall, the right wing's, or straight into the living spaces:
            // the same walls whichever, so only the best way in is kept.
            let bestPlan: LayoutPlan | null = null;
            for (const mode of ["l", "r", "e"] as const) {
              const main = mode === "r" ? nb : na;
              const other = mode === "r" ? na : nb;
              const mainZone = mode === "r" ? right : left;
              const otherZone = mode === "r" ? left : right;
              const mainContact = clip(main.contact, mainZone);
              const otherContact = clip(other.contact, otherZone);
              if (!reaches(otherContact) || (mode !== "e" && !reaches(mainContact))) {
                problem = "a wing's hall doesn't meet the living spaces.";
                continue;
              }
              const d = dayRow(day, dayZone.u, dayZone.v, mode === "e" ? [0, 0] : mainContact, opts, mode === "e");
              if (!d) {
                problem = "the living spaces can't all be reached in a row between the wings.";
                continue;
              }
              if (!d.rooms.every((p) => p.window === "none" || lit(p.box))) {
                problem = "a living space between the wings would have no outside wall for a window.";
                continue;
              }
              const entrance = mode === "e" ? d.rooms.find((p) => p.via === "entry")?.key : "hall";
              const mainVia = mode === "e" ? parentOf(d.rooms, mainContact) : undefined;
              const otherVia = parentOf(d.rooms, otherContact);
              if (!entrance || !otherVia || (mode === "e" && !mainVia)) {
                problem = "a wing's hall doesn't meet a living space.";
                continue;
              }
              // The second wing's rooms open off its own hall.
              const second = other.rooms.map((r) => (r.via === "hall" ? { ...r, via: "hall2" } : r));
              const placed = [...d.rooms, ...main.rooms, ...second];
              const hallArea = [...main.halls, ...other.halls].reduce((sum, h) => sum + (h.u1 - h.u0) * (h.v1 - h.v0), 0);
              const rooms: LabeledRoom[] = [
                { key: "hall", kind: "hall", name: "Hall", type: "hall", window: "none", rects: main.halls.map(frame.world), ...(mainVia ? { via: mainVia } : {}) },
                { key: "hall2", kind: "hall", name: "Hall", type: "hall", window: "none", rects: other.halls.map(frame.world), via: otherVia },
                ...placed.map((p): LabeledRoom => ({
                  key: p.key,
                  kind: p.kind,
                  name: p.name,
                  type: p.type,
                  ...(p.target !== undefined && p.kind !== "storage" ? { target: p.target } : {}),
                  window: p.window,
                  rects: [frame.world(p.box)],
                  ...((p.via !== "hall" && p.via !== "entry") || p.kind === "ensuite" ? { via: p.via } : {}),
                  ...(p.of ? { of: p.of } : {}),
                  ...(p.links ? { links: p.links } : {}),
                  ...(p.gardenDoor ? { gardenDoor: true } : {}),
                })),
              ];
              const id = `zones-c.${mode}${si}${suiteLeft ? "a" : "b"}.${na.tag}.${nb.tag}${variant}`;
              const plan: LayoutPlan = { id, arrangement: "zones", entrance, cornerDoors: true, rooms, fringe: [], notes: [], score: d.score + na.score + nb.score + (hallArea / area) * 25 };
              if (!bestPlan || plan.score < bestPlan.score - EPS) bestPlan = plan;
            }
            if (bestPlan) plans.push(bestPlan);
          }
        }
      }
    }
  }
  plans.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return { plans, problem: plans.length ? null : problem };
}

/** A house size for zone layouts: a rectangle, an L of two columns, or a U or T of three (with its outline). */
export interface ZoneFootprint extends Footprint {
  /** Outside faces, counterclockwise, street to the south; absent for a rectangle. */
  outline?: Point2[];
  /** The outline's shape, when there is one. */
  kind?: "L" | "U" | "T";
  /** Identifies the house across requests, e.g. "10.5x11" or "L:10x13:9.5:5". */
  key: string;
}

/**
 * House sizes that suit a zone layout of the program, outside dimensions in
 * metres (width along the street, depth to the garden): the day zone's row
 * and the night zone's bands, each as long as its rooms need, side by side.
 * Rectangles take the longer of the two; with `shapes`, where the two differ
 * by a room's depth or more, an L lets each zone stop where its rooms do.
 * The smallest, the widest and the deepest that work, as for strip layouts,
 * and then the two smallest Ls.
 */
export function zoneFootprints(program: Program, opts: { hallWidth: number; doorWidth: number; externalThickness: number; plot?: PlotLimits; shapes?: "rectangle" | "L" | "both" | "U" | "T" }): ZoneFootprint[] {
  if (opts.shapes === "U" || opts.shapes === "T") return splitFootprints(program, { ...opts, shapes: opts.shapes });
  const night = nightSpaces(program);
  const day = program.spaces.filter((s) => s.zone === "day");
  if (!night.length) return [];
  const shapes = opts.shapes ?? "rectangle";
  const t = opts.externalThickness;
  const natural = (list: SpaceSpec[], thickness: number) => list.reduce((sum, s) => sum + Math.max(slotMin(s, thickness, opts.doorWidth, s.type !== "ensuite"), s.target / thickness), 0);
  const utilities = day.filter((s) => s.type === "utility");
  const inner = night.filter((s) => INNER.has(s.type) && s.type !== "ensuite");
  const outer = night.filter((s) => !inner.includes(s));
  const nights = [
    ...OUTER_BANDS.map((b) => ({ width: opts.hallWidth + b, length: natural(night, b), day })),
    // Double-loaded zones take the utility on the inner side, with the entry and a coat cupboard.
    ...INNER_BANDS.flatMap((i) => OUTER_BANDS.map((b) => ({ width: opts.hallWidth + i + b, length: Math.max(natural(outer, b), 1.8 + 0.9 + natural([...inner, ...utilities], i)), day: day.filter((s) => s.type !== "utility") }))),
  ];
  const step = 0.5;
  const up = (v: number) => Math.ceil(v / step - 1e-9) * step;
  const fits = (width: number, depth: number) =>
    Math.max(width, depth) / Math.min(width, depth) <= 2.2 + EPS && !(opts.plot?.maxWidth && width > opts.plot.maxWidth + EPS) && !(opts.plot?.maxDepth && depth > opts.plot.maxDepth + EPS);
  const rects = new Map<string, { width: number; depth: number; area: number }>();
  const ls = new Map<string, { width: number; depth: number; area: number; outline: Point2[] }>();
  for (const n of nights) {
    for (const dayWidth of [3.6, 4.2, 4.8, 5.4, 6.0]) {
      const dayLength = n.day.reduce((sum, s) => sum + Math.max(s.minWidth, clearMin(s.type, dayWidth), s.target / dayWidth), 0);
      const width = up(dayWidth + n.width + t);
      const depth = up(Math.max(n.length, dayLength) + 0.2 + t);
      if (shapes !== "L" && fits(width, depth)) rects.set(`${width}x${depth}`, { width, depth, area: width * depth });
      if (shapes === "rectangle" || Math.abs(n.length - dayLength) < 3) continue;
      // An L: the night column at its own width on one side, the day column taking the rest of the width.
      const shallow = up(Math.min(n.length, dayLength) + 0.2 + t);
      if (depth - shallow < 2) continue;
      const nightDeep = n.length > dayLength;
      for (const nightLeft of [true, false]) {
        // Where the outline steps: the wall between the columns sits on the night column's edge,
        // and its outside face is half a wall towards the notch beside the deep column.
        const edge = nightLeft ? t / 2 + n.width : width - t / 2 - n.width;
        const deepLeft = nightLeft === nightDeep;
        const split = roundToPrecision(deepLeft ? edge + t / 2 : edge - t / 2);
        const outline = deepLeft
          ? [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: shallow }, { x: split, y: shallow }, { x: split, y: depth }, { x: 0, y: depth }]
          : [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: split, y: depth }, { x: split, y: shallow }, { x: 0, y: shallow }];
        if (!fits(width, depth)) continue;
        const area = width * depth - (deepLeft ? width - split : split) * (depth - shallow);
        ls.set(`L:${width}x${depth}:${shallow}:${roundToPrecision(split)}`, { width, depth, area, outline });
      }
    }
  }
  const out: ZoneFootprint[] = [];
  const all = [...rects.values()].sort((a, b) => a.area - b.area || a.width - b.width);
  if (all.length) {
    // Within a little of the smallest: the most square, the widest and the deepest.
    const near = all.filter((o) => o.area <= all[0].area * 1.15 + EPS);
    const picks = [
      [...near].sort((a, b) => Math.abs(Math.log(a.width / a.depth)) - Math.abs(Math.log(b.width / b.depth)) || a.area - b.area)[0],
      [...near].sort((a, b) => b.width / b.depth - a.width / a.depth || a.area - b.area)[0],
      [...near].sort((a, b) => a.width / a.depth - b.width / b.depth || a.area - b.area)[0],
    ];
    for (const p of picks) if (p && !out.some((o) => o.width === p.width && o.depth === p.depth)) out.push({ width: p.width, depth: p.depth, shape: shapeOf(p.width, p.depth), key: `${p.width}x${p.depth}` });
  }
  const lShapes = [...ls.entries()].sort(([, a], [, b]) => a.area - b.area || a.width - b.width).slice(0, 2);
  for (const [key, l] of lShapes) out.push({ width: l.width, depth: l.depth, shape: shapeOf(l.width, l.depth), outline: l.outline, key, kind: "L" });
  return out;
}

/**
 * U and T houses for split-bedroom layouts: a bedroom wing either side of
 * the living spaces, each column as long as its rooms need. Where the living
 * spaces need less depth than the wings, a U (its courtyard on the garden,
 * or on the street); where they need more, a T with its bar on the street
 * and the living spaces running on to the garden. The two smallest of each.
 */
function splitFootprints(program: Program, opts: { hallWidth: number; doorWidth: number; externalThickness: number; plot?: PlotLimits; shapes: "U" | "T" }): ZoneFootprint[] {
  const night = nightSpaces(program);
  const day = program.spaces.filter((s) => s.zone === "day");
  if (!night.length) return [];
  const t = opts.externalThickness;
  const step = 0.5;
  const up = (v: number) => Math.ceil(v / step - 1e-9) * step;
  const natural = (list: SpaceSpec[], thickness: number) => list.reduce((sum, s) => sum + Math.max(slotMin(s, thickness, opts.doorWidth, s.type !== "ensuite"), s.target / thickness), 0);
  const fits = (width: number, depth: number) =>
    Math.max(width, depth) / Math.min(width, depth) <= 2.2 + EPS && !(opts.plot?.maxWidth && width > opts.plot.maxWidth + EPS) && !(opts.plot?.maxDepth && depth > opts.plot.maxDepth + EPS);
  const found = new Map<string, { width: number; depth: number; area: number; outline: Point2[] }>();
  const ringArea = (r: Point2[]) => Math.abs(r.reduce((sum, p, i) => sum + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0)) / 2;
  /** How wide and long a wing of these rooms is: single-loaded, or double-loaded with the bathrooms on the inner side. */
  const wingsOf = (list: SpaceSpec[], double: boolean) => {
    const inner = list.filter((s) => INNER.has(s.type) && s.type !== "ensuite");
    const outer = list.filter((s) => !inner.includes(s));
    return [
      ...[3.6, 4.0, 4.4].map((b) => ({ width: opts.hallWidth + b, length: natural(list, b) })),
      ...(double && inner.length ? INNER_BANDS.flatMap((i) => OUTER_BANDS.map((b) => ({ width: opts.hallWidth + i + b, length: Math.max(natural(outer, b), 1.8 + 0.9 + natural(inner, i)) }))) : []),
    ];
  };
  for (const [suite, rest] of splitNights(night)) {
    for (const a of wingsOf(suite, false)) {
      for (const b of wingsOf(rest, true)) {
        const [wa, wb] = [a.width, b.width];
        const wings = Math.max(a.length, b.length);
        for (const dayWidth of [3.6, 4.2, 4.8, 5.4, 6.0]) {
          // Every living space at its size across this width keeps its proportions.
          if (day.some((s) => !proportionOk(s.type, dayWidth, Math.max(s.minWidth, clearMin(s.type, dayWidth), s.target / dayWidth)))) continue;
          const dayLength = day.reduce((sum, s) => sum + Math.max(s.minWidth, clearMin(s.type, dayWidth), s.target / dayWidth), 0);
          const width = up(wa + dayWidth + wb + t);
          const middle = up(dayLength + 0.2 + t);
          const arm = up(wings + 0.2 + t);
          // Wall centrelines either side of the living spaces; rounding up widens the living spaces.
          const x1 = roundToPrecision(t / 2 + wa);
          const x2 = roundToPrecision(width - t / 2 - wb);
          const outlines: Point2[][] = [];
          if (opts.shapes === "U" && arm - middle >= 2 - EPS) {
            const [l, r] = [roundToPrecision(x1 + t / 2), roundToPrecision(x2 - t / 2)];
            // The courtyard on the garden, then on the street.
            outlines.push([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: arm }, { x: r, y: arm }, { x: r, y: middle }, { x: l, y: middle }, { x: l, y: arm }, { x: 0, y: arm }]);
            const front = roundToPrecision(arm - middle);
            outlines.push([{ x: 0, y: 0 }, { x: l, y: 0 }, { x: l, y: front }, { x: r, y: front }, { x: r, y: 0 }, { x: width, y: 0 }, { x: width, y: arm }, { x: 0, y: arm }]);
          }
          if (opts.shapes === "T" && middle - arm >= 2 - EPS) {
            const [l, r] = [roundToPrecision(x1 - t / 2), roundToPrecision(x2 + t / 2)];
            outlines.push([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: arm }, { x: r, y: arm }, { x: r, y: middle }, { x: l, y: middle }, { x: l, y: arm }, { x: 0, y: arm }]);
          }
          for (const outline of outlines) {
            const depth = Math.max(...outline.map((p) => p.y));
            if (!fits(width, depth)) continue;
            const key = `${opts.shapes}:${width}x${depth}:${outline.map((p) => `${p.x},${p.y}`).join(";")}`;
            found.set(key, { width, depth, area: ringArea(outline), outline });
          }
        }
      }
    }
  }
  // The smallest few, of different outlines: a size can fit the rooms on paper and not in a plan, so callers stop once enough work. Keys stay short and stable.
  const out: ZoneFootprint[] = [];
  const same = (a: Point2[], b: Point2[]) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < EPS && Math.abs(p.y - b[i].y) < EPS);
  for (const [, f] of [...found.entries()].sort(([ka, a], [kb, b]) => a.area - b.area || a.width - b.width || ka.localeCompare(kb))) {
    if (out.length >= SPLIT_FOOTPRINTS) break;
    if (out.some((o) => same(o.outline!, f.outline))) continue;
    out.push({ width: f.width, depth: f.depth, shape: shapeOf(f.width, f.depth), outline: f.outline, key: `${opts.shapes}:${f.width}x${f.depth}:${out.length + 1}`, kind: opts.shapes });
  }
  return out;
}
