import { applyCommand } from "../commands/apply";
import type { Circulation, Id, Level, PlanDocument } from "../plan/types";
import { roomBounds, roomConnections } from "./analysis";

/**
 * What each hall in a plan is for, so entrance halls, corridors, landings
 * and hubs can be named, measured and judged apart (roadmap M1). A hall
 * stays one room; this only says what kind it is.
 *
 * - landing: a hall on an upper floor (where the stairs arrive);
 * - entry: a hall the front door opens into;
 * - hub: a compact hall four or more rooms open off;
 * - corridor: any other hall, a passage to rooms along it.
 */

/** Rooms opening off a hall before it counts as a hub rather than a passage. */
const HUB_DOORS = 4;
/** Longest side over shortest, at most, for a hub. */
const HUB_PROPORTION = 1.6;

/** What a hall on this floor is for; null for a room that isn't a hall. */
export function circulationOf(doc: PlanDocument, level: Level, roomId: Id): Circulation | null {
  const room = level.rooms[roomId];
  if (!room || room.type !== "hall") return null;
  if (doc.levels.indexOf(level) > 0) return "landing";
  const doors = roomConnections(level, roomId).filter((c) => c.kind === "door");
  if (doors.some((c) => c.target.kind === "outside")) return "entry";
  const b = roomBounds(level, roomId);
  const rooms = new Set(doors.flatMap((c) => (c.target.kind === "room" ? [c.target.roomId] : []))).size;
  if (b && rooms >= HUB_DOORS) {
    const [w, d] = [b.maxX - b.minX, b.maxY - b.minY];
    if (Math.max(w, d) / Math.max(Math.min(w, d), 1e-6) <= HUB_PROPORTION) return "hub";
  }
  return "corridor";
}

/**
 * A generated plan with every hall marked with what it's for. Names stay
 * as the planners give them ("Hall", and "Landing" upstairs): a long hall
 * with the front door in it is still a hall to the people living there.
 */
export function labelCirculation(doc: PlanDocument): PlanDocument {
  let out = doc;
  for (const level of doc.levels) {
    for (const room of Object.values(level.rooms)) {
      const kind = circulationOf(doc, level, room.id);
      if (!kind || room.circulation === kind) continue;
      const result = applyCommand(out, { type: "updateRoom", roomId: room.id, levelId: level.id, changes: { circulation: kind } });
      if (result.ok) out = result.document;
    }
  }
  return out;
}

/** How a kind of hall is described ("Entrance hall"). */
export const CIRCULATION_LABEL: Record<Circulation, string> = { entry: "Entrance hall", corridor: "Corridor", landing: "Landing", hub: "Central hall" };
