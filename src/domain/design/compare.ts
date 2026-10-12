import type { HouseBrief } from "../brief/schema";
import type { Id, PlanDocument, RoomType } from "../plan/types";
import { assessHouse, briefFit, roomBounds, roomRegion } from "./analysis";
import { assessHouseSense } from "./houseSense";

/**
 * Two plans of a house side by side: which room is which in each, which
 * rooms differ, and the numbers that tell them apart. Rooms are matched
 * floor by floor, by id first (a copy keeps its rooms' ids), then by name
 * and use, then by use alone, the closest in size.
 */

export interface ComparedRoom {
  id: Id;
  name: string;
  type: RoomType;
  /** Which floor, 0 for the ground. */
  floor: number;
  area: number;
  width: number;
  depth: number;
  centre: { x: number; y: number };
}

export interface RoomPair {
  a: ComparedRoom | null;
  b: ComparedRoom | null;
  /** b's area less a's, m², when both have the room. */
  areaChange: number | null;
  /** Missing on one side, or a different size or place. */
  changed: boolean;
}

export type MetricKey = "area" | "bedrooms" | "bathrooms" | "living" | "hall" | "daylight" | "checks" | "brief";

export interface PlanMetric {
  key: MetricKey;
  label: string;
  a: number;
  b: number;
  /** "m2", a count, a share (0–1) or a score that only ranks. */
  unit: "m2" | "count" | "share" | "score";
  /** The side the numbers favour, or null when neither is better or it's only a difference. */
  better: "a" | "b" | null;
}

export interface PlanComparison {
  pairs: RoomPair[];
  /** The rooms that differ, on each side. */
  changed: { a: Id[]; b: Id[] };
  metrics: PlanMetric[];
  /** Outside width × depth, m. */
  size: { a: { width: number; depth: number } | null; b: { width: number; depth: number } | null };
}

/** Rooms closer than these count as the same. */
const SAME_AREA = 0.25;
const SAME_SIZE = 0.05;
const SAME_PLACE = 0.3;

function roomsOf(doc: PlanDocument): ComparedRoom[] {
  const out: ComparedRoom[] = [];
  doc.levels.forEach((level, floor) => {
    for (const room of Object.values(level.rooms)) {
      const region = roomRegion(level, room.id);
      const b = roomBounds(level, room.id);
      if (!region || !b) continue;
      out.push({
        id: room.id,
        name: room.name,
        type: room.type,
        floor,
        area: region.clearArea,
        width: b.maxX - b.minX,
        depth: b.maxY - b.minY,
        centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      });
    }
  });
  return out;
}

function pairUp(as: ComparedRoom[], bs: ComparedRoom[]): Array<[ComparedRoom | null, ComparedRoom | null]> {
  const pairs: Array<[ComparedRoom | null, ComparedRoom | null]> = [];
  const left = new Set(as);
  const right = new Set(bs);
  const take = (a: ComparedRoom, b: ComparedRoom) => {
    pairs.push([a, b]);
    left.delete(a);
    right.delete(b);
  };
  const pass = (same: (a: ComparedRoom, b: ComparedRoom) => boolean) => {
    for (const a of [...left]) {
      const candidates = [...right].filter((b) => b.floor === a.floor && same(a, b));
      if (!candidates.length) continue;
      take(a, candidates.reduce((best, b) => (Math.abs(b.area - a.area) < Math.abs(best.area - a.area) ? b : best)));
    }
  };
  // The same id is the same room in a copy; two separate layouts can reuse an id for another room, so it must also be that kind of room or in that place.
  pass((a, b) => a.id === b.id && (a.type === b.type || Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y) < 1));
  pass((a, b) => a.name === b.name && a.type === b.type);
  pass((a, b) => a.type === b.type && a.type !== "unspecified");
  for (const a of left) pairs.push([a, null]);
  for (const b of right) pairs.push([null, b]);
  return pairs;
}

function differs(a: ComparedRoom | null, b: ComparedRoom | null): boolean {
  if (!a || !b) return true;
  return (
    Math.abs(a.area - b.area) > SAME_AREA ||
    Math.abs(a.width - b.width) > SAME_SIZE ||
    Math.abs(a.depth - b.depth) > SAME_SIZE ||
    Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y) > SAME_PLACE
  );
}

function better(a: number, b: number, prefer: "higher" | "lower" | null, tolerance: number): "a" | "b" | null {
  if (!prefer || Math.abs(a - b) <= tolerance) return null;
  return (a > b) === (prefer === "higher") ? "a" : "b";
}

export function comparePlans(docA: PlanDocument, docB: PlanDocument, brief?: HouseBrief): PlanComparison {
  const pairs = pairUp(roomsOf(docA), roomsOf(docB))
    .map(([a, b]): RoomPair => ({ a, b, areaChange: a && b ? b.area - a.area : null, changed: differs(a, b) }))
    .sort((p, q) => (p.a ?? p.b)!.floor - (q.a ?? q.b)!.floor || (q.a?.area ?? -1) - (p.a?.area ?? -1) || (q.b?.area ?? 0) - (p.b?.area ?? 0));
  const [A, B] = [assessHouse(docA), assessHouse(docB)];
  const hall = (x: typeof A) => (x.totalArea > 0 ? x.rooms.filter((r) => r.type === "hall").reduce((s, r) => s + r.area, 0) / x.totalArea : 0);
  const checks = [assessHouseSense(docA).findings.length, assessHouseSense(docB).findings.length];
  const metric = (key: MetricKey, label: string, a: number, b: number, unit: PlanMetric["unit"], prefer: "higher" | "lower" | null, tolerance: number): PlanMetric => ({
    key,
    label,
    a,
    b,
    unit,
    better: better(a, b, prefer, tolerance),
  });
  const metrics: PlanMetric[] = [
    metric("area", "Floor area", A.totalArea, B.totalArea, "m2", null, 0),
    metric("bedrooms", "Bedrooms", A.bedrooms, B.bedrooms, "count", null, 0),
    metric("bathrooms", "Bathrooms", A.bathrooms, B.bathrooms, "count", null, 0),
    metric("living", "Living space", A.dayArea, B.dayArea, "m2", "higher", 0.5),
    metric("hall", "Hall and landing", hall(A), hall(B), "share", "lower", 0.01),
    metric("daylight", "Window to floor", A.glazingRatio, B.glazingRatio, "share", "higher", 0.005),
    metric("checks", "Things to check", checks[0], checks[1], "count", "lower", 0),
    ...(brief ? [metric("brief", "Your brief", briefFit(A, brief), briefFit(B, brief), "score", "higher", 0.25)] : []),
  ];
  return {
    pairs,
    changed: { a: pairs.filter((p) => p.changed && p.a).map((p) => p.a!.id), b: pairs.filter((p) => p.changed && p.b).map((p) => p.b!.id) },
    metrics,
    size: { a: A.outside, b: B.outside },
  };
}
