import { z } from "zod";
import { targetAreaFit } from "../design/program";
import { picksFromCounts } from "./rooms";
import { BRIEF_LIMITS, BRIEF_SPACES, DEFAULT_BRIEF, HOUSE_SHAPES, normaliseBrief, PREFERENCE_IDS, ROOM_SIZES, SIZED_ROOMS, withPicks, type BriefSpace, type HouseBrief, type HouseShape, type PreferenceId } from "./schema";

/**
 * Describe-your-home: the words a person writes become a house brief. The
 * model fills this fixed reply; clamping and the brief itself are made here,
 * so a bad answer can't produce an invalid brief, and geometry stays with the planners.
 */

export const PROMPT_MAX_LENGTH = 1000;

export const promptRequestSchema = z.object({ text: z.string().trim().min(3).max(PROMPT_MAX_LENGTH) });
export type PromptRequest = z.infer<typeof promptRequestSchema>;

export const promptReplySchema = z.object({
  /** One or two plain sentences on what was understood. */
  reply: z.string(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable(),
  spaces: z.array(z.enum(BRIEF_SPACES)),
  preferences: z.array(z.enum(PREFERENCE_IDS)),
  roomSizes: z.object({ living: z.enum(ROOM_SIZES).nullable(), kitchen: z.enum(ROOM_SIZES).nullable(), bedrooms: z.enum(ROOM_SIZES).nullable() }),
  houseShape: z.enum(HOUSE_SHAPES).nullable(),
  storeys: z.number().int().nullable(),
  /** Whole-house floor area in m², converted from square feet if needed. */
  targetArea: z.number().nullable(),
  /** Parts of the request the brief can't express, quoted briefly. */
  unclear: z.array(z.string()),
});
export type PromptReply = z.infer<typeof promptReplySchema>;

export interface PromptBrief {
  brief: HouseBrief;
  /** What the assistant understood. */
  reply: string;
  /** Things asked for that the brief can't hold, or that were adjusted. */
  notes: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** The brief a reply describes: counts clamped to the limits, a kitchen and living space kept unless asked otherwise, a target area only when it's a sensible house. */
export function briefFromPromptReply(reply: PromptReply): PromptBrief {
  const notes = [...reply.unclear.map((u) => `Not in the brief: ${u}`)];
  const bedrooms = clamp(reply.bedrooms ?? DEFAULT_BRIEF.bedrooms, 0, BRIEF_LIMITS.maxBedrooms);
  const bathrooms = clamp(reply.bathrooms ?? DEFAULT_BRIEF.bathrooms, 0, BRIEF_LIMITS.maxBathrooms);
  if (reply.bedrooms !== null && reply.bedrooms > BRIEF_LIMITS.maxBedrooms) notes.push(`The brief holds up to ${BRIEF_LIMITS.maxBedrooms} bedrooms, so that's what it has.`);
  const spaces = reply.spaces.length ? reply.spaces : DEFAULT_BRIEF.requiredSpaces;
  const preferences = reply.preferences;
  const roomSizes = Object.fromEntries(SIZED_ROOMS.flatMap((g) => (reply.roomSizes[g] ? [[g, reply.roomSizes[g]]] : [])));
  let storeys: 1 | 2 | undefined;
  if (reply.storeys !== null) {
    if (reply.storeys >= 3) notes.push("Three or more storeys can't be planned yet; the brief is for two.");
    storeys = reply.storeys >= 2 ? 2 : 1;
  }
  let targetArea: number | undefined;
  if (reply.targetArea !== null) {
    const rounded = Math.round(reply.targetArea);
    if (rounded >= BRIEF_LIMITS.minTargetArea && rounded <= BRIEF_LIMITS.maxTargetArea) targetArea = rounded;
    else notes.push(`A target of ${rounded} m² isn't something the planner can size a house to (${BRIEF_LIMITS.minTargetArea} to ${BRIEF_LIMITS.maxTargetArea} m²), so it was left out.`);
  }
  const brief = briefFromFields({ bedrooms, bathrooms, spaces, preferences, roomSizes, houseShape: reply.houseShape ?? "any", storeys, targetArea });
  const fit = targetAreaFit(brief);
  if (fit && !fit.met) notes.push(fit.message);
  return { brief, reply: reply.reply, notes };
}

/** The fields a person edits after the description is read. */
export interface BriefFields {
  bedrooms: number;
  bathrooms: number;
  spaces: readonly BriefSpace[];
  preferences: readonly PreferenceId[];
  roomSizes?: HouseBrief["roomSizes"];
  houseShape: HouseShape;
  storeys?: 1 | 2;
  targetArea?: number;
}

/** The rooms-first brief for those fields: rooms picked to match the counts, an office added for a home-office preference. */
export function briefFromFields(f: BriefFields): HouseBrief {
  const wantsOpenPlan = f.preferences.includes("open_plan") && !f.preferences.includes("separate_living_room");
  const spaces = f.preferences.includes("home_office") && !f.spaces.includes("office") ? [...f.spaces, "office" as const] : [...f.spaces];
  const base: HouseBrief = {
    ...DEFAULT_BRIEF,
    bedrooms: f.bedrooms,
    bathrooms: f.bathrooms,
    requiredSpaces: spaces,
    preferences: [...f.preferences],
    ...(f.roomSizes && Object.keys(f.roomSizes).length ? { roomSizes: f.roomSizes } : {}),
    houseShape: f.houseShape,
    ...(f.storeys ? { storeys: f.storeys } : {}),
    ...(f.targetArea ? { targetArea: f.targetArea } : {}),
  };
  return normaliseBrief(withPicks(base, picksFromCounts(f.bedrooms, f.bathrooms, spaces, wantsOpenPlan)));
}

/** The fields a brief holds, for showing and editing. */
export function fieldsOfBrief(brief: HouseBrief): BriefFields {
  return {
    bedrooms: brief.bedrooms,
    bathrooms: brief.bathrooms,
    spaces: brief.requiredSpaces,
    preferences: brief.preferences,
    ...(brief.roomSizes ? { roomSizes: brief.roomSizes } : {}),
    houseShape: brief.houseShape ?? "rectangle",
    ...(brief.storeys ? { storeys: brief.storeys } : {}),
    ...(brief.targetArea ? { targetArea: brief.targetArea } : {}),
  };
}
