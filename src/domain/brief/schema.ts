import { z } from "zod";

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

export const houseBriefSchema = z.object({
  bedrooms: z.number().int().min(0).max(BRIEF_LIMITS.maxBedrooms),
  bathrooms: z.number().int().min(0).max(BRIEF_LIMITS.maxBathrooms),
  requiredSpaces: z.array(z.enum(BRIEF_SPACES)),
  preferences: z.array(z.enum(PREFERENCE_IDS)),
  /** Optional: absent groups (and briefs saved before sizes existed) are "standard". */
  roomSizes: z.partialRecord(z.enum(SIZED_ROOMS), z.enum(ROOM_SIZES)).optional(),
  additionalInstructions: z.string().max(BRIEF_LIMITS.maxInstructions),
});

export type HouseBrief = z.infer<typeof houseBriefSchema>;
export type BriefSpace = (typeof BRIEF_SPACES)[number];
export type PreferenceId = (typeof PREFERENCE_IDS)[number];
export type SizedRoom = (typeof SIZED_ROOMS)[number];
export type RoomSize = (typeof ROOM_SIZES)[number];

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
  const { roomSizes, ...parsed } = houseBriefSchema.parse(brief);
  const sizes = SIZED_ROOMS.filter((g) => roomSizes?.[g] && roomSizes[g] !== "standard").map((g) => [g, roomSizes![g]] as const);
  return {
    ...parsed,
    requiredSpaces: BRIEF_SPACES.filter((s) => parsed.requiredSpaces.includes(s)),
    preferences: PREFERENCE_IDS.filter((p) => parsed.preferences.includes(p)),
    ...(sizes.length ? { roomSizes: Object.fromEntries(sizes) } : {}),
  };
}
