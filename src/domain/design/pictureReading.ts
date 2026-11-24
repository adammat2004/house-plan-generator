import { z } from "zod";
import { ROOM_PICK_SPECS, ROOM_PICKS, type RoomPicks } from "../brief/rooms";
import { BRIEF_LIMITS, HOUSE_SHAPES, withPicks, type HouseBrief } from "../brief/schema";

/**
 * Reading a picture into the brief: a floor plan someone likes, a photo of a
 * house for inspiration, or their site plan. Claude looks at the picture and
 * replies in a fixed schema (rooms one by one, the shape, the storeys, and
 * notes); the brief takes what fits it. Nothing about geometry comes back:
 * the planners still lay the house out.
 */

export const PICTURE_KINDS = ["floor_plan", "inspiration", "site_plan"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];
export const PICTURE_KIND_LABEL: Record<PictureKind, string> = { floor_plan: "A floor plan", inspiration: "Inspiration", site_plan: "My site plan" };

/** Base64 of a picture of at most about 1.5 MB once the browser has scaled it down. */
export const MAX_PICTURE_BYTES = 1_500_000;
const MAX_BASE64 = Math.ceil(MAX_PICTURE_BYTES / 3) * 4;

export const pictureRequestSchema = z.object({
  kind: z.enum(PICTURE_KINDS),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  image: z.string().min(100).max(MAX_BASE64).regex(/^[A-Za-z0-9+/]+=*$/),
  /** The rooms picked now, so the reply can say what it would change. */
  rooms: z.partialRecord(z.enum(ROOM_PICKS), z.number().int().min(0).max(8)),
});
export type PictureRequest = z.infer<typeof pictureRequestSchema>;

/** Every pick as a count, or null where the picture says nothing about it. Required fields so the schema compiles to a strict structured output. */
const picksShape = Object.fromEntries(ROOM_PICKS.map((p) => [p, z.number().int().nullable()])) as Record<(typeof ROOM_PICKS)[number], z.ZodNullable<z.ZodNumber>>;

export const pictureReplySchema = z.object({
  /** One or two sentences to show the user: what the picture shows and what would change. */
  reply: z.string(),
  /** Rooms seen (a floor plan) or suggested (inspiration); null for those the picture doesn't show. */
  rooms: z.object(picksShape),
  houseShape: z.enum(HOUSE_SHAPES).nullable(),
  storeys: z.number().int().nullable(),
  /** Things worth keeping with the brief that rooms can't say: the style, the feel, the site's limits. */
  notes: z.array(z.string()),
});
export type PictureReply = z.infer<typeof pictureReplySchema>;

/** What the reply would do to the brief, kept within what a brief can hold. */
export function briefFromPicture(brief: HouseBrief, reply: PictureReply): HouseBrief {
  const seen = Object.entries(reply.rooms).filter(([, n]) => n !== null) as Array<[keyof RoomPicks, number]>;
  let next = brief;
  if (seen.length) {
    const picks: RoomPicks = {};
    for (const [pick, n] of seen) picks[pick] = Math.max(0, Math.min(ROOM_PICK_SPECS[pick].max, n));
    // An ensuite needs a master bedroom to belong to.
    if (!picks.master_bedroom) delete picks.ensuite;
    next = withPicks(next, picks);
    if (next.bedrooms > BRIEF_LIMITS.maxBedrooms || next.bathrooms > BRIEF_LIMITS.maxBathrooms) next = brief;
  }
  if (reply.houseShape) next = { ...next, houseShape: reply.houseShape };
  if (reply.storeys === 1 || reply.storeys === 2) next = { ...next, storeys: reply.storeys };
  const notes = reply.notes.map((n) => n.trim()).filter(Boolean);
  if (notes.length) {
    const joined = [brief.additionalInstructions.trim(), ...notes].filter(Boolean).join("\n");
    next = { ...next, additionalInstructions: joined.slice(0, BRIEF_LIMITS.maxInstructions) };
  }
  return next;
}
