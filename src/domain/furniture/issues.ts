import { roomAtPoint } from "../design/analysis";
import { NO_KEEP_OUT, type KeepOut } from "../geometry/stairs";
import type { Furniture, Id, Level } from "../plan/types";
import { furnitureRect, rectOverlapArea } from "./geometry";
import { rectInRoom, roomContext, type RoomContext } from "./layout";

/**
 * Problems with where furniture stands. Furniture never blocks an edit, so
 * these are reported (drawn on the plan, listed in the inspector) rather than
 * refused.
 */
export type FurnitureProblem = "outside" | "wall" | "stairs" | "door" | "overlap";

export const FURNITURE_PROBLEM_TEXT: Record<FurnitureProblem, string> = {
  outside: "It isn't inside a room.",
  wall: "It runs into a wall.",
  stairs: "It's in the way of the stairs.",
  door: "It blocks a door.",
  overlap: "It overlaps another piece.",
};

const cache = new WeakMap<Level, WeakMap<KeepOut, Map<Id, FurnitureProblem>>>();

/** The first problem with each piece of furniture that has one; `keepOut` is the floor's stairs (`levelKeepOut`). */
export function furnitureIssues(level: Level, keepOut: KeepOut = NO_KEEP_OUT): Map<Id, FurnitureProblem> {
  const cached = cache.get(level)?.get(keepOut);
  if (cached) return cached;
  const issues = new Map<Id, FurnitureProblem>();
  const items = Object.values(level.furniture);
  const contexts = new Map<Id, RoomContext | null>();
  const context = (roomId: Id) => {
    if (!contexts.has(roomId)) contexts.set(roomId, roomContext(level, roomId, new Set(items.map((f) => f.id))));
    return contexts.get(roomId)!;
  };
  for (const item of items) {
    const problem = problemOf(level, item, items, context, keepOut);
    if (problem) issues.set(item.id, problem);
  }
  if (!cache.has(level)) cache.set(level, new WeakMap());
  cache.get(level)!.set(keepOut, issues);
  return issues;
}

function problemOf(level: Level, item: Furniture, all: Furniture[], context: (roomId: Id) => RoomContext | null, keepOut: KeepOut): FurnitureProblem | null {
  const roomId = roomAtPoint(level, item.position);
  const ctx = roomId ? context(roomId) : null;
  if (!ctx) return "outside";
  const body = furnitureRect(item);
  if (!rectInRoom(ctx, body)) return "wall";
  if ([...keepOut.bodies, ...keepOut.zones].some((r) => rectOverlapArea(body, r) > 0.005)) return "stairs";
  // Free-standing pieces (a car, a plant) don't count as blocking a door they stand beside.
  if (ctx.doorZones.some((z) => rectOverlapArea(body, z) > 0.01)) return "door";
  for (const other of all) {
    if (other.id !== item.id && rectOverlapArea(body, furnitureRect(other)) > 0.005) return "overlap";
  }
  return null;
}
