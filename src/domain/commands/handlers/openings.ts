import { roundToPrecision } from "../../geometry/numeric";
import { LIMITS } from "../../plan/defaults";
import type { Id, Level, Opening } from "../../plan/types";
import { fail, requireFinite, requireLength } from "../ops";
import type { OpeningChanges } from "../types";

function normaliseOpening(opening: Opening): Opening {
  const offset = roundToPrecision(requireFinite(opening.offset, "Opening offset"));
  if (offset < 0) fail("opening-out-of-bounds", "An opening can't start before the start of its wall.", [opening.id]);
  const width = requireLength(opening.width, "Opening width", LIMITS.minOpeningWidth, 20);
  const height = requireLength(opening.height, "Opening height", 0.1, LIMITS.maxWallHeight);
  const base = { id: opening.id, wallId: opening.wallId, offset, width, height };
  if (opening.kind === "door") {
    if (opening.hinge !== "start" && opening.hinge !== "end") fail("invalid-value", "Door hinge must be start or end.");
    if (opening.swingSide !== "left" && opening.swingSide !== "right") {
      fail("invalid-value", "Door swing must be left or right.");
    }
    return { ...base, kind: "door", hinge: opening.hinge, swingSide: opening.swingSide };
  }
  if (opening.kind === "window") {
    const sillHeight = requireLength(opening.sillHeight, "Sill height", 0, LIMITS.maxWallHeight);
    return { ...base, kind: "window", sillHeight };
  }
  fail("invalid-value", "Unknown opening type.");
}

export function addOpening(level: Level, input: Opening): Level {
  if (!input || typeof input.id !== "string" || input.id.length === 0) fail("invalid-value", "Opening needs an id.");
  if (level.openings[input.id] || level.walls[input.id] || level.rooms[input.id]) {
    fail("invalid-value", "An entity with that id already exists.", [input.id]);
  }
  if (!level.walls[input.wallId]) fail("not-found", "Openings must be placed on an existing wall.", [input.wallId]);
  const opening = normaliseOpening(input);
  return { ...level, openings: { ...level.openings, [opening.id]: opening } };
}

export function updateOpening(level: Level, openingId: Id, changes: OpeningChanges): Level {
  const current = level.openings[openingId];
  if (!current) fail("not-found", "That opening no longer exists.", [openingId]);
  if (changes.wallId !== undefined && !level.walls[changes.wallId]) {
    fail("not-found", "Openings must be placed on an existing wall.", [changes.wallId]);
  }
  const merged: Opening =
    current.kind === "door"
      ? {
          ...current,
          wallId: changes.wallId ?? current.wallId,
          offset: changes.offset ?? current.offset,
          width: changes.width ?? current.width,
          height: changes.height ?? current.height,
          hinge: changes.hinge ?? current.hinge,
          swingSide: changes.swingSide ?? current.swingSide,
        }
      : {
          ...current,
          wallId: changes.wallId ?? current.wallId,
          offset: changes.offset ?? current.offset,
          width: changes.width ?? current.width,
          height: changes.height ?? current.height,
          sillHeight: changes.sillHeight ?? current.sillHeight,
        };
  const opening = normaliseOpening(merged);
  if (JSON.stringify(opening) === JSON.stringify(current)) return level;
  return { ...level, openings: { ...level.openings, [openingId]: opening } };
}

export function deleteOpening(level: Level, openingId: Id): Level {
  if (!level.openings[openingId]) fail("not-found", "That opening no longer exists.", [openingId]);
  const openings = { ...level.openings };
  delete openings[openingId];
  return { ...level, openings };
}
