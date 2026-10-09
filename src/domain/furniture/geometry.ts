import type { Rect } from "../geometry/vector";
import type { Furniture, FurnitureRotation, Point2 } from "../plan/types";

/**
 * Furniture footprints. Rotations are quarter turns, so every footprint is
 * an axis-aligned rectangle. In an item's own frame, width runs along x,
 * depth along y, and its back is at +y.
 */

type Placed = Pick<Furniture, "position" | "rotation" | "width" | "depth">;

const quarter = (rotation: FurnitureRotation) => rotation === 90 || rotation === 270;

/** Half the footprint along plan x and y. */
export function halfExtents(item: Pick<Furniture, "rotation" | "width" | "depth">): { x: number; y: number } {
  return quarter(item.rotation) ? { x: item.depth / 2, y: item.width / 2 } : { x: item.width / 2, y: item.depth / 2 };
}

export function furnitureRect(item: Placed): Rect {
  const h = halfExtents(item);
  return { minX: item.position.x - h.x, minY: item.position.y - h.y, maxX: item.position.x + h.x, maxY: item.position.y + h.y };
}

/** Plan direction the item's back faces. */
export function backDirection(rotation: FurnitureRotation): Point2 {
  switch (rotation) {
    case 0:
      return { x: 0, y: 1 };
    case 90:
      return { x: -1, y: 0 };
    case 180:
      return { x: 0, y: -1 };
    default:
      return { x: 1, y: 0 };
  }
}

/** The rotation whose back faces `direction` (an axis-aligned unit vector). */
export function rotationFacing(direction: Point2): FurnitureRotation {
  if (Math.abs(direction.y) >= Math.abs(direction.x)) return direction.y > 0 ? 0 : 180;
  return direction.x < 0 ? 90 : 270;
}

/** Maps a point from the item's own frame (centre origin, back at +y) to the plan. */
export function toPlan(item: Pick<Furniture, "position" | "rotation">, local: Point2): Point2 {
  const { x, y } = local;
  const p = item.position;
  switch (item.rotation) {
    case 0:
      return { x: p.x + x, y: p.y + y };
    case 90:
      return { x: p.x - y, y: p.y + x };
    case 180:
      return { x: p.x - x, y: p.y - y };
    default:
      return { x: p.x + y, y: p.y - x };
  }
}

/** Maps a plan point into the item's own frame. */
export function toLocal(item: Pick<Furniture, "position" | "rotation">, p: Point2): Point2 {
  const x = p.x - item.position.x;
  const y = p.y - item.position.y;
  switch (item.rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: y, y: -x };
    case 180:
      return { x: -x, y: -y };
    default:
      return { x: -y, y: x };
  }
}

/** The next quarter turn, counterclockwise (+1) or clockwise (−1). */
export function turn(rotation: FurnitureRotation, direction: 1 | -1): FurnitureRotation {
  return (((rotation + direction * 90) % 360) + 360) % 360 as FurnitureRotation;
}

/** The strip in front of an item that must stay clear to use it. */
export function clearanceRect(item: Placed, clearance: number): Rect | null {
  if (clearance <= 0) return null;
  const r = furnitureRect(item);
  const back = backDirection(item.rotation);
  // The front is opposite the back.
  if (back.y > 0) return { ...r, maxY: r.minY, minY: r.minY - clearance };
  if (back.y < 0) return { ...r, minY: r.maxY, maxY: r.maxY + clearance };
  if (back.x < 0) return { ...r, minX: r.maxX, maxX: r.maxX + clearance };
  return { ...r, maxX: r.minX, minX: r.minX - clearance };
}

export function rectOverlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}
