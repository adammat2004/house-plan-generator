import { roomAtPoint } from "../design/analysis";
import type { Furniture, Id, Level } from "../plan/types";
import { furnitureRect, rectOverlapArea } from "./geometry";
import { rectInRoom, roomContext, type RoomContext } from "./layout";

/**
 * Problems with where furniture stands. Furniture never blocks an edit, so
 * these are reported (drawn on the plan, listed in the inspector) rather than
 * refused.
 */
export type FurnitureProblem = "outside" | "wall" | "door" | "overlap";

export const FURNITURE_PROBLEM_TEXT: Record<FurnitureProblem, string> = {
  outside: "It isn't inside a room.",
  wall: "It runs into a wall.",
  door: "It blocks a door.",
  overlap: "It overlaps another piece.",
};

const cache = new WeakMap<Level, Map<Id, FurnitureProblem>>();

/** The first problem with each piece of furniture that has one. */
export function furnitureIssues(level: Level): Map<Id, FurnitureProblem> {
  const cached = cache.get(level);
  if (cached) return cached;
  const issues = new Map<Id, FurnitureProblem>();
  const items = Object.values(level.furniture);
  const contexts = new Map<Id, RoomContext | null>();
  const context = (roomId: Id) => {
    if (!contexts.has(roomId)) contexts.set(roomId, roomContext(level, roomId, new Set(items.map((f) => f.id))));
    return contexts.get(roomId)!;
  };
  for (const item of items) {
    const problem = problemOf(level, item, items, context);
    if (problem) issues.set(item.id, problem);
  }
  cache.set(level, issues);
  return issues;
}

function problemOf(level: Level, item: Furniture, all: Furniture[], context: (roomId: Id) => RoomContext | null): FurnitureProblem | null {
  const roomId = roomAtPoint(level, item.position);
  const ctx = roomId ? context(roomId) : null;
  if (!ctx) return "outside";
  const body = furnitureRect(item);
  if (!rectInRoom(ctx, body)) return "wall";
  // Free-standing pieces (a car, a plant) don't count as blocking a door they stand beside.
  if (ctx.doorZones.some((z) => rectOverlapArea(body, z) > 0.01)) return "door";
  for (const other of all) {
    if (other.id !== item.id && rectOverlapArea(body, furnitureRect(other)) > 0.005) return "overlap";
  }
  return null;
}
