import { difference, interiorPoint, polygonArea, type MultiPolygon, type PolygonWithHoles } from "@/domain/geometry/polygons";
import { levelStairs, type StairRole } from "@/domain/geometry/stairs";
import { rectsOverlap, type Rect } from "@/domain/geometry/vector";
import { floorToFloor, levelIndex } from "@/domain/plan/levels";
import type { Id, PlanDocument, Point2 } from "@/domain/plan/types";
import type { PlanScene } from "./planScene";

/**
 * Stairs on one floor as drawable primitives, in world metres, by the usual
 * drawing convention: on the floor they leave from, the treads below the
 * plan's cut (about 1.2 m up) are drawn solid, a break line crosses the
 * flight there and the rest is dashed, with UP at the foot; on the floor they
 * arrive at, the whole flight is seen from above, with DOWN at the top.
 */

export interface StairPrimitive {
  id: Id;
  role: StairRole;
  /** The stairs' plan rectangles: the outline drawn round them, and what hit-testing picks. */
  footprint: Rect[];
  bounds: Rect;
  /** Treads and landings; `hidden` ones are above the cut and drawn dashed. */
  treads: Array<{ rect: Rect; hidden: boolean }>;
  /** The walking line, drawn with an arrowhead at its last point. */
  path: Point2[];
  /** Diagonal across the flight where the plan cuts it. */
  breakLine: [Point2, Point2] | null;
  /** UP at the foot and DOWN at the top, each set just past its end of the flight, `away` from the stairs. */
  labels: Array<{ text: "UP" | "DOWN"; at: Point2; away: Point2 }>;
  /** Floor kept clear to step on and off on this floor, where UP and DOWN go. */
  ends: Rect[];
}

/** Height of the plan's cut above the floor, as on a drawing. */
const CUT = 1.2;

const cache = new WeakMap<PlanDocument, Map<Id, StairPrimitive[]>>();

export function buildStairScene(doc: PlanDocument, levelId: Id): StairPrimitive[] {
  if (!doc.staircases) return [];
  let byLevel = cache.get(doc);
  if (!byLevel) cache.set(doc, (byLevel = new Map()));
  const cached = byLevel.get(levelId);
  if (cached) return cached;
  const index = levelIndex(doc, levelId);
  const out: StairPrimitive[] = [];
  for (const { staircase, plan, role } of levelStairs(doc, levelId)) {
    // Above the floor the stairs leave from, how many steps reach the cut.
    const cut = role === "end" ? Infinity : Math.max(2, Math.round(CUT / (floorToFloor(doc, index) / plan.risers)));
    const treads = plan.treads.map((t) => ({ rect: t.rect, hidden: t.step > cut }));
    const cutTread = plan.treads.find((t) => t.step === cut)?.rect;
    const foot = plan.path[0];
    const top = plan.path[plan.path.length - 1];
    const labels: StairPrimitive["labels"] = [];
    if (role !== "end") labels.push({ text: "UP", at: foot, away: unit(plan.path[1] ?? foot, foot) });
    if (role !== "start") labels.push({ text: "DOWN", at: top, away: unit(plan.path[plan.path.length - 2] ?? top, top) });
    out.push({
      id: staircase.id,
      role,
      footprint: plan.footprint,
      bounds: plan.bounds,
      treads,
      // Going down, the arrow points back to the foot.
      path: role === "end" ? [...plan.path].reverse() : plan.path,
      breakLine: cutTread && role !== "end" ? [{ x: cutTread.minX, y: cutTread.minY }, { x: cutTread.maxX, y: cutTread.maxY }] : null,
      labels,
      ends: [...(role !== "end" ? [plan.departure] : []), ...(role !== "start" ? [plan.arrival] : [])],
    });
  }
  byLevel.set(levelId, out);
  return out;
}

const unit = (from: Point2, to: Point2): Point2 => {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  return len > 1e-9 ? { x: (to.x - from.x) / len, y: (to.y - from.y) / len } : { x: 0, y: -1 };
};

const rectPolygon = (r: Rect): PolygonWithHoles => ({
  outer: [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ],
  holes: [],
});

/** Clearance from the walls and stairs a room name needs, m. */
const LABEL_CLEARANCE = 0.45;

const labelCache = new WeakMap<PlanScene, WeakMap<readonly StairPrimitive[], PlanScene>>();

/**
 * The scene with room names moved off the stairs: a hall or landing's name
 * goes to the roomiest part of its floor clear of the flight and of the floor
 * at either end, where UP and DOWN are written. The same object back when no
 * room has stairs in it.
 */
export function labelsOffStairs(scene: PlanScene, stairs: readonly StairPrimitive[]): PlanScene {
  if (!stairs.length) return scene;
  let byStairs = labelCache.get(scene);
  if (!byStairs) labelCache.set(scene, (byStairs = new WeakMap()));
  const cached = byStairs.get(stairs);
  if (cached) return cached;
  const flights = stairs.flatMap((s) => s.footprint);
  const ends = stairs.flatMap((s) => s.ends);
  const roomiest = (clear: MultiPolygon, rects: Rect[]): PolygonWithHoles | null => {
    const free = clear.flatMap((p) => difference(p, rects.map(rectPolygon)));
    const largest = free.reduce<PolygonWithHoles | null>((best, p) => (!best || polygonArea(p) > polygonArea(best) ? p : best), null);
    return largest && polygonArea(largest) >= 1 ? largest : null;
  };
  let moved = false;
  const rooms = scene.rooms.map((room) => {
    const under = flights.filter((r) => rectsOverlap(r, room.bounds));
    if (!under.length) return room;
    // Off the flight and its ends if there's room for that, else off the flight alone.
    const spot = roomiest(room.clear, [...under, ...ends.filter((r) => rectsOverlap(r, room.bounds))]) ?? roomiest(room.clear, under);
    if (!spot) return room;
    moved = true;
    // Nearest where it was, of the spots roomy enough for a name.
    return { ...room, label: interiorPoint(spot, { point: room.label, enough: LABEL_CLEARANCE }) };
  });
  const out = moved ? { ...scene, rooms } : scene;
  byStairs.set(stairs, out);
  return out;
}
