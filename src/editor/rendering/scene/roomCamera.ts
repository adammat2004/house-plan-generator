import { roomRegion } from "@/domain/design/analysis";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { backDirection, furnitureRect, rectOverlapArea } from "@/domain/furniture/geometry";
import { furnitureInRoom, roomContext, type RoomEdge } from "@/domain/furniture/layout";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { pointInPolygon, type MultiPolygon } from "@/domain/geometry/polygons";
import type { FurnitureKind, Id, Level, Point2 } from "@/domain/plan/types";

/**
 * Where a camera stands to show a room the way an interior photo would: in
 * the room, at a little under eye height, looking at its "feature wall" (the
 * bed head, the sofa, the kitchen units), with a wide but natural lens. Pure
 * plan geometry; the 3D renderers turn it into a three.js camera.
 */

export interface Point3 {
  x: number;
  y: number;
  /** Height above the floor, m. */
  z: number;
}

export interface CameraPose {
  eye: Point3;
  target: Point3;
  /** Vertical field of view, degrees. */
  vfov: number;
}

const EYE_HEIGHT = 1.45;
const TARGET_HEIGHT = 1.1;
const CLEARANCE = 0.3;

/** How much a piece standing against a wall makes it the wall to look at. */
const FEATURE: Partial<Record<FurnitureKind, number>> = {
  bed_king: 6,
  bed_double: 6,
  bed_single: 5,
  sofa_3: 5,
  sofa_2: 5,
  kitchen_run: 5,
  dining_set_6: 2,
  dining_set_4: 2,
  desk: 3,
  bath: 4,
  shower: 2,
  basin: 2,
  tv_unit: 1,
  wardrobe: 1,
  car: 2,
};

const inside = (clear: MultiPolygon, p: Point2) => clear.some((poly) => pointInPolygon(poly, p));

/** Inside the floor with some room around it, and not inside a piece of furniture. */
function standable(clear: MultiPolygon, blocked: ReturnType<typeof furnitureRect>[], p: Point2): boolean {
  for (const [dx, dy] of [
    [0, 0],
    [CLEARANCE, 0],
    [-CLEARANCE, 0],
    [0, CLEARANCE],
    [0, -CLEARANCE],
  ]) {
    if (!inside(clear, { x: p.x + dx, y: p.y + dy })) return false;
  }
  const spot = { minX: p.x - 0.15, minY: p.y - 0.15, maxX: p.x + 0.15, maxY: p.y + 0.15 };
  return !blocked.some((r) => rectOverlapArea(spot, r) > 0);
}

const edgeLength = (e: RoomEdge) => e.to - e.from;
const edgeMid = (e: RoomEdge): Point2 => (e.horizontal ? { x: (e.from + e.to) / 2, y: e.line } : { x: e.line, y: (e.from + e.to) / 2 });

function score(level: Level, roomId: Id, edge: RoomEdge, windows: Array<{ minX: number; minY: number; maxX: number; maxY: number }>): number {
  let total = edgeLength(edge) * 0.3;
  for (const item of furnitureInRoom(level, roomId)) {
    const weight = FEATURE[item.kind];
    if (!weight) continue;
    const back = backDirection(item.rotation);
    if (back.x !== edge.normal.x || back.y !== edge.normal.y) continue;
    const r = furnitureRect(item);
    const backFace = edge.horizontal ? (edge.normal.y > 0 ? r.maxY : r.minY) : edge.normal.x > 0 ? r.maxX : r.minX;
    const along = edge.horizontal ? [r.minX, r.maxX] : [r.minY, r.maxY];
    if (Math.abs(backFace - edge.line) > 0.2 || along[1] < edge.from || along[0] > edge.to) continue;
    total += weight * Math.min(1, FURNITURE_CATALOG[item.kind].width / 1.5);
  }
  const strip = edge.horizontal
    ? { minX: edge.from, maxX: edge.to, minY: edge.line - 0.05, maxY: edge.line + 0.05 }
    : { minX: edge.line - 0.05, maxX: edge.line + 0.05, minY: edge.from, maxY: edge.to };
  if (windows.some((w) => rectOverlapArea(strip, w) > 0)) total += 0.8;
  return total;
}

