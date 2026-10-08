import type { Id } from "../plan/types";
import { rectToPolygon, type PolygonWithHoles } from "./polygons";
import type { ContactMap } from "./topology";
import type { Rect } from "./vector";
import type { WallAxis } from "./walls";

/** The solid plan footprint of a wall, including join extensions. */
export interface WallFootprint {
  wallId: Id;
  rect: Rect;
  polygon: PolygonWithHoles;
  /** Extension beyond the start/end vertex to close corner and tee joins. */
  extendStart: number;
  extendEnd: number;
}

/**
 * Orthogonal wall footprints. Ends joined to a perpendicular wall extend by
 * half the other wall's thickness, so the union forms clean L, T and X joins.
 * Free ends stop at the vertex.
 */
export function wallFootprints(axes: Map<Id, WallAxis>, contacts: ContactMap): Map<Id, WallFootprint> {
  const result = new Map<Id, WallFootprint>();
  for (const axis of axes.values()) {
    if (axis.orientation !== "horizontal" && axis.orientation !== "vertical") continue;
    let extendStart = 0;
    let extendEnd = 0;
    for (const c of contacts.get(axis.wallId) ?? []) {
      if (!c.perpendicular) continue;
      if (c.thisEnd === "start") extendStart = Math.max(extendStart, c.otherThickness / 2);
      if (c.thisEnd === "end") extendEnd = Math.max(extendEnd, c.otherThickness / 2);
    }
    const half = axis.wall.thickness / 2;
    const p0 = { x: axis.start.x - axis.dir.x * extendStart, y: axis.start.y - axis.dir.y * extendStart };
    const p1 = { x: axis.end.x + axis.dir.x * extendEnd, y: axis.end.y + axis.dir.y * extendEnd };
    const rect: Rect =
      axis.orientation === "horizontal"
        ? { minX: Math.min(p0.x, p1.x), maxX: Math.max(p0.x, p1.x), minY: axis.line - half, maxY: axis.line + half }
        : { minX: axis.line - half, maxX: axis.line + half, minY: Math.min(p0.y, p1.y), maxY: Math.max(p0.y, p1.y) };
    result.set(axis.wallId, { wallId: axis.wallId, rect, polygon: rectToPolygon(rect), extendStart, extendEnd });
  }
  return result;
}
