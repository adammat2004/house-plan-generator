import { deriveLevelGeometry, deriveRoomRegions, openingPlacement, roomFaceIndices, type LevelGeometry } from "../geometry/derive";
import type { Face } from "../geometry/faces";
import { distanceToPolygonBoundary, pointInPolygon, type MultiPolygon, type Ring } from "../geometry/polygons";
import type { Id, Level, Point2 } from "../plan/types";

/** How far a pinned room's outline, doors, windows or furniture may drift, m. */
const TOLERANCE = 0.001;

export type PinnedChange = "shape" | "openings" | "furniture" | "removed";

export interface PinnedRoomChange {
  roomId: Id;
  name: string;
  what: PinnedChange;
}

/**
 * The pinned rooms an edit would change: their clear floor outline, the doors
 * and windows on their walls (by position in plan), and, when asked, the
 * furniture standing in them. One entry per room, for the first change found.
 */
export function pinnedRoomChanges(before: Level, after: Level, opts: { furniture: boolean }): PinnedRoomChange[] {
  const pinned = Object.values(before.rooms).filter((room) => room.locked);
  if (!pinned.length) return [];
  const beforeSide = side(before);
  const afterSide = side(after);
  const changes: PinnedRoomChange[] = [];
  for (const room of pinned) {
    const what = roomChange(room.id, beforeSide, afterSide, opts.furniture);
    if (what) changes.push({ roomId: room.id, name: room.name, what });
  }
  return changes;
}

/** "Bedroom 2 is pinned. Unpin it to change it." */
export function pinnedMessage(name: string): string {
  return `${name} is pinned. Unpin it to change it.`;
}

interface Side {
  level: Level;
  geometry: LevelGeometry;
  faces: Map<Id, number>;
}

function side(level: Level): Side {
  return { level, geometry: deriveLevelGeometry(level), faces: roomFaceIndices(level) };
}

function roomChange(roomId: Id, before: Side, after: Side, furniture: boolean): PinnedChange | null {
  const beforeIndex = before.faces.get(roomId) ?? -1;
  const afterIndex = after.faces.get(roomId) ?? -1;
  if (beforeIndex < 0) return null;
  if (afterIndex < 0 || !after.level.rooms[roomId]) return "removed";
  const beforeFace = before.geometry.faces[beforeIndex];
  const afterFace = after.geometry.faces[afterIndex];
  if (before.level.walls !== after.level.walls || before.level.vertices !== after.level.vertices) {
    const beforeClear = deriveRoomRegions(before.level)[beforeIndex].clear;
    const afterClear = deriveRoomRegions(after.level)[afterIndex].clear;
    if (!sameMultiPolygon(beforeClear, afterClear)) return "shape";
  }
  if (!sameSignatures(openingsOf(before, beforeFace), openingsOf(after, afterFace))) return "openings";
  if (furniture && !sameSignatures(furnitureIn(before.level, beforeFace), furnitureIn(after.level, afterFace))) {
    return "furniture";
  }
  return null;
}

/** A thing compared by kind and a list of numbers, each within the tolerance. */
interface Signature {
  key: string;
  values: number[];
}

function sameSignatures(a: Signature[], b: Signature[]): boolean {
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  return a.every((x) => {
    const match = b.findIndex(
      (y, i) =>
        !used.has(i) && y.key === x.key && y.values.every((v, k) => Math.abs(v - x.values[k]) <= TOLERANCE),
    );
    if (match < 0) return false;
    used.add(match);
    return true;
  });
}

/** Doors and windows on the room's boundary, in plan terms so a wall's direction doesn't matter. */
function openingsOf({ level, geometry }: Side, face: Face): Signature[] {
  const walls = new Set(face.boundaryWallIds);
  const out: Signature[] = [];
  for (const opening of Object.values(level.openings)) {
    if (!walls.has(opening.wallId)) continue;
    const placed = openingPlacement(geometry, opening);
    if (!placed || distanceToPolygonBoundary(face.polygon, placed.centre) > TOLERANCE) continue;
    const [a, b] = ordered(placed.start, placed.end);
    const values = [a.x, a.y, b.x, b.y, opening.height];
    if (opening.kind === "window") values.push(opening.sillHeight);
    else {
      const hinge = opening.hinge === "start" ? placed.start : placed.end;
      const sign = opening.swingSide === "left" ? 1 : -1;
      values.push(hinge.x, hinge.y, placed.axis.normal.x * sign, placed.axis.normal.y * sign);
    }
    out.push({ key: opening.kind, values });
  }
  return out;
}

function furnitureIn(level: Level, face: Face): Signature[] {
  return Object.values(level.furniture)
    .filter((item) => pointInPolygon(face.polygon, item.position))
    .map((item) => ({
      key: `${item.kind}:${item.rotation}`,
      values: [item.position.x, item.position.y, item.width, item.depth, item.height],
    }));
}

function ordered(a: Point2, b: Point2): [Point2, Point2] {
  return a.x < b.x - TOLERANCE || (Math.abs(a.x - b.x) <= TOLERANCE && a.y < b.y) ? [a, b] : [b, a];
}

function sameMultiPolygon(a: MultiPolygon, b: MultiPolygon): boolean {
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  return a.every((p) => {
    const match = b.findIndex(
      (q, i) =>
        !used.has(i) &&
        q.holes.length === p.holes.length &&
        sameRing(p.outer, q.outer) &&
        p.holes.every((hole) => q.holes.some((other) => sameRing(hole, other))),
    );
    if (match < 0) return false;
    used.add(match);
    return true;
  });
}

/** Same corners in the same order, from any starting corner. */
function sameRing(a: Ring, b: Ring): boolean {
  const ra = corners(a);
  const rb = corners(b);
  if (ra.length !== rb.length) return false;
  const n = ra.length;
  for (let shift = 0; shift < n; shift++) {
    if (!near(ra[0], rb[shift])) continue;
    let all = true;
    for (let i = 1; i < n && all; i++) all = near(ra[i], rb[(i + shift) % n]);
    if (all) return true;
  }
  return n === 0;
}

/** Drops points within the tolerance of the line through their neighbours. */
function corners(ring: Ring): Ring {
  let points = ring;
  for (let changed = true; changed && points.length > 3; ) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const next = points[(i + 1) % points.length];
      if (distanceToLine(points[i], prev, next) <= TOLERANCE) {
        points = points.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return points;
}

function distanceToLine(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= TOLERANCE) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
}

const near = (a: Point2, b: Point2) => Math.abs(a.x - b.x) <= TOLERANCE && Math.abs(a.y - b.y) <= TOLERANCE;

/**
 * The pinned room a wall bounds, if any. Moving, removing or re-sizing that
 * wall always changes the room, so the edit can be refused up front, with
 * the pin as the reason rather than whatever else the edit would break.
 */
export function roomPinnedBy(level: Level, wallId: Id): { id: Id; name: string } | null {
  const pinned = Object.values(level.rooms).filter((room) => room.locked);
  if (!pinned.length) return null;
  const faces = deriveLevelGeometry(level).faces;
  const faceOf = roomFaceIndices(level);
  for (const room of pinned) {
    const face = faces[faceOf.get(room.id) ?? -1];
    if (face?.boundaryWallIds.includes(wallId)) return { id: room.id, name: room.name };
  }
  return null;
}
