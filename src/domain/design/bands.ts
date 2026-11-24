import { EPS, roundToPrecision } from "../geometry/numeric";
import type { RoomType } from "../plan/types";
import { LIVING, programGraph, type ProgramGraph } from "./concept/programGraph";
import type { SpaceSpec } from "./program";
import { clearMin, proportionOk, ROOM_RULES, SLOT_WALLS } from "./roomRules";
import { distributeWidths } from "./slots";
import type { Box, Placed } from "./zonePlanner";

/**
 * Bands of rooms side by side, each opening off the hall (or landing) where
 * the band meets it, or off a room beside it, or off a room already placed
 * across the band's edge: the building block of two-storey layouts and of
 * the wings beside them. Pure and deterministic.
 */

export { LIVING };

/** A room something can open off: its key and type. */
export interface Parent {
  key: string;
  type: RoomType;
}

export interface BandRules {
  /** What it costs a room to open off the hall or landing; Infinity when it can't. */
  hall: (s: SpaceSpec) => number;
  /** What it costs `child` to open off the room beside it; Infinity when it shouldn't. */
  via: (parent: Parent, child: SpaceSpec) => number;
}

/** Downstairs, from the program's graph: living spaces off the hall or each other, a utility off the kitchen, a garage off the utility. */
export const downRules = (graph: ProgramGraph): BandRules => ({
  hall: (s) => graph.down("hall", s.type),
  via: (parent, child) => graph.down(parent.type, child.type),
});

/** Upstairs, from the program's graph: everything off the landing, an ensuite off its own bedroom only (nightSpaces keys it after the bedroom). */
export const upRules = (graph: ProgramGraph): BandRules => ({
  hall: (s) => graph.up("hall", s),
  via: (parent, child) => graph.up(parent, child),
});

/** The rules for a brief with no preferences. */
export const DOWN: BandRules = downRules(programGraph());
export const UP: BandRules = upRules(programGraph());

/**
 * Where a band meets something its rooms can open off, along the band: the
 * hall or landing (a bare stretch), or a room already placed.
 */
export type Contact = [number, number] | { span: [number, number]; from: "hall" | Parent };

const spanOf = (c: Contact): [number, number] => (Array.isArray(c) ? c : c.span);
const fromOf = (c: Contact): "hall" | Parent => (Array.isArray(c) ? "hall" : c.from);

export function* orders<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) for (const rest of orders([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
}

const len = (r: [number, number]) => r[1] - r[0];
const area = (b: Box) => (b.u1 - b.u0) * (b.v1 - b.v0);

/**
 * Rooms side by side along a band, in the order whose doors and sizes suit
 * them best: each opening off what the band meets where there's room for a
 * door (or, with `entryFirst`, the first room off the hall strip at its
 * end), or off the room beside it; with `last`, that room at the far end.
 * Null if no order works.
 */
export function bandOf(spaces: SpaceSpec[], along: [number, number], depth: [number, number], contacts: readonly Contact[], entryFirst: boolean, rules: BandRules, door: number, last?: string): { rooms: Placed[]; score: number } | null {
  if (!spaces.length) return { rooms: [], score: 0 };
  const thickness = len(depth);
  // Every room is at least as wide as it needs across the band, once the walls are off.
  if (spaces.some((x) => thickness - SLOT_WALLS < ROOM_RULES[x.type].minWidth - 0.005)) return null;
  const mins = (list: SpaceSpec[]) => list.map((x) => Math.max(x.minWidth, clearMin(x.type, thickness)));
  if (mins(spaces).reduce((a, b) => a + b, 0) > len(along) + EPS) return null;
  let best: { rooms: Placed[]; score: number } | null = null;
  for (const order of orders(spaces)) {
    if (last && order[order.length - 1].key !== last) continue;
    const cuts = order.length === 1 ? [0, roundToPrecision(len(along))] : distributeWidths(len(along), order, mins(order));
    if (!cuts) continue;
    const boxes = order.map((_, i): Box => ({ u0: roundToPrecision(along[0] + cuts[i]), u1: roundToPrecision(along[0] + cuts[i + 1]), v0: depth[0], v1: depth[1] }));
    if (boxes.some((b, i) => !proportionOk(order[i].type, b.u1 - b.u0, thickness))) continue;
    // What each room could open off across the band's edge.
    const outside = (b: Box, i: number): Array<"hall" | Parent> => {
      const out: Array<"hall" | Parent> = entryFirst && i === 0 ? ["hall"] : [];
      for (const c of contacts) {
        const [a, d] = spanOf(c);
        if (Math.min(b.u1, d) - Math.max(b.u0, a) >= door + 0.3 - EPS) out.push(fromOf(c));
      }
      return out;
    };
    // A cheapest tree from the hall over doors between neighbours.
    const parent: Array<number | "hall" | Parent | null> = order.map(() => null);
    let cost = 0;
    for (let added = 0; added < order.length; added++) {
      let pick: { i: number; from: number | "hall" | Parent; c: number } | null = null;
      for (let i = 0; i < order.length; i++) {
        if (parent[i] !== null) continue;
        const options: Array<{ from: number | "hall" | Parent; c: number }> = outside(boxes[i], i).map((from) => ({ from, c: from === "hall" ? rules.hall(order[i]) : rules.via(from, order[i]) }));
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
        const via = from === "hall" ? "hall" : typeof from === "number" ? order[from].key : from.key;
        return { key: x.key, kind: x.type === "ensuite" ? "ensuite" : x.type === "storage" ? "storage" : "room", name: x.name, type: x.type, target: x.target, window: x.window, box: boxes[i], via, ...(x.type === "ensuite" ? { of: via } : {}) };
      }),
    };
  }
  return best;
}
