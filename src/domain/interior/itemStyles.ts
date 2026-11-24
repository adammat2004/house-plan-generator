import { roomAtPoint } from "../design/analysis";
import type { Furniture, Id, Level } from "../plan/types";
import type { InteriorStyle } from "../project/schema";

/**
 * Which interior style each piece of furniture is shown in: its room's own
 * style where the room has one, else the house's. Pure, so the plan, the 3D
 * view and tests all agree.
 */

/** The style to show a piece in; undefined for the library's default. */
export type StyleOf = (item: Pick<Furniture, "id">) => InteriorStyle | undefined;

/** A fixed style for every piece, or a per-piece resolver. */
export type StyleArg = InteriorStyle | undefined | StyleOf;

export const styleOfItem = (style: StyleArg, item: Pick<Furniture, "id">): InteriorStyle | undefined => (typeof style === "function" ? style(item) : style);

/** The own style of the room each piece stands in, for the pieces whose room has one. */
export function itemRoomStyles(level: Level): Map<Id, InteriorStyle> {
  const own = new Map<Id, InteriorStyle>();
  const styled = Object.values(level.rooms).some((r) => r.interiorStyle);
  if (!styled) return own;
  for (const item of Object.values(level.furniture)) {
    const roomId = roomAtPoint(level, item.position);
    const style = roomId ? level.rooms[roomId]?.interiorStyle : undefined;
    if (style) own.set(item.id, style);
  }
  return own;
}

/** Resolves every piece on the given levels: its room's own style, else `house`. */
export function styleResolver(levels: Level[], house: InteriorStyle | undefined): StyleOf {
  const own = new Map<Id, InteriorStyle>();
  for (const level of levels) for (const [id, style] of itemRoomStyles(level)) own.set(id, style);
  return (item) => own.get(item.id) ?? house;
}
