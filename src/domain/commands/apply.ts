import { deriveLevelGeometry } from "../geometry/derive";
import { analyzeEnvelope } from "../geometry/envelope";
import { levelHas, levelIndex, replaceLevel, restack } from "../plan/levels";
import type { Id, Level, PlanDocument, Point2 } from "../plan/types";
import { createFootprint, resizeFootprint } from "./handlers/footprint";
import { addFurniture, deleteFurniture, replaceFurniture, updateFurniture } from "./handlers/furniture";
import { addLevel, removeLevel, updateLevel } from "./handlers/levels";
import { setRearWall, updateRoom } from "./handlers/metadata";
import { addOpening, deleteOpening, updateOpening } from "./handlers/openings";
import { createOutline, moveOutlineEdge } from "./handlers/outline";
import { addStairs, deleteStairs, updateStairs } from "./handlers/stairs";
import { addWall, deleteWall, moveWall, moveWallEndpoint, updateWall } from "./handlers/walls";
import { IdSource } from "./ids";
import { pinnedMessage, pinnedRoomChanges, roomPinnedBy } from "./locks";
import { CommandFailure, fail } from "./ops";
import { reconcileRooms } from "./reconcile";
import { loadPlanDocument } from "./serialization";
import { carryUp, onFloorIssues, validateStack } from "./stack";
import type { CommandResult, PlanCommand, PlanIssue } from "./types";
import { validateLevelSemantics, validateLevelStructure } from "./validate";

/**
 * Applies one command as an atomic transaction:
 * transform → carry up to the floors above → derive topology → reconcile
 * rooms → validate → check pins → restack the floors → check between floors → commit.
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

  const ids = new IdSource(command.idPrefix, document);
  const edit = transform(document, command, ids);
  if (edit.document === document) return unchanged(document);

  const settled = settle(document, edit, ids);
  if (!settled.ok) return settled;
  let next = settled.document;
  if (next.levels.length > 1 || next.staircases) {
    next = restack(next);
    const issues = validateStack(next);
    if (issues.length) return { ok: false, issues };
  }
  return { ok: true, document: next, createdIds: ids.created, changed: true };
}

interface Edit {
  document: PlanDocument;
  /** The floor the command acts on. */
  target: number;
  /** Floors built afresh: their rooms start over rather than following the old ones. */
  fresh: Set<Id>;
}

/** The entity a command names, whose floor it acts on. */
function namedEntity(command: PlanCommand): Id | null | undefined {
  switch (command.type) {
    case "moveOutlineEdge":
    case "moveWall":
    case "moveWallEndpoint":
    case "updateWall":
    case "deleteWall":
    case "setRearWall":
      return command.wallId;
    case "addOpening":
      return command.opening?.wallId;
    case "updateOpening":
    case "deleteOpening":
      return command.openingId;
    case "updateRoom":
      return command.roomId;
    case "updateFurniture":
    case "deleteFurniture":
      return command.furnitureId;
    case "replaceFurniture":
      return Array.isArray(command.remove) ? command.remove[0] : null;
    default:
      return null;
  }
}

/** The floor a command acts on: the one it names, else the one holding what it names, else the ground floor. */
function targetIndex(document: PlanDocument, command: PlanCommand): number {
  if (command.levelId !== undefined) {
    const index = levelIndex(document, command.levelId);
    if (index < 0) fail("not-found", "That floor no longer exists.", [command.levelId]);
    return index;
  }
  const id = namedEntity(command);
  const index = typeof id === "string" ? document.levels.findIndex((l) => levelHas(l, id)) : -1;
  return Math.max(index, 0);
}

/** Where an upper floor's new rectangle starts: over the floor below's lower-left outside corner. */
function cornerOf(level: Level): Point2 {
  const env = analyzeEnvelope(level);
  return env.ok ? { x: env.info.outsideRect.minX, y: env.info.outsideRect.minY } : { x: 0, y: 0 };
}

/** Commands that edit floors, as opposed to replacing or renaming the whole document. */
type FloorCommand = Exclude<PlanCommand, { type: "renameDocument" | "replaceDocument" }>;

