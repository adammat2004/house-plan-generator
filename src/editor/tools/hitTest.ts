import { roomFaceIndices, type LevelGeometry } from "@/domain/geometry/derive";
import { findFaceIndexContaining } from "@/domain/geometry/faces";
import { dot, sub } from "@/domain/geometry/vector";
import { axialParam, distanceToAxis } from "@/domain/geometry/walls";
import { levelStairs } from "@/domain/geometry/stairs";
import type { Id, Level, PlanDocument, Point2 } from "@/domain/plan/types";
import type { Selection } from "../state/stores";

/**
 * What Select picks in Refine, in world coordinates against derived geometry
 * (Konva nodes are never the source of truth): furniture when it's on show,
 * then the door or window the pointer is in, then a wall, then a door or
 * window near it, then the room. A door or window wins over its own wall
 * where it actually is, so it can still be dragged.
 */
export function hitRefine(level: Level, geometry: LevelGeometry, p: Point2, tolerance: number, furnitureId: Id | null = null): Selection {
  if (furnitureId) return { kind: "furniture", id: furnitureId };
  const inOpening = hitOpening(level, geometry, p, tolerance, 0);
  if (inOpening) return { kind: "opening", id: inOpening };
  const wallId = hitWall(geometry, p, tolerance);
  if (wallId) return { kind: "wall", id: wallId };
  const openingId = hitOpening(level, geometry, p, tolerance);
  if (openingId) return { kind: "opening", id: openingId };
  const roomId = roomAt(level, geometry, p);
  return roomId ? { kind: "room", id: roomId } : null;
}

/** The door or window nearest p across its wall; `along` is the slack allowed past its ends. */
export function hitOpening(level: Level, geometry: LevelGeometry, p: Point2, tolerance: number, along = tolerance): Id | null {
  let best: { id: Id; d: number } | null = null;
  for (const opening of Object.values(level.openings)) {
    const axis = geometry.axes.get(opening.wallId);
    if (!axis) continue;
    const s = axialParam(axis, p);
    const perp = Math.abs(dot(sub(p, axis.start), axis.normal));
    if (s < opening.offset - along || s > opening.offset + opening.width + along) continue;
    if (perp > axis.wall.thickness / 2 + tolerance) continue;
    if (!best || perp < best.d) best = { id: opening.id, d: perp };
  }
  return best?.id ?? null;
}

export function hitWall(geometry: LevelGeometry, p: Point2, tolerance: number, filter?: (id: Id) => boolean): Id | null {
  let best: { id: Id; d: number } | null = null;
  for (const fp of geometry.footprints.values()) {
    if (filter && !filter(fp.wallId)) continue;
    const r = fp.rect;
    if (p.x < r.minX - tolerance || p.x > r.maxX + tolerance || p.y < r.minY - tolerance || p.y > r.maxY + tolerance) continue;
    const d = distanceToAxis(geometry.axes.get(fp.wallId)!, p);
    if (!best || d < best.d) best = { id: fp.wallId, d };
  }
  return best?.id ?? null;
}

export function roomAt(level: Level, geometry: LevelGeometry, p: Point2): Id | null {
  const face = findFaceIndexContaining(geometry.faces, p);
  if (face < 0) return null;
  for (const [roomId, index] of roomFaceIndices(level)) if (index === face) return roomId;
  return null;
}

/**
 * Which edge handle of an opening (if any) lies within `tolerance` of p.
 * "start" is the edge nearer the wall start (at `offset`).
 */
export function hitOpeningEdge(level: Level, geometry: LevelGeometry, openingId: Id, p: Point2, tolerance: number): "start" | "end" | null {
  const opening = level.openings[openingId];
  const axis = opening && geometry.axes.get(opening.wallId);
  if (!opening || !axis) return null;
  const perp = Math.abs(dot(sub(p, axis.start), axis.normal));
  if (perp > axis.wall.thickness / 2 + tolerance) return null;
  const s = axialParam(axis, p);
  const ds = Math.abs(s - opening.offset);
  const de = Math.abs(s - (opening.offset + opening.width));
  if (Math.min(ds, de) > tolerance) return null;
  return ds <= de ? "start" : "end";
}

/** Which end handle of a wall (if any) lies within `tolerance` of p. */
export function hitWallEnd(geometry: LevelGeometry, wallId: Id, p: Point2, tolerance: number): "start" | "end" | null {
  const axis = geometry.axes.get(wallId);
  if (!axis) return null;
  const ds = Math.hypot(p.x - axis.start.x, p.y - axis.start.y);
  const de = Math.hypot(p.x - axis.end.x, p.y - axis.end.y);
  if (Math.min(ds, de) > tolerance) return null;
  return ds <= de ? "start" : "end";
}

/** The staircase on a floor whose plan holds the point. */
export function hitStairs(doc: PlanDocument, levelId: Id, p: Point2): Id | null {
  for (const { staircase, plan } of levelStairs(doc, levelId)) {
    if (plan.footprint.some((r) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY)) return staircase.id;
  }
  return null;
}
