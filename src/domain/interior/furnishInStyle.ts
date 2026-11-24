import { applyCommand } from "../commands/apply";
import type { PlanCommand } from "../commands/types";
import { canFurnish, furnishRoom } from "../furniture/furnish";
import { levelKeepOut } from "../geometry/stairs";
import type { FurnitureKind, Furniture, Id, PlanDocument, RoomInteriorStyle } from "../plan/types";

/**
 * "Furnish in style": lays out rooms from their type, records the style on
 * each room, and replaces what was there. The result is a list of commands
 * the caller applies as one undoable step (`applyCommands`, or the editor's
 * `dispatchBatch`). For a given document, options and seed the answer is
 * always the same; a different seed gives another arrangement.
 */

export interface FurnishInStyleOptions {
  style: RoomInteriorStyle;
  /** Rooms to furnish; absent means every furnishable, unpinned room on every floor. */
  roomIds?: Id[];
  /** 0 is the usual layout; other numbers give other arrangements. */
  seed?: number;
  /** Prefix for the new furniture's ids; must not collide with existing ids. */
  idPrefix: string;
}

export interface FurnishInStyleResult {
  commands: PlanCommand[];
  /** Rooms that were furnished. */
  furnished: Id[];
  /** Rooms asked for that can't be furnished (unknown type, or not on the plan). */
  skipped: Id[];
  /** Pieces some room needed but had no space for. */
  missing: Array<{ roomId: Id; kinds: FurnitureKind[] }>;
  /** Number of pieces placed. */
  placed: number;
}

/** The commands that furnish rooms in a style, or null when there is nothing to furnish. */
export function furnishInStyleCommands(document: PlanDocument, options: FurnishInStyleOptions): FurnishInStyleResult | null {
  const { style, idPrefix, seed = 0 } = options;
  const wanted = options.roomIds ? new Set(options.roomIds) : null;
  const commands: PlanCommand[] = [];
  const furnished: Id[] = [];
  const skipped: Id[] = [];
  const missing: FurnishInStyleResult["missing"] = [];
  let placed = 0;

  for (const level of document.levels) {
    const keepOut = levelKeepOut(document, level.id);
    const remove: Id[] = [];
    const add: Furniture[] = [];
    for (const room of Object.values(level.rooms)) {
      if (wanted && !wanted.has(room.id)) continue;
      // Naming a pinned room is a deliberate choice; sweeping the whole house leaves pinned rooms alone.
      if (!canFurnish(room.type) || (!wanted && room.locked)) {
        if (wanted) skipped.push(room.id);
        continue;
      }
      const result = furnishRoom(level, room.id, `${idPrefix}-${room.id}`, { keepOut, seed });
      if (!result) {
        skipped.push(room.id);
        continue;
      }
      remove.push(...result.remove);
      add.push(...result.items);
      furnished.push(room.id);
      if (result.missing.length) missing.push({ roomId: room.id, kinds: result.missing });
      commands.push({ type: "updateRoom", roomId: room.id, changes: { interiorStyle: style } });
    }
    if (remove.length || add.length) {
      commands.push(document.levels.length > 1 ? { type: "replaceFurniture", levelId: level.id, remove, add } : { type: "replaceFurniture", remove, add });
      placed += add.length;
    }
  }
  if (wanted) for (const id of wanted) if (!furnished.includes(id) && !skipped.includes(id)) skipped.push(id);
  if (!furnished.length) return null;
  return { commands, furnished, skipped, missing, placed };
}

/** Applies commands in order; null if any is refused, so nothing is half done. */
export function applyCommands(document: PlanDocument, commands: PlanCommand[]): PlanDocument | null {
  let doc = document;
  for (const command of commands) {
    const result = applyCommand(doc, command);
    if (!result.ok) return null;
    doc = result.document;
  }
  return doc;
}

/** The document with rooms furnished in a style, plus what happened; null when nothing could be furnished. */
export function furnishInStyle(document: PlanDocument, options: FurnishInStyleOptions): (FurnishInStyleResult & { document: PlanDocument }) | null {
  const result = furnishInStyleCommands(document, options);
  if (!result) return null;
  const next = applyCommands(document, result.commands);
  return next ? { ...result, document: next } : null;
}
