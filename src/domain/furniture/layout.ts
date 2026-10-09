import { roomAtPoint, roomRegion } from "../design/analysis";
import { deriveLevelGeometry } from "../geometry/derive";
import { EPS, roundToPrecision } from "../geometry/numeric";
import { asAxisRect, pointInPolygon, type MultiPolygon } from "../geometry/polygons";
import type { Rect } from "../geometry/vector";
import { pointAtParam } from "../geometry/walls";
import type { Furniture, FurnitureKind, FurnitureRotation, Id, Level, Point2 } from "../plan/types";
import { FURNITURE_CATALOG, type FurnitureSpec } from "./catalog";
import { clearanceRect, furnitureRect, rectOverlapArea, rotationFacing } from "./geometry";

/**
 * What placing furniture in a room needs to know: its floor, the wall faces
 * around it, where doors swing and people walk, where windows are, and what
 * already stands there. Pure and deterministic; nothing here changes a plan.
 */

/** A straight stretch of wall face bounding a room. */
export interface RoomEdge {
  /** Unit vector from the room into the wall. */
  normal: Point2;
  /** The face's constant coordinate: y for horizontal faces, x for vertical ones. */
  line: number;
  /** Extent along the face. */
  from: number;
  to: number;
  horizontal: boolean;
  /** A door opens in this stretch. */
  hasDoor: boolean;
}

export interface WindowStrip {
  rect: Rect;
  sill: number;
}

export interface RoomContext {
  roomId: Id;
  clear: MultiPolygon;
  /** The floor when it is a plain rectangle; containment is then a fast check. */
  rect: Rect | null;
  bounds: Rect;
  area: number;
  edges: RoomEdge[];
  /** Kept clear for doors to swing and people to pass. */
  doorZones: Rect[];
  windows: WindowStrip[];
  /** Footprints already taken, and the space kept free in front of them. */
  bodies: Rect[];
  fronts: Rect[];
}

const PASSAGE = 0.8;
const WINDOW_REACH = 0.35;
const TOUCH = 0.002;

/** Items whose position lies in the room. */
export function furnitureInRoom(level: Level, roomId: Id): Furniture[] {
  return Object.values(level.furniture).filter((f) => roomAtPoint(level, f.position) === roomId);
}

