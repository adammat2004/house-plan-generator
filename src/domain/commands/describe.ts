import { FURNITURE_CATALOG } from "../furniture/catalog";
import { analyzeEnvelope } from "../geometry/envelope";
import type { Id, Level } from "../plan/types";

const SIDE_LABEL = { south: "South", east: "East", north: "North", west: "West" } as const;

/**
 * "North", or "North 2" when several outline walls face north: numbered
 * west to east for walls facing north or south, south to north otherwise.
 * Null for walls that aren't on the outline.
 */
export function facingLabel(level: Level, wallId: Id): string | null {
  const env = analyzeEnvelope(level);
  if (!env.ok) return null;
  const side = env.info.sideOfWall[wallId];
  if (!side) return null;
  const same = env.info.edges.filter((e) => e.facing === side);
  if (same.length === 1) return SIDE_LABEL[side];
  const key = (e: (typeof same)[number]) => (side === "north" || side === "south" ? Math.min(e.axis.start.x, e.axis.end.x) : Math.min(e.axis.start.y, e.axis.end.y));
  const order = [...same].sort((a, b) => key(a) - key(b) || a.index - b.index);
  return `${SIDE_LABEL[side]} ${order.findIndex((e) => e.wallId === wallId) + 1}`;
}

/** Human-readable label for an entity, used in issue messages and lists. */
export function describeEntity(level: Level, id: Id): string {
  const wall = level.walls[id];
  if (wall) {
    if (wall.role === "external") {
      const facing = facingLabel(level, id);
      if (!facing) return "External wall";
      const [side, n] = facing.split(" ");
      return n ? `${side} external wall ${n}` : `${side} external wall`;
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
  const item = level.furniture[id];
  if (item) {
    const label = FURNITURE_CATALOG[item.kind].label;
    const same = Object.values(level.furniture).filter((f) => f.kind === item.kind);
    return same.length > 1 ? `${label} ${same.findIndex((f) => f.id === id) + 1}` : label;
  }
  return id;
}
