import type { LevelGeometry } from "@/domain/geometry/derive";
import { EPS, roundToPrecision } from "@/domain/geometry/numeric";
import { distance, pointKey, roundPoint } from "@/domain/geometry/vector";
import { axialParam, distanceToAxis, pointAtParam } from "@/domain/geometry/walls";
import type { Id, Level, Point2 } from "@/domain/plan/types";
import type { SnapKind } from "../state/stores";

export interface SnapOptions {
  /** Acquisition radius in metres (screen radius converted through the viewport). */
  radius: number;
  /** Grid spacing in metres, or null when grid snapping is off. */
  grid: number | null;
  /** When set, the result is constrained to a horizontal or vertical line through this point. */
  from?: Point2;
  /** Forces the constraint direction instead of using the dominant cursor direction. */
  lock?: "horizontal" | "vertical";
}

export interface SnapResult {
  point: Point2;
  kind: SnapKind;
  wallId?: Id;
}

interface SnapPoint {
  p: Point2;
  kind: "endpoint" | "junction";
}

/** Vertices and wall-contact points, deduplicated. */
function snapPoints(level: Level, geometry: LevelGeometry): SnapPoint[] {
  const seen = new Set<string>();
  const out: SnapPoint[] = [];
  for (const p of Object.values(level.vertices)) {
    const key = pointKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ p, kind: "endpoint" });
    }
  }
  for (const list of geometry.contacts.values()) {
    for (const c of list) {
      const key = pointKey(c.point);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ p: c.point, kind: "junction" });
      }
    }
  }
  return out;
}

const snapToGrid = (v: number, grid: number) => roundToPrecision(Math.round(v / grid) * grid);

/**
 * Priority: endpoints and junctions, then projections onto wall axes, then
 * the grid. All distances are compared against a radius derived from a
 * fixed screen distance, so behaviour is consistent at every zoom level.
 */
export function snapPoint(level: Level, geometry: LevelGeometry, p: Point2, options: SnapOptions): SnapResult {
  return options.from ? snapConstrained(level, geometry, p, options.from, options) : snapFree(level, geometry, p, options);
}

function snapFree(level: Level, geometry: LevelGeometry, p: Point2, { radius, grid }: SnapOptions): SnapResult {
  let best: SnapPoint | null = null;
  let bestD = radius;
  for (const candidate of snapPoints(level, geometry)) {
    const d = distance(candidate.p, p);
    if (d <= bestD) {
      best = candidate;
      bestD = d;
    }
  }
  if (best) return { point: roundPoint(best.p), kind: best.kind };

  let wallHit: { point: Point2; wallId: Id; d: number } | null = null;
  for (const axis of geometry.axes.values()) {
    if (axis.orientation !== "horizontal" && axis.orientation !== "vertical") continue;
    const d = distanceToAxis(axis, p);
    if (d > radius || (wallHit && d >= wallHit.d)) continue;
    const s = Math.max(0, Math.min(axis.length, axialParam(axis, p)));
    let point = pointAtParam(axis, s);
    if (grid) {
      const horizontal = axis.orientation === "horizontal";
      const along = snapToGrid(horizontal ? point.x : point.y, grid);
      if (along >= axis.min - EPS && along <= axis.max + EPS && Math.abs(along - (horizontal ? point.x : point.y)) <= radius) {
        point = horizontal ? { x: along, y: axis.line } : { x: axis.line, y: along };
      }
    }
    wallHit = { point: roundPoint(point), wallId: axis.wallId, d };
  }
  if (wallHit) return { point: wallHit.point, kind: "wall", wallId: wallHit.wallId };

  if (grid) return { point: { x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) }, kind: "grid" };
  return { point: roundPoint(p), kind: "free" };
}

function snapConstrained(
  level: Level,
  geometry: LevelGeometry,
  p: Point2,
  origin: Point2,
  { radius, grid, lock }: SnapOptions,
): SnapResult {
  const horizontal = lock ? lock === "horizontal" : Math.abs(p.x - origin.x) >= Math.abs(p.y - origin.y);
  const line = horizontal ? origin.y : origin.x;
  const value = horizontal ? p.x : p.y;
  const at = (v: number): Point2 => roundPoint(horizontal ? { x: v, y: line } : { x: line, y: v });

  let best: { v: number; kind: SnapKind; d: number; wallId?: Id } | null = null;
  const consider = (v: number, kind: SnapKind, priority: number, wallId?: Id) => {
    const d = Math.abs(v - value);
    if (d > radius) return;
    const score = d + priority * 1e-9;
    if (!best || score < best.d) best = { v, kind, d: score, wallId };
  };

  for (const candidate of snapPoints(level, geometry)) {
    const perp = horizontal ? candidate.p.y : candidate.p.x;
    if (Math.abs(perp - line) <= EPS) consider(horizontal ? candidate.p.x : candidate.p.y, candidate.kind, 0);
  }
  if (!best) {
    for (const axis of geometry.axes.values()) {
      const crosses =
        (horizontal && axis.orientation === "vertical") || (!horizontal && axis.orientation === "horizontal");
      if (!crosses || line < axis.min - EPS || line > axis.max + EPS) continue;
      consider(axis.line, "wall", 1, axis.wallId);
    }
  }
  if (best) {
    const b = best as { v: number; kind: SnapKind; wallId?: Id };
    return { point: at(b.v), kind: b.kind, wallId: b.wallId };
  }
  if (grid) return { point: at(snapToGrid(value, grid)), kind: "grid" };
  return { point: at(value), kind: "free" };
}
