import { roundToPrecision } from "../../geometry/numeric";
import { FURNITURE_LIMITS } from "../../furniture/catalog";
import { FURNITURE_KINDS, FURNITURE_ROTATIONS } from "../../plan/schema";
import type { Furniture, Id, Level } from "../../plan/types";
import { fail, requireFinite, requireLength } from "../ops";
import type { FurnitureChanges } from "../types";

/**
 * Furniture stands in plan space and never constrains walls, so these
 * handlers only check the item itself. Where it stands (inside a room,
 * clear of walls and doors) is reported by `furnitureIssues`, not enforced.
 */
function normalise(item: Furniture): Furniture {
  if (!(FURNITURE_KINDS as readonly string[]).includes(item.kind)) fail("invalid-value", "Unknown kind of furniture.", [item.id]);
  if (!(FURNITURE_ROTATIONS as readonly number[]).includes(item.rotation)) {
    fail("invalid-value", "Furniture turns in quarter turns: 0, 90, 180 or 270 degrees.", [item.id]);
  }
  const { minSize, maxSize, minHeight, maxHeight } = FURNITURE_LIMITS;
  return {
    id: item.id,
    kind: item.kind,
    position: {
      x: roundToPrecision(requireFinite(item.position?.x, "Furniture position")),
      y: roundToPrecision(requireFinite(item.position?.y, "Furniture position")),
    },
    rotation: item.rotation,
    width: requireLength(item.width, "Width", minSize, maxSize),
    depth: requireLength(item.depth, "Depth", minSize, maxSize),
    height: requireLength(item.height, "Height", minHeight, maxHeight),
  };
}

export function addFurniture(level: Level, input: Furniture): Level {
  if (!input || typeof input.id !== "string" || input.id.length === 0) fail("invalid-value", "Furniture needs an id.");
  if (level.furniture[input.id] || level.openings[input.id] || level.walls[input.id] || level.rooms[input.id]) {
    fail("invalid-value", "An entity with that id already exists.", [input.id]);
  }
  const item = normalise(input);
  return { ...level, furniture: { ...level.furniture, [item.id]: item } };
}

export function updateFurniture(level: Level, furnitureId: Id, changes: FurnitureChanges): Level {
  const current = level.furniture[furnitureId];
  if (!current) fail("not-found", "That piece of furniture no longer exists.", [furnitureId]);
  if (!changes || typeof changes !== "object") fail("invalid-value", "Nothing to change.", [furnitureId]);
  const item = normalise({
    ...current,
    position: changes.position ?? current.position,
    rotation: changes.rotation ?? current.rotation,
    width: changes.width ?? current.width,
    depth: changes.depth ?? current.depth,
    height: changes.height ?? current.height,
  });
  if (JSON.stringify(item) === JSON.stringify(current)) return level;
  return { ...level, furniture: { ...level.furniture, [furnitureId]: item } };
}

export function deleteFurniture(level: Level, furnitureIds: Id[]): Level {
  if (!furnitureIds.length) return level;
  const furniture = { ...level.furniture };
  for (const id of furnitureIds) {
    if (!furniture[id]) fail("not-found", "That piece of furniture no longer exists.", [id]);
    delete furniture[id];
  }
  return { ...level, furniture };
}

/** Removes `remove`, then adds `add`, as one edit (furnishing or clearing a room). */
export function replaceFurniture(level: Level, remove: Id[], add: Furniture[]): Level {
  let next = deleteFurniture(level, remove.filter((id) => level.furniture[id]));
  for (const item of add) next = addFurniture(next, item);
  return next;
}
