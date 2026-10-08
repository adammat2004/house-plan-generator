import { analyzeEnvelope } from "../geometry/envelope";
import type { Id, Level } from "../plan/types";

const SIDE_LABEL = { south: "South", east: "East", north: "North", west: "West" } as const;

/** Human-readable label for an entity, used in issue messages and lists. */
export function describeEntity(level: Level, id: Id): string {
  const wall = level.walls[id];
  if (wall) {
    if (wall.role === "external") {
      const env = analyzeEnvelope(level);
      const side = env.ok ? env.info.sideOfWall[id] : undefined;
      return side ? `${SIDE_LABEL[side]} external wall` : "External wall";
    }
    const index = Object.values(level.walls)
      .filter((w) => w.role === "internal")
      .findIndex((w) => w.id === id);
    return `Internal wall ${index + 1}`;
  }
  const opening = level.openings[id];
  if (opening) {
    const sameKind = Object.values(level.openings).filter((o) => o.kind === opening.kind);
    const index = sameKind.findIndex((o) => o.id === id);
    return `${opening.kind === "door" ? "Door" : "Window"} ${index + 1}`;
  }
  const room = level.rooms[id];
  if (room) return room.name;
  return id;
}
