import { roomAtPoint } from "@/domain/design/analysis";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { furnitureRect, halfExtents, rectOverlapArea, rotationFacing } from "@/domain/furniture/geometry";
import { rectInRoom, roomContext, type RoomEdge } from "@/domain/furniture/layout";
import { roundToPrecision } from "@/domain/geometry/numeric";
import type { Furniture, Id, Level, Point2 } from "@/domain/plan/types";
import type { SnapIndicator } from "../state/stores";

export type FurniturePose = Pick<Furniture, "kind" | "position" | "rotation" | "width" | "depth">;

export interface FurnitureSnapOptions {
  /** Pointer acquisition radius in metres. */
  radius: number;
  /** Grid spacing, or null when snapping is off. */
  grid: number | null;
}

/** How close (m) a piece's back must come to a wall face before it turns and settles against it. */
const WALL_REACH = 0.4;

const snapTo = (v: number, step: number | null) => (step ? roundToPrecision(Math.round(v / step) * step) : roundToPrecision(v));

/**
 * Where a piece of furniture being placed or dragged comes to rest. Pieces
 * that stand against walls turn to put their back to the nearest wall face
 * of the room under them and sit flush with it, centred on the wall or flush
 * with its ends when close; anything else snaps to the half-grid.
 */
export function snapFurniture(level: Level, pose: FurniturePose, { radius, grid }: FurnitureSnapOptions): { pose: FurniturePose; snap: SnapIndicator | null } {
  const free = () => ({
    pose: { ...pose, position: { x: snapTo(pose.position.x, grid && grid / 2), y: snapTo(pose.position.y, grid && grid / 2) } },
    snap: null,
  });
  if (grid === null || FURNITURE_CATALOG[pose.kind].placement !== "wall") return free();
  const roomId = roomAtPoint(level, pose.position);
  const ctx = roomId ? roomContext(level, roomId) : null;
  if (!ctx) return free();

  let best: { edge: RoomEdge; d: number } | null = null;
  for (const edge of ctx.edges) {
    const rotation = rotationFacing(edge.normal);
    const h = halfExtents({ rotation, width: pose.width, depth: pose.depth });
    const acrossHalf = edge.horizontal ? h.y : h.x;
    const along = edge.horizontal ? pose.position.x : pose.position.y;
    if (along < edge.from - 0.1 || along > edge.to + 0.1) continue;
    const sign = edge.horizontal ? edge.normal.y : edge.normal.x;
    const target = edge.line - sign * acrossHalf;
    const d = Math.abs((edge.horizontal ? pose.position.y : pose.position.x) - target);
    if (d <= Math.max(WALL_REACH, radius * 3) && (!best || d < best.d)) best = { edge, d };
  }
  if (!best) return free();

  const { edge } = best;
  const rotation = rotationFacing(edge.normal);
  const h = halfExtents({ rotation, width: pose.width, depth: pose.depth });
  const acrossHalf = edge.horizontal ? h.y : h.x;
  const alongHalf = edge.horizontal ? h.x : h.y;
  const sign = edge.horizontal ? edge.normal.y : edge.normal.x;
  const across = roundToPrecision(edge.line - sign * acrossHalf);
  const raw = edge.horizontal ? pose.position.x : pose.position.y;
  const lo = edge.from + alongHalf;
  const hi = edge.to - alongHalf;
  let along = snapTo(raw, grid / 2);
  let kind: SnapIndicator["kind"] = "wall";
  if (lo <= hi) {
    const mid = (edge.from + edge.to) / 2;
    const reach = Math.max(radius * 1.5, 0.08);
    if (Math.abs(raw - mid) <= reach) {
      along = roundToPrecision(mid);
      kind = "centre";
    } else if (raw - lo <= reach) {
      along = roundToPrecision(lo);
      kind = "endpoint";
    } else if (hi - raw <= reach) {
      along = roundToPrecision(hi);
      kind = "endpoint";
    }
    along = Math.min(Math.max(along, roundToPrecision(lo)), roundToPrecision(hi));
  }
  const position = edge.horizontal ? { x: along, y: across } : { x: across, y: along };
  const point = edge.horizontal ? { x: along, y: edge.line } : { x: edge.line, y: along };
  return { pose: { ...pose, position, rotation }, snap: { point, kind } };
}

/** Whether a piece would stand clear here: on a room's floor, out of door swings and off other pieces. */
export function poseIsClear(level: Level, pose: FurniturePose, ignore?: Id): boolean {
  const roomId = roomAtPoint(level, pose.position);
  const ctx = roomId ? roomContext(level, roomId, ignore ? new Set([ignore]) : new Set()) : null;
  if (!ctx) return false;
  const body = furnitureRect(pose);
  if (!rectInRoom(ctx, body)) return false;
  if (ctx.doorZones.some((z) => rectOverlapArea(body, z) > 0.01)) return false;
  return !Object.values(level.furniture).some((f) => f.id !== ignore && rectOverlapArea(body, furnitureRect(f)) > 0.005);
}

/** The piece of furniture under a point, preferring the smallest when they overlap. */
export function hitFurniture(level: Level, p: Point2, tolerance = 0): Id | null {
  let hit: { id: Id; area: number } | null = null;
  for (const item of Object.values(level.furniture)) {
    const r = furnitureRect(item);
    if (p.x < r.minX - tolerance || p.x > r.maxX + tolerance || p.y < r.minY - tolerance || p.y > r.maxY + tolerance) continue;
    const area = (r.maxX - r.minX) * (r.maxY - r.minY);
    if (!hit || area < hit.area) hit = { id: item.id, area };
  }
  return hit?.id ?? null;
}
