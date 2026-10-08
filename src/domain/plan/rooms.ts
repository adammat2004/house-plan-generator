import type { Id, Level, RoomType } from "./types";

/** Display names for room types; also the default name of a typed room. */
export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  unspecified: "Unassigned",
  living: "Living Room",
  kitchen: "Kitchen",
  kitchen_dining: "Kitchen / Dining",
  dining: "Dining Room",
  bedroom: "Bedroom",
  primary_bedroom: "Primary Bedroom",
  bathroom: "Bathroom",
  ensuite: "Ensuite",
  wc: "WC",
  utility: "Utility",
  hall: "Hall",
  office: "Office",
  storage: "Storage",
  garage: "Garage",
  other: "Other",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** True when a name was generated (e.g. "Room 3", "Bedroom 2") rather than chosen by the user. */
export function isGeneratedRoomName(name: string, type: RoomType): boolean {
  if (/^Room \d+$/.test(name)) return true;
  return type !== "unspecified" && new RegExp(`^${escape(ROOM_TYPE_LABEL[type])}( \\d+)?$`).test(name);
}

/** A name for a room of `type` that no other room on the level uses: "Bedroom", then "Bedroom 2"… */
export function suggestRoomName(level: Level, roomId: Id | null, type: RoomType): string {
  const base = type === "unspecified" ? "Room" : ROOM_TYPE_LABEL[type];
  const taken = new Set(Object.values(level.rooms).filter((r) => r.id !== roomId).map((r) => r.name));
  if (type !== "unspecified" && !taken.has(base)) return base;
  for (let n = type === "unspecified" ? 1 : 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}
