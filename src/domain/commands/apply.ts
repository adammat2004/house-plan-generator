import { deriveLevelGeometry } from "../geometry/derive";
import type { Level, PlanDocument } from "../plan/types";
import { createFootprint, resizeFootprint } from "./handlers/footprint";
import { addFurniture, deleteFurniture, replaceFurniture, updateFurniture } from "./handlers/furniture";
import { setRearWall, updateRoom } from "./handlers/metadata";
import { addOpening, deleteOpening, updateOpening } from "./handlers/openings";
import { createOutline, moveOutlineEdge } from "./handlers/outline";
import { addWall, deleteWall, moveWall, moveWallEndpoint, updateWall } from "./handlers/walls";
import { IdSource } from "./ids";
import { CommandFailure, fail } from "./ops";
import { reconcileRooms } from "./reconcile";
import { loadPlanDocument } from "./serialization";
import type { CommandResult, PlanCommand } from "./types";
import { validateLevelSemantics, validateLevelStructure } from "./validate";

/**
 * Applies one command as an atomic transaction:
 * transform → derive topology → reconcile rooms → validate → commit.
 *
 * Pure: the input document is never mutated, and a failure returns
 * structured issues while the caller keeps its last valid document.
 */
export function applyCommand(document: PlanDocument, command: PlanCommand): CommandResult {
  try {
    return run(document, command);
  } catch (error) {
    if (error instanceof CommandFailure) return { ok: false, issues: error.issues };
    throw error;
  }
}

function run(document: PlanDocument, command: PlanCommand): CommandResult {
  if (command.type === "replaceDocument") {
    const loaded = loadPlanDocument(command.document);
    if (!loaded.ok) return { ok: false, issues: loaded.issues };
    return { ok: true, document: loaded.document, createdIds: [], changed: true };
  }
  if (command.type === "renameDocument") {
    const name = typeof command.name === "string" ? command.name.trim() : "";
    if (name.length === 0) fail("invalid-value", "Project name can't be empty.");
    if (name.length > 200) fail("invalid-value", "Project name must be at most 200 characters.");
    if (name === document.name) return unchanged(document);
    return { ok: true, document: { ...document, name }, createdIds: [], changed: true };
  }

  const level = document.levels[0];
  if (!level) fail("invalid-structure", "The document has no level.");
  const ids = new IdSource(command.idPrefix, level);
  let next: Level;
  let reconcileFrom: Level | null = level;

  switch (command.type) {
    case "createFootprint":
      next = createFootprint(level, command, ids);
      reconcileFrom = null;
      break;
    case "createOutline":
      next = createOutline(level, command, ids);
      reconcileFrom = null;
      break;
    case "resizeFootprint":
      next = resizeFootprint(level, command);
      break;
    case "moveOutlineEdge":
      next = moveOutlineEdge(level, command, ids);
      break;
    case "addWall":
      next = addWall(level, command, ids);
      break;
    case "moveWall":
      next = moveWall(level, command, ids);
      break;
    case "moveWallEndpoint":
      next = moveWallEndpoint(level, command, ids);
      break;
    case "updateWall":
      next = updateWall(level, command);
      break;
    case "deleteWall":
      next = deleteWall(level, command.wallId);
      break;
    case "addOpening":
      next = addOpening(level, command.opening);
      ids.reserve(command.opening.id);
      break;
    case "updateOpening":
      next = updateOpening(level, command.openingId, command.changes);
      break;
    case "deleteOpening":
      next = deleteOpening(level, command.openingId);
      break;
    case "updateRoom":
      next = updateRoom(level, command.roomId, command.changes);
      break;
    case "addFurniture":
      next = addFurniture(level, command.item);
      ids.reserve(command.item.id);
      break;
    case "updateFurniture":
      next = updateFurniture(level, command.furnitureId, command.changes);
      break;
    case "deleteFurniture":
      next = deleteFurniture(level, [command.furnitureId]);
      break;
    case "replaceFurniture":
      if (!Array.isArray(command.remove) || !Array.isArray(command.add)) fail("invalid-value", "Nothing to change.");
      next = replaceFurniture(level, command.remove, command.add);
      for (const item of command.add) ids.reserve(item.id);
      break;
    case "setRearWall":
      next = setRearWall(level, command.wallId);
      break;
    default: {
      const unknown: never = command;
      fail("invalid-value", `Unknown command ${(unknown as { type: string }).type}.`);
    }
  }

  if (next === level) return unchanged(document);

  const geometry = deriveLevelGeometry(next);
  const structural = validateLevelStructure(next, geometry);
  if (structural.length) return { ok: false, issues: structural };

  const geometryChanged =
    reconcileFrom === null ||
    next.walls !== level.walls ||
    next.vertices !== level.vertices ||
    next.envelope !== level.envelope;
  if (geometryChanged) next = reconcileRooms(reconcileFrom, next, ids);

  const semantic = validateLevelSemantics(next, geometry);
  if (semantic.length) return { ok: false, issues: semantic };

  const nextDocument: PlanDocument =
    (command.type === "createFootprint" || command.type === "createOutline") && command.name?.trim()
      ? { ...document, name: command.name.trim(), levels: [next, ...document.levels.slice(1)] }
      : { ...document, levels: [next, ...document.levels.slice(1)] };
  return { ok: true, document: nextDocument, createdIds: ids.created, changed: true };
}

function unchanged(document: PlanDocument): CommandResult {
  return { ok: true, document, createdIds: [], changed: false };
}