function transform(document: PlanDocument, command: FloorCommand, ids: IdSource): Edit {
  if (command.type === "addLevel") {
    const doc = addLevel(document, command, ids);
    return { document: doc, target: doc.levels.length - 1, fresh: new Set([doc.levels[doc.levels.length - 1].id]) };
  }
  if (command.type === "removeLevel") return { document: removeLevel(document, command.levelId), target: 0, fresh: new Set() };
  if (command.type === "addStairs" || command.type === "updateStairs" || command.type === "deleteStairs") {
    const doc =
      command.type === "addStairs"
        ? addStairs(document, command.staircase, ids)
        : command.type === "updateStairs"
          ? updateStairs(document, command.staircaseId, command.changes)
          : deleteStairs(document, command.staircaseId);
    return { document: doc, target: 0, fresh: new Set() };
  }

  const index = targetIndex(document, command);
  const level = document.levels[index];
  if (!level) fail("invalid-structure", "The document has no level.");
  // A wall around a pinned room stays put (its height may change): say so before anything else the edit would break.
  if (command.type === "moveWall" || command.type === "deleteWall" || (command.type === "updateWall" && command.thickness !== undefined)) {
    const room = roomPinnedBy(level, command.wallId);
    if (room) fail("room-pinned", pinnedMessage(room.name), [room.id]);
  }
  const fresh = new Set<Id>();
  let next: Level;

  switch (command.type) {
    case "createFootprint":
      next = createFootprint(level, command, ids, index > 0 ? cornerOf(document.levels[index - 1]) : undefined);
      fresh.add(level.id);
      break;
    case "createOutline":
      next = createOutline(level, command, ids, { asDrawn: index > 0 });
      fresh.add(level.id);
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
      if (typeof command.opening?.id === "string" && ids.isTaken(command.opening.id)) fail("invalid-value", "An entity with that id already exists.", [command.opening.id]);
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
      if (typeof command.item?.id === "string" && ids.isTaken(command.item.id)) fail("invalid-value", "An entity with that id already exists.", [command.item.id]);
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
      for (const item of command.add) {
        if (typeof item?.id === "string" && ids.isTaken(item.id) && !command.remove.includes(item.id)) fail("invalid-value", "An entity with that id already exists.", [item.id]);
      }
      next = replaceFurniture(level, command.remove, command.add);
      for (const item of command.add) ids.reserve(item.id);
      break;
    case "setRearWall":
      next = setRearWall(level, command.wallId);
      break;
    case "updateLevel":
      next = updateLevel(document, index, command);
      break;
    default: {
      const unknown: never = command;
      fail("invalid-value", `Unknown command ${(unknown as { type: string }).type}.`);
    }
  }

  if (next === level) return { document, target: index, fresh };
  let doc = replaceLevel(document, index, next);
  if ((command.type === "createFootprint" || command.type === "createOutline") && command.name?.trim()) doc = { ...doc, name: command.name.trim() };
  if (document.levels.length > 1) doc = carryUp(document, doc, index, command, ids, fresh);
  return { document: doc, target: index, fresh };
}

type Settled = { ok: true; document: PlanDocument } | { ok: false; issues: PlanIssue[] };

/** Derives, reconciles and validates every floor the edit changed. Problems on another floor than the one edited say which. */
function settle(before: PlanDocument, edit: Edit, ids: IdSource): Settled {
  const after = edit.document;
  let document = after;
  for (const [i, level] of after.levels.entries()) {
    const previous = before.levels.find((l) => l.id === level.id) ?? null;
    if (previous === level) continue;
    const elsewhere = after.levels.length > 1 ? after.levels.filter((_, j) => j !== i).flatMap((l) => Object.values(l.rooms).map((r) => r.name)) : [];
    const result = settleLevel(edit.fresh.has(level.id) ? null : previous, previous, level, ids, elsewhere);
    if (!result.ok) return { ok: false, issues: i === edit.target ? result.issues : onFloorIssues(i, result.issues) };
    document = replaceLevel(document, i, result.level);
  }
  return { ok: true, document };
}

type SettledLevel = { ok: true; level: Level } | { ok: false; issues: PlanIssue[] };

function settleLevel(reconcileFrom: Level | null, previous: Level | null, level: Level, ids: IdSource, namesElsewhere: readonly string[]): SettledLevel {
  let next = level;
  const geometry = deriveLevelGeometry(next);
  const structural = validateLevelStructure(next, geometry);
  if (structural.length) return { ok: false, issues: structural };

  const geometryChanged =
    reconcileFrom === null ||
    next.walls !== reconcileFrom.walls ||
    next.vertices !== reconcileFrom.vertices ||
    next.envelope !== reconcileFrom.envelope;
  if (geometryChanged) next = reconcileRooms(reconcileFrom, next, ids, namesElsewhere);

  const semantic = validateLevelSemantics(next, geometry);
  if (semantic.length) return { ok: false, issues: semantic };

  // Pinned rooms keep their shape, doors and windows. Furniture stays free.
  if (previous && (geometryChanged || next.openings !== previous.openings)) {
    const pinned = pinnedRoomChanges(previous, next, { furniture: false });
    if (pinned.length) {
      return { ok: false, issues: pinned.map((p) => ({ code: "room-pinned", message: pinnedMessage(p.name), entityIds: [p.roomId] })) };
    }
  }
  return { ok: true, level: next };
}

function unchanged(document: PlanDocument): CommandResult {
  return { ok: true, document, createdIds: [], changed: false };
}