export function roomContext(level: Level, roomId: Id, ignore: ReadonlySet<Id> = new Set()): RoomContext | null {
  const region = roomRegion(level, roomId);
  if (!region || !region.clear.length) return null;
  const clear = region.clear;
  const points = clear.flatMap((p) => p.outer);
  const bounds = {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
  const rect = clear.length === 1 ? asAxisRect(clear[0]) : null;
  const geometry = deriveLevelGeometry(level);

  // Door swings and the way through each door, on both sides of its wall.
  const doorZones: Rect[] = [];
  const windows: WindowStrip[] = [];
  const doorSpans: Array<{ horizontal: boolean; line: number; lo: number; hi: number }> = [];
  for (const opening of Object.values(level.openings)) {
    const axis = geometry.axes.get(opening.wallId);
    if (!axis || (axis.orientation !== "horizontal" && axis.orientation !== "vertical")) continue;
    const horizontal = axis.orientation === "horizontal";
    const a = pointAtParam(axis, opening.offset);
    const b = pointAtParam(axis, opening.offset + opening.width);
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const half = axis.wall.thickness / 2;
    const strip = (side: 1 | -1, reach: number, margin = 0): Rect => {
      const near = axis.line + side * half;
      const far = near + side * reach;
      const [c0, c1] = [Math.min(near, far), Math.max(near, far)];
      return horizontal ? { minX: lo - margin, maxX: hi + margin, minY: c0, maxY: c1 } : { minX: c0, maxX: c1, minY: lo - margin, maxY: hi + margin };
    };
    if (opening.kind === "door") {
      // The leaf swings to the side of the wall's left normal for "left".
      const leftIsPlus = horizontal ? axis.normal.y > 0 : axis.normal.x > 0;
      const swingPlus = (opening.swingSide === "left") === leftIsPlus;
      const reach = Math.max(opening.width, PASSAGE);
      doorZones.push(strip(swingPlus ? 1 : -1, reach, 0.05), strip(swingPlus ? -1 : 1, PASSAGE, 0.05));
      doorSpans.push({ horizontal, line: axis.line, lo, hi });
    } else {
      windows.push({ rect: strip(1, WINDOW_REACH), sill: opening.sillHeight }, { rect: strip(-1, WINDOW_REACH), sill: opening.sillHeight });
    }
  }

  const edges: RoomEdge[] = [];
  for (const polygon of clear) {
    for (const ring of [polygon.outer, ...polygon.holes]) {
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length];
        const horizontal = Math.abs(p.y - q.y) < EPS;
        if (!horizontal && Math.abs(p.x - q.x) >= EPS) return;
        const line = horizontal ? p.y : p.x;
        const from = horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
        const to = horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
        if (to - from < 0.2) return;
        const mid = horizontal ? { x: (from + to) / 2, y: line } : { x: line, y: (from + to) / 2 };
        // The side of the edge that isn't floor is the wall.
        const probe = 0.01;
        const plus = horizontal ? { x: mid.x, y: mid.y + probe } : { x: mid.x + probe, y: mid.y };
        const inside = clear.some((poly) => pointInPolygon(poly, plus));
        const sign = inside ? -1 : 1;
        const normal = horizontal ? { x: 0, y: sign } : { x: sign, y: 0 };
        const hasDoor = doorSpans.some(
          (d) => d.horizontal === horizontal && Math.abs(d.line - line) < 0.6 && Math.min(d.hi, to) - Math.max(d.lo, from) > 0.05,
        );
        edges.push({ normal, line, from, to, horizontal, hasDoor });
      });
    }
  }

  const bodies: Rect[] = [];
  const fronts: Rect[] = [];
  for (const item of furnitureInRoom(level, roomId)) {
    if (ignore.has(item.id)) continue;
    bodies.push(furnitureRect(item));
    const front = clearanceRect(item, Math.min(FURNITURE_CATALOG[item.kind].clearance, 0.6));
    if (front) fronts.push(front);
  }

  return { roomId, clear, rect, bounds, area: region.clearArea, edges, doorZones, windows, bodies, fronts };
}

/**
 * Whether a rectangle lies on the room's floor. Room outlines are
 * orthogonal, so it does when its corners are on the floor and no edge of
 * the outline passes through it.
 */
export function rectInRoom(ctx: RoomContext, r: Rect): boolean {
  if (r.maxX - r.minX <= EPS || r.maxY - r.minY <= EPS) return false;
  const b = ctx.rect ?? ctx.bounds;
  if (r.minX < b.minX - TOUCH || r.maxX > b.maxX + TOUCH || r.minY < b.minY - TOUCH || r.maxY > b.maxY + TOUCH) return false;
  if (ctx.rect) return true;
  const t = TOUCH * 2;
  const inner = { minX: r.minX + t, minY: r.minY + t, maxX: r.maxX - t, maxY: r.maxY - t };
  const corners = [
    { x: inner.minX, y: inner.minY },
    { x: inner.maxX, y: inner.minY },
    { x: inner.maxX, y: inner.maxY },
    { x: inner.minX, y: inner.maxY },
  ];
  if (!corners.every((c) => ctx.clear.some((poly) => pointInPolygon(poly, c)))) return false;
  for (const poly of ctx.clear) {
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        if (Math.abs(p.y - q.y) < EPS) {
          if (p.y > inner.minY && p.y < inner.maxY && Math.min(Math.max(p.x, q.x), inner.maxX) - Math.max(Math.min(p.x, q.x), inner.minX) > 0) return false;
        } else if (p.x > inner.minX && p.x < inner.maxX && Math.min(Math.max(p.y, q.y), inner.maxY) - Math.max(Math.min(p.y, q.y), inner.minY) > 0) return false;
      }
    }
  }
  return true;
}

const overlaps = (r: Rect, list: Rect[], allowance = 1e-4) => list.some((o) => rectOverlapArea(r, o) > allowance);

export interface Placement {
  kind: FurnitureKind;
  position: Point2;
  rotation: FurnitureRotation;
  width: number;
  depth: number;
  height: number;
}

