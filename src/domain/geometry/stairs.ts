import { STAIR_PRESET } from "../plan/defaults";
import { floorToFloor, levelIndex } from "../plan/levels";
import type { Id, PlanDocument, Point2, Staircase } from "../plan/types";
import type { Rect } from "./vector";

/**
 * Stairs in plan. A staircase has one plan for every storey it climbs: each
 * storey's flight stands directly over the one below, so the stairs fill the
 * same footprint on every floor they serve, and every floor they reach has
 * that footprint open to the floor below.
 *
 * In the stairs' own frame the foot is the origin, the first flight climbs
 * along +v and +u is to the climber's right; `rotation` turns that frame
 * counterclockwise into the plan, as for furniture.
 */

export interface Tread {
  rect: Rect;
  /** Height in risers: the bottom tread is 1; a landing counts as one tread. */
  step: number;
}

export interface StairPlan {
  /** Risers per storey. */
  risers: number;
  /** Plan rectangles the stairs fill (and leave open in every floor they reach). */
  footprint: Rect[];
  bounds: Rect;
  /** Treads and landings, bottom to top. */
  treads: Tread[];
  /** Floor kept clear in front of the bottom step, and beyond the top step. */
  departure: Rect;
  arrival: Rect;
  /** The walking line from the foot to the top, for the arrow on plan. */
  path: Point2[];
}

/** Risers for a storey: as few as keep every step under the tallest allowed. */
export const risersFor = (floorToFloor: number): number => Math.max(3, Math.ceil(floorToFloor / STAIR_PRESET.maxRise - 1e-9));

function toPlan(s: Staircase, u: number, v: number): Point2 {
  const { x, y } = s.foot;
  switch (s.rotation) {
    case 0:
      return { x: x + u, y: y + v };
    case 90:
      return { x: x - v, y: y + u };
    case 180:
      return { x: x - u, y: y - v };
    default:
      return { x: x + v, y: y - u };
  }
}

/** A rectangle in the stairs' frame, as a plan rectangle. */
function rect(s: Staircase, u0: number, u1: number, v0: number, v1: number): Rect {
  const a = toPlan(s, u0, v0);
  const b = toPlan(s, u1, v1);
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return { minX: r(Math.min(a.x, b.x)), minY: r(Math.min(a.y, b.y)), maxX: r(Math.max(a.x, b.x)), maxY: r(Math.max(a.y, b.y)) };
}

const cache = new WeakMap<Staircase, Map<number, StairPlan>>();

/** The stairs' plan for a number of risers per storey. */
export function stairPlan(s: Staircase, risers: number): StairPlan {
  const cached = cache.get(s)?.get(risers);
  if (cached) return cached;
  const plan = build(s, risers);
  if (!cache.has(s)) cache.set(s, new Map());
  cache.get(s)!.set(risers, plan);
  return plan;
}

function build(s: Staircase, n: number): StairPlan {
  const w = s.width;
  const g = s.going;
  const reach = STAIR_PRESET.approach;
  const side = s.turn === "left" ? -1 : 1;
  const span = (a: number, b: number): [number, number] => (side > 0 ? [a, b] : [-b, -a]);
  const footprint: Rect[] = [];
  const treads: Tread[] = [];
  const path: Point2[] = [toPlan(s, 0, 0)];
  let arrival: Rect;

  if (s.shape === "straight") {
    const run = (n - 1) * g;
    for (let k = 1; k < n; k++) treads.push({ rect: rect(s, -w / 2, w / 2, (k - 1) * g, k * g), step: k });
    footprint.push(rect(s, -w / 2, w / 2, 0, run));
    arrival = rect(s, -w / 2, w / 2, run, run + reach);
    path.push(toPlan(s, 0, run));
  } else {
    // The first flight takes the extra tread when the storey's treads don't split evenly.
    const a = Math.ceil((n - 2) / 2);
    const b = n - 2 - a;
    const runA = a * g;
    const runB = b * g;
    for (let k = 1; k <= a; k++) treads.push({ rect: rect(s, -w / 2, w / 2, (k - 1) * g, k * g), step: k });
    footprint.push(rect(s, -w / 2, w / 2, 0, runA));
    if (s.shape === "l") {
      // A square landing, then the second flight turns off to the side.
      const landing = rect(s, -w / 2, w / 2, runA, runA + w);
      treads.push({ rect: landing, step: a + 1 });
      footprint.push(landing);
      for (let k = 1; k <= b; k++) {
        const [u0, u1] = span(w / 2 + (k - 1) * g, w / 2 + k * g);
        treads.push({ rect: rect(s, u0, u1, runA, runA + w), step: a + 1 + k });
      }
      const [u0, u1] = span(w / 2, w / 2 + runB);
      if (b > 0) footprint.push(rect(s, u0, u1, runA, runA + w));
      const [r0, r1] = span(w / 2 + runB, w / 2 + runB + reach);
      arrival = rect(s, r0, r1, runA, runA + w);
      path.push(toPlan(s, 0, runA + w / 2), toPlan(s, side * (w / 2 + runB), runA + w / 2));
    } else {
      // A half landing across both flights; the second comes back beside the first.
      const gap = STAIR_PRESET.gap;
      const [l0, l1] = span(-w / 2, w * 1.5 + gap);
      const landing = rect(s, l0, l1, runA, runA + w);
      treads.push({ rect: landing, step: a + 1 });
      footprint.push(landing);
      const [g0, g1] = span(w / 2, w / 2 + gap);
      footprint.push(rect(s, g0, g1, 0, runA));
      const [b0, b1] = span(w / 2 + gap, w * 1.5 + gap);
      for (let k = 1; k <= b; k++) treads.push({ rect: rect(s, b0, b1, runA - k * g, runA - (k - 1) * g), step: a + 1 + k });
      if (b > 0) footprint.push(rect(s, b0, b1, runA - runB, runA));
      arrival = rect(s, b0, b1, runA - runB - reach, runA - runB);
      const mid = side * (w + gap / 2);
      path.push(toPlan(s, 0, runA + w / 2), toPlan(s, mid, runA + w / 2), toPlan(s, mid, runA - runB));
    }
  }
  const bounds = footprint.reduce((acc, r) => ({
    minX: Math.min(acc.minX, r.minX),
    minY: Math.min(acc.minY, r.minY),
    maxX: Math.max(acc.maxX, r.maxX),
    maxY: Math.max(acc.maxY, r.maxY),
  }));
  return { risers: n, footprint, bounds, treads, departure: rect(s, -w / 2, w / 2, -reach, 0), arrival, path };
}

