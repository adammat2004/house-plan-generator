import { deriveLevelGeometry, deriveRoomRegions, roomFaceIndices } from "../geometry/derive";
import type { Face } from "../geometry/faces";
import { roundToPrecision } from "../geometry/numeric";
import { distanceToPolygonBoundary, overlapArea, pointInPolygon } from "../geometry/polygons";
import type { Id, Level, Room } from "../plan/types";
import type { IdSource } from "./ids";

const MIN_OVERLAP = 1e-9;
const SEED_CLEARANCE = 0.01;

/**
 * Keeps room identity across a geometry change.
 *
 * Old rooms are matched to new enclosed regions by maximum overlap. Each old
 * room claims the new region it overlaps most (ties: lower region index).
 * Where several rooms claim one region (a merge), the largest-overlap room
 * survives (ties: lower room id). Regions left unclaimed (e.g. the smaller
 * children of a split) receive new rooms with default names. Seeds are kept
 * when still inside their region and moved to an interior point otherwise.
 */
export function reconcileRooms(previous: Level | null, next: Level, ids: IdSource): Level {
  const nextFaces = deriveLevelGeometry(next).faces;
  const labelPoint = (f: number) => roundSeed(deriveRoomRegions(next)[f].labelPoint);
  const oldRooms = previous ? Object.values(previous.rooms) : [];

  const oldFaces: Array<Face | null> = [];
  if (previous) {
    const prevFaces = deriveLevelGeometry(previous).faces;
    const indices = roomFaceIndices(previous);
    for (const room of oldRooms) {
      const index = indices.get(room.id) ?? -1;
      oldFaces.push(index >= 0 ? prevFaces[index] : null);
    }
  }

  const overlaps = oldRooms.map((room, r) =>
    nextFaces.map((face) => {
      const old = oldFaces[r];
      if (old) return overlapArea(old.polygon, face.polygon);
      // A room without a previous region can still be matched by its seed.
      return pointInPolygon(face.polygon, room.seed) ? MIN_OVERLAP * 2 : 0;
    }),
  );

  const claims = new Map<number, number[]>();
  oldRooms.forEach((_, r) => {
    let best = -1;
    let bestArea = MIN_OVERLAP;
    overlaps[r].forEach((area, f) => {
      if (area > bestArea + MIN_OVERLAP) {
        best = f;
        bestArea = area;
      }
    });
    if (best >= 0) claims.set(best, [...(claims.get(best) ?? []), r]);
  });

  const survivors = new Map<number, number>();
  for (const [f, rooms] of claims) {
    const winner = [...rooms].sort(
      (a, b) => overlaps[b][f] - overlaps[a][f] || (oldRooms[a].id < oldRooms[b].id ? -1 : 1),
    )[0];
    survivors.set(f, winner);
  }

  const result: Record<Id, Room> = {};
  const usedNames = new Set<string>();
  const roomForFace = new Map<number, Room>();
  for (const [f, r] of survivors) {
    const room = oldRooms[r];
    const face = nextFaces[f];
    const seedOk =
      pointInPolygon(face.polygon, room.seed) && distanceToPolygonBoundary(face.polygon, room.seed) > SEED_CLEARANCE;
    const seed = seedOk ? room.seed : labelPoint(f);
    roomForFace.set(f, seed === room.seed ? room : { ...room, seed });
    usedNames.add(room.name);
  }

  // Preserve existing record order, then append new rooms in region order.
  const keptById = new Map([...roomForFace.values()].map((room) => [room.id, room]));
  for (const room of oldRooms) {
    const kept = keptById.get(room.id);
    if (kept) result[room.id] = kept;
  }
  nextFaces.forEach((_, f) => {
    if (roomForFace.has(f)) return;
    const id = ids.next("room");
    const name = defaultRoomName(usedNames);
    usedNames.add(name);
    result[id] = { id, name, type: "unspecified", seed: labelPoint(f) };
  });

  return { ...next, rooms: result };
}

function roundSeed(p: { x: number; y: number }) {
  return { x: roundToPrecision(p.x), y: roundToPrecision(p.y) };
}

export function defaultRoomName(used: Set<string>): string {
  for (let n = 1; ; n++) {
    const name = `Room ${n}`;
    if (!used.has(name)) return name;
  }
}
