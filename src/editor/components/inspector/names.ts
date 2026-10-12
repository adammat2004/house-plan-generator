import { describeEntity, facingLabel } from "@/domain/commands";
import { roomAtPoint } from "@/domain/design/analysis";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { pointAtParam } from "@/domain/geometry/walls";
import type { Id, Level } from "@/domain/plan/types";

/** Garden doors this wide or wider are called garden doors. */
const GARDEN_DOOR_WIDTH = 1.5;

/** The rooms either side of a stretch of wall (null for outside), at a point along it. */
function sides(level: Level, wallId: Id, s?: number): [string | null, string | null] {
  const axis = deriveLevelGeometry(level).axes.get(wallId);
  if (!axis) return [null, null];
  const at = pointAtParam(axis, s ?? axis.length / 2);
  const reach = axis.wall.thickness / 2 + 0.2;
  const name = (side: number) => {
    const id = roomAtPoint(level, { x: at.x + axis.normal.x * side * reach, y: at.y + axis.normal.y * side * reach });
    return id ? (level.rooms[id]?.name ?? null) : null;
  };
  return [name(1), name(-1)];
}

/**
 * What a homeowner would call a wall, door or window: "Wall between Kitchen
 * and Hall", "Garden doors", "Window, Bedroom 2". Falls back to the
 * drawing's own name ("Internal wall 1") where there's nothing better.
 */
export function friendlyName(level: Level, id: Id): string {
  const wall = level.walls[id];
  if (wall) {
    if (wall.role === "external") {
      const facing = facingLabel(level, id);
      if (level.rearWallId === id) return "Garden wall";
      return facing ? `Outside wall, ${facing.toLowerCase()}` : describeEntity(level, id);
    }
    const [a, b] = sides(level, id);
    if (a && b && a !== b) return `Wall between ${a} and ${b}`;
    return a || b ? `Wall in ${a ?? b}` : describeEntity(level, id);
  }
  const opening = level.openings[id];
  if (opening) {
    const host = level.walls[opening.wallId];
    const [a, b] = sides(level, opening.wallId, opening.offset + opening.width / 2);
    const inside = a ?? b;
    if (opening.kind === "window") return inside ? `Window, ${inside}` : describeEntity(level, id);
    if (host?.role === "external") {
      if (level.rearWallId === opening.wallId) return opening.width >= GARDEN_DOOR_WIDTH ? "Garden doors" : "Back door";
      return inside ? `Outside door, ${inside}` : "Outside door";
    }
    return a && b && a !== b ? `Door, ${a} to ${b}` : describeEntity(level, id);
  }
  return describeEntity(level, id);
}
