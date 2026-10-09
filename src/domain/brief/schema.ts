import { z } from "zod";
import { cleanPicks, pickedBathrooms, pickedBedrooms, pickedSpaces, reconcilePicks, ROOM_PICKS, type RoomPicks } from "./rooms";

/**
 * The user's structured design brief. Free text supplements these fields;
 * planners must never depend on the free text alone.
 */

/** Optional day spaces the brief can ask for; bedrooms and bathrooms are counted separately. */
export const BRIEF_SPACES = ["kitchen", "living", "dining", "office", "utility", "garage"] as const;

/** Closed preference vocabulary shared by the UI, the planners and any future language model. */
export const PREFERENCE_IDS = [
  "open_plan",
  "kitchen_faces_garden",
  "primary_bedroom_private",
  "maximize_natural_light",
  "separate_living_room",
  "home_office",
  "large_kitchen",
  "utility_near_kitchen",
  "accessible_layout",
] as const;

export const BRIEF_LIMITS = { maxBedrooms: 8, maxBathrooms: 6, maxInstructions: 2000 } as const;

/** Room groups whose approximate size the brief can set. */
export const SIZED_ROOMS = ["living", "kitchen", "bedrooms"] as const;
export const ROOM_SIZES = ["compact", "standard", "generous"] as const;

/** House shapes the planner can choose when it sizes the house from the rooms. */
export const HOUSE_SHAPES = ["any", "rectangle", "L", "T", "U"] as const;

export const houseBriefSchema = z.object({
  bedrooms: z.number().int().min(0).max(BRIEF_LIMITS.maxBedrooms),
  bathrooms: z.number().int().min(0).max(BRIEF_LIMITS.maxBathrooms),
  requiredSpaces: z.array(z.enum(BRIEF_SPACES)),
  preferences: z.array(z.enum(PREFERENCE_IDS)),
  /** Optional: absent groups (and briefs saved before sizes existed) are "standard". */
  roomSizes: z.partialRecord(z.enum(SIZED_ROOMS), z.enum(ROOM_SIZES)).optional(),
  additionalInstructions: z.string().max(BRIEF_LIMITS.maxInstructions),
  /** Optional: rooms picked one by one; when present, the counts and spaces above follow from them. */
  rooms: z.partialRecord(z.enum(ROOM_PICKS), z.number().int().min(0).max(8)).optional(),
  /**
   * Optional: the shape of house wanted when its size comes from the rooms.
   * Absent means a rectangle, as before shapes existed; "any" lets the planner choose.
   */
  houseShape: z.enum(HOUSE_SHAPES).optional(),
});

export type HouseBrief = z.infer<typeof houseBriefSchema>;
export type BriefSpace = (typeof BRIEF_SPACES)[number];
export type PreferenceId = (typeof PREFERENCE_IDS)[number];
export type SizedRoom = (typeof SIZED_ROOMS)[number];
export type RoomSize = (typeof ROOM_SIZES)[number];
export type HouseShape = (typeof HOUSE_SHAPES)[number];

export const HOUSE_SHAPE_LABEL: Record<HouseShape, string> = { any: "Any shape", rectangle: "Rectangle", L: "L-shape", T: "T-shape", U: "U-shape" };

/** How a change of house shape is described to the user. */
export function houseShapeStep(shape: HouseShape): string {
  if (shape === "any") return "The planner may choose the house's shape";
  if (shape === "rectangle") return "The brief now asks for a rectangular house";
  return `The brief now asks for ${shape === "L" ? "an" : "a"} ${shape}-shaped house`;
}

/** Multiplier applied to a group's target areas. */
export const ROOM_SIZE_FACTOR: Record<RoomSize, number> = { compact: 0.85, standard: 1, generous: 1.2 };

export const roomSizeOf = (brief: HouseBrief, group: SizedRoom): RoomSize => brief.roomSizes?.[group] ?? "standard";

export const DEFAULT_BRIEF: HouseBrief = {
  bedrooms: 3,
  bathrooms: 2,
  requiredSpaces: ["kitchen", "living", "dining"],
  preferences: [],
  additionalInstructions: "",
};

export const BRIEF_SPACE_LABEL: Record<BriefSpace, string> = {
  kitchen: "Kitchen",
  living: "Living room",
  dining: "Dining",
  office: "Office",
  utility: "Utility",
  garage: "Garage",
};

export const SIZED_ROOM_LABEL: Record<SizedRoom, string> = {
  living: "Living space",
  kitchen: "Kitchen",
  bedrooms: "Bedrooms",
};

export const ROOM_SIZE_LABEL: Record<RoomSize, string> = { compact: "Compact", standard: "Standard", generous: "Generous" };

export const PREFERENCE_LABEL: Record<PreferenceId, string> = {
  open_plan: "Open-plan kitchen/living",
  kitchen_faces_garden: "Kitchen facing garden",
  primary_bedroom_private: "Primary bedroom away from living areas",
  maximize_natural_light: "Lots of natural light",
  separate_living_room: "Separate living room",
  home_office: "Home office",
  large_kitchen: "Large kitchen",
  utility_near_kitchen: "Utility near kitchen",
  accessible_layout: "Accessible layout",
};

/**
 * Canonical form: lists deduplicated and in vocabulary order, and "standard"
 * sizes left out, so equal briefs compare and serialise identically.
 */
export function normaliseBrief(brief: HouseBrief): HouseBrief {
  const { roomSizes, rooms, houseShape, ...parsed } = houseBriefSchema.parse(brief);
  const sizes = SIZED_ROOMS.filter((g) => roomSizes?.[g] && roomSizes[g] !== "standard").map((g) => [g, roomSizes![g]] as const);
  const base = {
    ...parsed,
    requiredSpaces: BRIEF_SPACES.filter((s) => parsed.requiredSpaces.includes(s)),
    preferences: PREFERENCE_IDS.filter((p) => parsed.preferences.includes(p)),
    ...(sizes.length ? { roomSizes: Object.fromEntries(sizes) } : {}),
    // A rectangle is what no preference means.
    ...(houseShape && houseShape !== "rectangle" ? { houseShape } : {}),
  };
  if (!rooms) return base;
  // Counts and spaces changed some other way (the AI reader) carry over into the picks.
  const picks = reconcilePicks(rooms, { bedrooms: base.bedrooms, bathrooms: base.bathrooms, spaces: base.requiredSpaces });
  return withPicks(base, picks);
}

/** The brief with rooms picked one by one, and the counts and spaces that follow from them. */
export function withPicks(brief: HouseBrief, picks: RoomPicks): HouseBrief {
  const rooms = cleanPicks(picks);
  const spaces = pickedSpaces(rooms);
  return {
    ...brief,
    bedrooms: Math.min(pickedBedrooms(rooms), BRIEF_LIMITS.maxBedrooms),
    bathrooms: Math.min(pickedBathrooms(rooms), BRIEF_LIMITS.maxBathrooms),
    requiredSpaces: BRIEF_SPACES.filter((s) => spaces.includes(s)),
    rooms,
  };
}
