import type { PlanCommand } from "@/domain/commands";
import {
  roomBounds,
  roomResizeCommand,
  roomWalls,
} from "@/domain/design/analysis";
import type { Id, Level, Opening } from "@/domain/plan/types";

/** Simple shows the few things most people change; Advanced is the full editor. */
export type RefineMode = "simple" | "advanced";

export const REFINE_MODE_KEY = "homedesign.refine.mode";

/** Anything but a stored "advanced" is Simple, so new people start there. */
export const parseRefineMode = (
  stored: string | null | undefined,
): RefineMode => (stored === "advanced" ? "advanced" : "simple");

/** How much one Bigger or Smaller press changes a room, in metres. */
export const RESIZE_STEP = 0.3;
const MIN_SIDE = 1.5;

/**
 * One Bigger or Smaller press: the room's shorter side moves by a step, so
 * rooms stay roughly square. A message when no wall can move; null when the
 * room is already as small as it goes.
 */
export function resizeStep(
  level: Level,
  roomId: Id,
  direction: "bigger" | "smaller",
): PlanCommand | string | null {
  const b = roomBounds(level, roomId);
  if (!b) return "That room isn't on this plan.";
  const width = b.maxX - b.minX;
  const depth = b.maxY - b.minY;
  const dimension = width <= depth ? "width" : "depth";
  const current = dimension === "width" ? width : depth;
  const size =
    direction === "bigger" ? current + RESIZE_STEP : current - RESIZE_STEP;
  if (size < MIN_SIDE) return null;
  return roomResizeCommand(level, roomId, dimension, size);
}

/**
 * The wall of a room that suits a new door or window: windows go on the
 * longest outside wall, doors on the longest inside wall, either falling
 * back to any wall. Null for a room without walls.
 */
export function openingWall(
  level: Level,
  roomId: Id,
  kind: Opening["kind"],
): Id | null {
  const walls = roomWalls(level, roomId);
  const preferred = walls.filter((w) => w.external === (kind === "window"));
  const pool = preferred.length ? preferred : walls;
  const longest = [...pool].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  return longest?.wallId ?? null;
}

/** The most recently added door or window of a room, for Remove; null when it has none. */
export function removableOpening(
  level: Level,
  roomId: Id,
  kind: Opening["kind"],
): Id | null {
  const wallIds = new Set(roomWalls(level, roomId).map((w) => w.wallId));
  const found = Object.values(level.openings).filter(
    (o) => o.kind === kind && wallIds.has(o.wallId),
  );
  return found.length ? found[found.length - 1].id : null;
}