/** The floors a staircase climbs between, as indices, or null if either floor is missing or it doesn't go up. */
export function stairSpan(doc: PlanDocument, s: Staircase): { from: number; to: number } | null {
  const from = levelIndex(doc, s.fromLevelId);
  const to = levelIndex(doc, s.toLevelId);
  return from < 0 || to <= from ? null : { from, to };
}

/** Each storey's floor-to-floor height, bottom first. */
export function stairStoreys(doc: PlanDocument, s: Staircase): number[] {
  const span = stairSpan(doc, s);
  if (!span) return [];
  const out: number[] = [];
  for (let k = span.from; k < span.to; k++) out.push(floorToFloor(doc, k));
  return out;
}

/** The plan of a staircase in a house: as many risers as the tallest storey it climbs needs. */
export function staircasePlan(doc: PlanDocument, s: Staircase): StairPlan {
  return stairPlan(s, Math.max(3, ...stairStoreys(doc, s).map(risersFor)));
}

/** Every staircase, in record order. */
export const staircasesOf = (doc: PlanDocument): Staircase[] => Object.values(doc.staircases ?? {});

/** "Stairs", or "Stairs 2" when the house has several. */
export function stairsLabel(doc: PlanDocument, id: Id): string {
  const all = staircasesOf(doc);
  return all.length > 1 ? `Stairs ${all.findIndex((s) => s.id === id) + 1}` : "Stairs";
}

/** How a floor meets a staircase: it leaves from here, passes through, or arrives here. */
export type StairRole = "start" | "through" | "end";

export interface LevelStair {
  staircase: Staircase;
  plan: StairPlan;
  role: StairRole;
}

/** The staircases a floor has a part in. */
export function levelStairs(doc: PlanDocument, levelId: Id): LevelStair[] {
  const index = levelIndex(doc, levelId);
  if (index < 0) return [];
  const out: LevelStair[] = [];
  for (const staircase of staircasesOf(doc)) {
    const span = stairSpan(doc, staircase);
    if (!span || index < span.from || index > span.to) continue;
    out.push({ staircase, plan: staircasePlan(doc, staircase), role: index === span.from ? "start" : index === span.to ? "end" : "through" });
  }
  return out;
}

/** Plan rectangles a floor's stairs take up, which walls and furniture keep out of. */
export const levelStairRects = (doc: PlanDocument, levelId: Id): Rect[] => levelStairs(doc, levelId).flatMap((s) => s.plan.footprint);

/** What stairs keep furniture out of on a floor: the stairs themselves, and the floor to step on and off. */
export interface KeepOut {
  bodies: Rect[];
  zones: Rect[];
}

export const NO_KEEP_OUT: KeepOut = { bodies: [], zones: [] };

const keepOutCache = new WeakMap<PlanDocument, Map<Id, KeepOut>>();

/** A floor's keep-out; the same object for the same document and floor, so it can key caches. */
export function levelKeepOut(doc: PlanDocument, levelId: Id): KeepOut {
  if (!doc.staircases) return NO_KEEP_OUT;
  let byLevel = keepOutCache.get(doc);
  if (!byLevel) keepOutCache.set(doc, (byLevel = new Map()));
  const cached = byLevel.get(levelId);
  if (cached) return cached;
  const stairs = levelStairs(doc, levelId);
  const keepOut = stairs.length
    ? {
        bodies: stairs.flatMap((s) => s.plan.footprint),
        zones: stairs.flatMap((s) => [...(s.role === "end" ? [] : [s.plan.departure]), ...(s.role === "start" ? [] : [s.plan.arrival])]),
      }
    : NO_KEEP_OUT;
  byLevel.set(levelId, keepOut);
  return keepOut;
}
