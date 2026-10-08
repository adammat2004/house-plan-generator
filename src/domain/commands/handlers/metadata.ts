import { LIMITS } from "../../plan/defaults";
import { EXTERNAL_WALL_PREFERENCES, FLOOR_MATERIALS, ROOM_TYPES } from "../../plan/schema";
import type { Id, Level, Room } from "../../plan/types";
import { fail } from "../ops";
import type { RoomChanges } from "../types";

const MAX_AREA = 10_000;
type OptionalKey = "targetArea" | "minArea" | "maxArea" | "floorMaterial" | "externalWall";

export function updateRoom(level: Level, roomId: Id, changes: RoomChanges): Level {
  const room = level.rooms[roomId];
  if (!room) fail("not-found", "That room no longer exists.", [roomId]);
  if (!changes || typeof changes !== "object") fail("invalid-value", "Nothing to change.", [roomId]);
  const next: Room = { ...room };
  if (changes.name !== undefined) {
    const trimmed = typeof changes.name === "string" ? changes.name.trim() : "";
    if (trimmed.length === 0) fail("invalid-value", "Room name can't be empty.", [roomId]);
    if (trimmed.length > LIMITS.maxNameLength) {
      fail("invalid-value", `Room name must be at most ${LIMITS.maxNameLength} characters.`, [roomId]);
    }
    next.name = trimmed;
  }
  if (changes.type !== undefined) {
    if (!(ROOM_TYPES as readonly string[]).includes(changes.type)) fail("invalid-value", "Unknown room type.", [roomId]);
    next.type = changes.type;
  }
  const setOptional = <K extends OptionalKey>(key: K, value: Room[K] | null | undefined) => {
    if (value === undefined) return;
    if (value === null) delete next[key];
    else next[key] = value;
  };
  for (const key of ["targetArea", "minArea", "maxArea"] as const) {
    const value = changes[key];
    if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_AREA)) {
      fail("invalid-value", `Areas must be between 0 and ${MAX_AREA} m².`, [roomId]);
    }
    setOptional(key, value === null || value === undefined ? value : Math.round(value * 100) / 100);
  }
  if (changes.floorMaterial != null && !(FLOOR_MATERIALS as readonly string[]).includes(changes.floorMaterial)) {
    fail("invalid-value", "Unknown floor material.", [roomId]);
  }
  setOptional("floorMaterial", changes.floorMaterial);
  if (changes.externalWall != null && !(EXTERNAL_WALL_PREFERENCES as readonly string[]).includes(changes.externalWall)) {
    fail("invalid-value", "Unknown external wall preference.", [roomId]);
  }
  setOptional("externalWall", changes.externalWall);
  if (next.minArea !== undefined && next.maxArea !== undefined && next.minArea > next.maxArea) {
    fail("invalid-value", "Minimum area can't be larger than maximum area.", [roomId]);
  }
  if (JSON.stringify(next) === JSON.stringify(room)) return level;
  return { ...level, rooms: { ...level.rooms, [roomId]: next } };
}

export function setRearWall(level: Level, wallId: Id | null): Level {
  if (wallId !== null) {
    if (!level.walls[wallId]) fail("not-found", "That wall no longer exists.", [wallId]);
    if (!level.envelope.wallIds.includes(wallId)) {
      fail("rear-wall-invalid", "Only an external wall can be marked as the rear wall.", [wallId]);
    }
  }
  if (level.rearWallId === wallId) return level;
  return { ...level, rearWallId: wallId };
}
