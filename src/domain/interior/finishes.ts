import { applyCommand } from "../commands/apply";
import type { PlanCommand } from "../commands/types";
import type { FloorMaterial, Id, PlanDocument, Room, RoomInteriorStyle, RoomPaint } from "../plan/types";

/**
 * Per-room finishes: the paint on the walls, the floor, and an optional
 * interior style of the room's own. Pure helpers a person, a button or an AI
 * tool can call; each returns either a command or a new document and never
 * touches the editor.
 */

export interface RoomFinishes {
  /** A paint from `PAINT_COLOURS`; `null` goes back to the house's off-white. */
  wallColour?: RoomPaint | null;
  floorMaterial?: FloorMaterial | null;
  /** The room's own interior style; `null` follows the project's. */
  interiorStyle?: RoomInteriorStyle | null;
}

/** The command that sets a room's finishes (only the fields given change). */
export function setRoomFinishesCommand(roomId: Id, finishes: RoomFinishes): PlanCommand {
  const changes: RoomFinishes = {};
  if (finishes.wallColour !== undefined) changes.wallColour = finishes.wallColour;
  if (finishes.floorMaterial !== undefined) changes.floorMaterial = finishes.floorMaterial;
  if (finishes.interiorStyle !== undefined) changes.interiorStyle = finishes.interiorStyle;
  return { type: "updateRoom", roomId, changes };
}

/** The document with a room's finishes changed, or null if the room is missing or a value is invalid. */
export function setRoomFinishes(document: PlanDocument, roomId: Id, finishes: RoomFinishes): PlanDocument | null {
  const result = applyCommand(document, setRoomFinishesCommand(roomId, finishes));
  return result.ok ? result.document : null;
}

/** The style a room is shown in: its own, else the project's. */
export const roomStyle = (room: Pick<Room, "interiorStyle">, projectStyle: RoomInteriorStyle): RoomInteriorStyle => room.interiorStyle ?? projectStyle;