/** Whether an item can stand here: on the floor, clear of doors, other items and (if tall) windows, with room to use it. */
export function fits(ctx: RoomContext, p: Placement, clearance = FURNITURE_CATALOG[p.kind].clearance): boolean {
  const body = furnitureRect(p);
  if (!rectInRoom(ctx, body)) return false;
  if (overlaps(body, ctx.bodies) || overlaps(body, ctx.fronts) || overlaps(body, ctx.doorZones)) return false;
  if (ctx.windows.some((w) => p.height > w.sill + 0.05 && rectOverlapArea(body, w.rect) > 1e-4)) return false;
  const spec = FURNITURE_CATALOG[p.kind];
  if (spec.placement === "free" && clearance > 0) {
    // Room to walk all the way round: inside the room and clear of other pieces.
    const ring = { minX: body.minX - clearance, minY: body.minY - clearance, maxX: body.maxX + clearance, maxY: body.maxY + clearance };
    return rectInRoom(ctx, ring) && !overlaps(ring, ctx.bodies);
  }
  const front = clearanceRect(p, clearance);
  return !front || (rectInRoom(ctx, front) && !overlaps(front, ctx.bodies));
}

/** Records a placed item so later ones keep clear of it. */
export function occupy(ctx: RoomContext, p: Placement) {
  ctx.bodies.push(furnitureRect(p));
  const front = clearanceRect(p, Math.min(FURNITURE_CATALOG[p.kind].clearance, 0.6));
  if (front) ctx.fronts.push(front);
}

export interface WallSpot extends Placement {
  edge: RoomEdge;
  /** Distance of the item's centre from the middle of its wall face. */
  offCentre: number;
  /** Flush with one end of the wall face. */
  flush: boolean;
}

export interface SizeOverride {
  width?: number;
  depth?: number;
}

/** Every spot along the room's wall faces where an item fits with its back to the wall. */
export function wallSpots(ctx: RoomContext, kind: FurnitureKind, size: SizeOverride = {}, step = 0.1): WallSpot[] {
  const spec = FURNITURE_CATALOG[kind];
  const width = size.width ?? spec.width;
  const depth = size.depth ?? spec.depth;
  const spots: WallSpot[] = [];
  for (const edge of ctx.edges) {
    const length = edge.to - edge.from;
    if (length < width - EPS) continue;
    const rotation = rotationFacing(edge.normal);
    const across = edge.line - (edge.horizontal ? edge.normal.y : edge.normal.x) * (depth / 2);
    const lo = edge.from + width / 2;
    const hi = edge.to - width / 2;
    const mid = (edge.from + edge.to) / 2;
    const along = new Set<number>([mid, lo, hi]);
    for (let s = lo; s <= hi + EPS; s += step) along.add(s);
    for (const a of along) {
      const at = roundToPrecision(Math.min(Math.max(a, lo), hi));
      const position = edge.horizontal ? { x: at, y: roundToPrecision(across) } : { x: roundToPrecision(across), y: at };
      const placement = { kind, position, rotation, width, depth, height: spec.height };
      if (!fits(ctx, placement)) continue;
      spots.push({ ...placement, edge, offCentre: Math.abs(at - mid), flush: Math.abs(at - lo) < 0.01 || Math.abs(at - hi) < 0.01 });
    }
  }
  return spots;
}

/** Spots anywhere on the floor, on a grid, facing the given ways. */
export function freeSpots(ctx: RoomContext, kind: FurnitureKind, rotations: FurnitureRotation[], size: SizeOverride = {}, step = 0.1): Placement[] {
  const spec = FURNITURE_CATALOG[kind];
  const width = size.width ?? spec.width;
  const depth = size.depth ?? spec.depth;
  const out: Placement[] = [];
  const b = ctx.bounds;
  for (const rotation of rotations) {
    for (let x = b.minX + step / 2; x <= b.maxX; x += step) {
      for (let y = b.minY + step / 2; y <= b.maxY; y += step) {
        const placement = { kind, position: { x: roundToPrecision(x), y: roundToPrecision(y) }, rotation, width, depth, height: spec.height };
        if (fits(ctx, placement)) out.push(placement);
      }
    }
  }
  return out;
}

export function best<T>(items: T[], score: (item: T) => number): T | null {
  let top: T | null = null;
  let topScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > topScore + 1e-9) {
      top = item;
      topScore = s;
    }
  }
  return top;
}

export const specOf = (kind: FurnitureKind): FurnitureSpec => FURNITURE_CATALOG[kind];
