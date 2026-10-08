import type { Id, Level, Point2, Wall } from "../plan/types";
import { EPS } from "./numeric";
import { dot, sub } from "./vector";

export type WallOrientation = "horizontal" | "vertical" | "oblique" | "degenerate";

/** Derived centreline information for one wall. */
export interface WallAxis {
  wallId: Id;
  wall: Wall;
  start: Point2;
  end: Point2;
  orientation: WallOrientation;
  length: number;
  /** Unit direction start → end. */
  dir: Point2;
  /** Left-hand unit normal of the directed axis. */
  normal: Point2;
  /** Constant coordinate: y for horizontal walls, x for vertical walls. */
  line: number;
  /** Range of the varying coordinate (x for horizontal, y for vertical). */
  min: number;
  max: number;
}

export function classifyOrientation(start: Point2, end: Point2): WallOrientation {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx <= EPS && dy <= EPS) return "degenerate";
  if (dy <= EPS) return "horizontal";
  if (dx <= EPS) return "vertical";
  return "oblique";
}

export function wallAxis(level: Level, wall: Wall): WallAxis | null {
  const start = level.vertices[wall.startVertexId];
  const end = level.vertices[wall.endVertexId];
  if (!start || !end) return null;
  const orientation = classifyOrientation(start, end);
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const dir = len > 0 ? { x: (end.x - start.x) / len, y: (end.y - start.y) / len } : { x: 0, y: 0 };
  const horizontal = orientation === "horizontal";
  return {
    wallId: wall.id,
    wall,
    start,
    end,
    orientation,
    length: len,
    dir,
    normal: { x: -dir.y, y: dir.x },
    line: horizontal ? start.y : start.x,
    min: horizontal ? Math.min(start.x, end.x) : Math.min(start.y, end.y),
    max: horizontal ? Math.max(start.x, end.x) : Math.max(start.y, end.y),
  };
}

export function wallAxes(level: Level): Map<Id, WallAxis> {
  const axes = new Map<Id, WallAxis>();
  for (const wall of Object.values(level.walls)) {
    const axis = wallAxis(level, wall);
    if (axis) axes.set(wall.id, axis);
  }
  return axes;
}

/** Signed distance along the axis from the wall start to the projection of p. */
export function axialParam(axis: WallAxis, p: Point2): number {
  return dot(sub(p, axis.start), axis.dir);
}

export function pointAtParam(axis: WallAxis, s: number): Point2 {
  if (axis.orientation === "horizontal") return { x: axis.start.x + axis.dir.x * s, y: axis.line };
  if (axis.orientation === "vertical") return { x: axis.line, y: axis.start.y + axis.dir.y * s };
  return { x: axis.start.x + axis.dir.x * s, y: axis.start.y + axis.dir.y * s };
}

export function isOrthogonal(axis: WallAxis): boolean {
  return axis.orientation === "horizontal" || axis.orientation === "vertical";
}

/** Distance from p to the wall's axis segment. */
export function distanceToAxis(axis: WallAxis, p: Point2): number {
  const s = Math.max(0, Math.min(axis.length, axialParam(axis, p)));
  const q = pointAtParam(axis, s);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** True when p lies on the axis segment (within tolerance), endpoints included. */
export function pointOnAxis(axis: WallAxis, p: Point2, eps = EPS): boolean {
  if (axis.orientation === "horizontal") {
    return Math.abs(p.y - axis.line) <= eps && p.x >= axis.min - eps && p.x <= axis.max + eps;
  }
  if (axis.orientation === "vertical") {
    return Math.abs(p.x - axis.line) <= eps && p.y >= axis.min - eps && p.y <= axis.max + eps;
  }
  return distanceToAxis(axis, p) <= eps;
}

/** True when p lies strictly between the axis endpoints. */
export function pointInAxisInterior(axis: WallAxis, p: Point2, eps = EPS): boolean {
  if (!pointOnAxis(axis, p, eps)) return false;
  const s = axialParam(axis, p);
  return s > eps && s < axis.length - eps;
}
