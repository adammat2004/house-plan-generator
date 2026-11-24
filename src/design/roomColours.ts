import type { RoomType } from "@/domain/plan/types";
import { COLOR } from "./tokens";

/**
 * The one table of room colours, used wherever a plan is drawn schematically:
 * the 2D Plan view, layout cards and previews, the plain plan image, and the
 * swatches beside room names. Values are the `--room-*` tokens.
 *
 * Related types share a hue and differ in lightness (a primary bedroom is a
 * step deeper than a bedroom), so families stay apart for colour-blind
 * viewers too. Nothing is green: green means selection.
 */
export const ROOM_COLOUR: Record<RoomType, string> = {
  unspecified: COLOR["room-paper"],
  living: COLOR["room-living"],
  kitchen: COLOR["room-kitchen"],
  kitchen_dining: COLOR["room-kitchen"],
  dining: COLOR["room-kitchen"],
  bedroom: COLOR["room-bedroom"],
  primary_bedroom: COLOR["room-primary-bedroom"],
  office: COLOR["room-office"],
  bathroom: COLOR["room-bathroom"],
  ensuite: COLOR["room-bathroom"],
  wc: COLOR["room-wc"],
  utility: COLOR["room-utility"],
  storage: COLOR["room-storage"],
  garage: COLOR["room-garage"],
  hall: COLOR["room-hall"],
  other: COLOR["room-other"],
};

/** A room's colour on the schematic plan. Rooms with no use sit on plain paper. */
export function roomColour(type: RoomType): string {
  return ROOM_COLOUR[type];
}

/**
 * Rooms by the part of the day they serve, for comparing how plans zone a
 * house ("Day and night"): each family drawn in its lead colour.
 */
const ZONE_OF: Record<RoomType, RoomType> = {
  unspecified: "unspecified",
  living: "living",
  kitchen: "living",
  kitchen_dining: "living",
  dining: "living",
  office: "living",
  bedroom: "bedroom",
  primary_bedroom: "bedroom",
  bathroom: "bathroom",
  ensuite: "bathroom",
  wc: "bathroom",
  utility: "utility",
  storage: "hall",
  garage: "garage",
  hall: "hall",
  other: "other",
};

/** A room's colour in the "Day and night" view: its zone's. */
export function zoneColour(type: RoomType): string {
  return ROOM_COLOUR[ZONE_OF[type]];
}

/** Room types with no use of their own, drawn as paper with a dashed inner edge. */
export function isUntyped(type: RoomType): boolean {
  return type === "unspecified";
}