/** A view of one room from inside it, or null if the room isn't on the plan. */
export function roomCameraPose(level: Level, roomId: Id, aspect: number): CameraPose | null {
  const region = roomRegion(level, roomId);
  const ctx = roomContext(level, roomId);
  if (!region || !ctx) return null;
  const clear = region.clear;
  const blocked = furnitureInRoom(level, roomId).map(furnitureRect);
  const candidates = ctx.edges.filter((e) => edgeLength(e) >= 1.2);
  const edges = candidates.length ? candidates : ctx.edges;
  if (!edges.length) return null;
  let wall = edges[0];
  let best = -Infinity;
  for (const edge of edges) {
    const s = score(level, roomId, edge, ctx.windows.map((w) => w.rect));
    if (s > best + 1e-9) [best, wall] = [s, edge];
  }

  const mid = edgeMid(wall);
  const into = { x: -wall.normal.x, y: -wall.normal.y };
  // How far the room runs back from the wall.
  let reach = 0.2;
  while (reach < 20 && inside(clear, { x: mid.x + into.x * (reach + 0.1), y: mid.y + into.y * (reach + 0.1) })) reach += 0.1;
  const along = wall.horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
  // Off to one side a little, for a more natural two-point view; try the side with more room first.
  const shift = edgeLength(wall) * 0.18;
  let eye: Point2 | null = null;
  for (const side of [1, -1, 0]) {
    for (let back = reach - CLEARANCE; back >= Math.min(1.2, reach / 2); back -= 0.1) {
      const p = { x: mid.x + into.x * back + along.x * shift * side, y: mid.y + into.y * back + along.y * shift * side };
      if (standable(clear, blocked, p)) {
        eye = p;
        break;
      }
    }
    if (eye) break;
  }
  eye ??= { x: mid.x + into.x * reach * 0.6, y: mid.y + into.y * reach * 0.6 };

  const distance = Math.hypot(eye.x - mid.x, eye.y - mid.y);
  const hfov = Math.min(90, Math.max(60, (2 * Math.atan((edgeLength(wall) / 2 + 0.3) / Math.max(distance, 0.5)) * 180) / Math.PI));
  const vfov = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI;
  return { eye: { ...eye, z: EYE_HEIGHT }, target: { ...mid, z: TARGET_HEIGHT }, vfov };
}

/** The house from the garden, across the rear corner. */
export function exteriorCameraPose(level: Level, aspect: number): CameraPose {
  const env = analyzeEnvelope(level);
  const o = env.ok ? env.info.outsideRect : { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  const c = { x: (o.minX + o.maxX) / 2, y: (o.minY + o.maxY) / 2 };
  const size = Math.max(o.maxX - o.minX, o.maxY - o.minY, 4);
  const rear = env.ok && level.rearWallId ? env.info.sideOfWall[level.rearWallId] : "north";
  const dir = { north: [0.45, 1], south: [-0.45, -1], east: [1, -0.45], west: [-1, 0.45] }[rear ?? "north"];
  const hfov = 50;
  return {
    eye: { x: c.x + dir[0] * size * 1.45, y: c.y + dir[1] * size * 1.45, z: 3 },
    target: { x: c.x, y: c.y, z: 1.2 },
    vfov: (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI,
  };
}

/** The whole house from above at an angle, as a dollhouse with the roof off. */
export function aerialCameraPose(level: Level, aspect: number): CameraPose {
  const env = analyzeEnvelope(level);
  const o = env.ok ? env.info.outsideRect : { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  const c = { x: (o.minX + o.maxX) / 2, y: (o.minY + o.maxY) / 2 };
  const size = Math.max(o.maxX - o.minX, o.maxY - o.minY, 6);
  // Far enough back to frame the whole house with a margin of garden.
  const hfov = 50;
  return {
    eye: { x: c.x + size * 0.3, y: c.y - size * 1.05, z: size * 1.55 },
    target: { x: c.x, y: c.y + size * 0.02, z: 0 },
    vfov: (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / Math.min(aspect, 1.6)) * 180) / Math.PI,
  };
}
