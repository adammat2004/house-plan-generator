import { z } from "zod";
import {
  BRIEF_LIMITS,
  BRIEF_SPACES,
  HOUSE_SHAPES,
  houseBriefSchema,
  houseShapeStep,
  storeysStep,
  normaliseBrief,
  PREFERENCE_IDS,
  PREFERENCE_LABEL,
  ROOM_SIZES,
  SIZED_ROOM_LABEL,
  SIZED_ROOMS,
  type HouseBrief,
} from "../brief/schema";
import { ROOM_TYPES } from "../plan/schema";
import type { Id, Level, PlanDocument } from "../plan/types";
import { assessPlan, roomConnections, touchesRear } from "./analysis";
import { ROOM_GOALS } from "./intent";
import type { Interpretation, RequestStep } from "./request";

/**
 * The contract between the editor and a language model reading the user's
 * words. The model sees a summary of the plan and returns this structured
 * reply: room goals for the room planner and changes to the brief, never
 * geometry. Everything it returns is checked against the plan and the brief
 * vocabulary before anything happens.
 */

/** What a model reads: a request typed in the AI Designer, or the brief's free-text notes. */
export const AI_MODES = ["request", "instructions"] as const;
export type AiMode = (typeof AI_MODES)[number];

const idSchema = z.string().min(1).max(200);

/** The plan as a model sees it. Small and free of coordinates. */
export const designContextSchema = z.object({
  rooms: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().max(80),
        type: z.enum(ROOM_TYPES),
        area: z.number().nonnegative().max(10_000),
        /** Has a wall on the garden side. */
        garden: z.boolean(),
        /** Names of the rooms its doors lead to. */
        doorsTo: z.array(z.string().max(80)).max(20),
        /** In a house of several floors, the floor it's on. */
        floor: z.string().max(80).optional(),
      }),
    )
    .max(60),
  brief: houseBriefSchema,
  selectedRoomId: idSchema.nullable(),
});
export type DesignContext = z.infer<typeof designContextSchema>;

export const aiRequestSchema = z.object({
  mode: z.enum(AI_MODES),
  text: z.string().trim().min(1).max(BRIEF_LIMITS.maxInstructions),
  context: designContextSchema,
});
export type AiRequest = z.infer<typeof aiRequestSchema>;

/** The model's reply. Every field is required so the schema compiles to a strict structured output. */
export const aiReplySchema = z.object({
  /** One or two sentences to show the user. */
  reply: z.string(),
  roomChanges: z.array(
    z.object({
      roomId: z.string(),
      goals: z.array(z.enum(ROOM_GOALS)),
      /** The words this change answers. */
      clause: z.string(),
    }),
  ),
  brief: z.object({
    bedrooms: z.number().int().nullable(),
    bathrooms: z.number().int().nullable(),
    addSpaces: z.array(z.enum(BRIEF_SPACES)),
    removeSpaces: z.array(z.enum(BRIEF_SPACES)),
    addPreferences: z.array(z.enum(PREFERENCE_IDS)),
    removePreferences: z.array(z.enum(PREFERENCE_IDS)),
    roomSizes: z.array(z.object({ group: z.enum(SIZED_ROOMS), size: z.enum(ROOM_SIZES) })),
    /** The shape of house wanted, or null to leave it unchanged. */
    houseShape: z.enum(HOUSE_SHAPES).nullable(),
    /** Storeys wanted (1 or 2; more can't be planned yet), or null to leave unchanged. */
    storeys: z.number().int().nullable(),
  }),
  /** Parts of the text that ask for something neither the planners nor the brief can express. */
  unclear: z.array(z.string()),
});
export type AiReply = z.infer<typeof aiReplySchema>;

/** A plan's floors, or the one floor given. */
const floorsOf = (source: Level | PlanDocument | null): Level[] => (!source ? [] : "levels" in source ? source.levels : [source]);

/** Summarises the plan for a model: rooms by name and use, size, garden side, doors, and the floor in a house of several. */
export function designContext(source: Level | PlanDocument | null, brief: HouseBrief, selectedRoomId: Id | null): DesignContext {
  const floors = floorsOf(source);
  const rooms = floors.flatMap((level) =>
    assessPlan(level).rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      area: Math.round(r.area * 10) / 10,
      garden: touchesRear(level, r.id),
      doorsTo: [
        ...new Set(
          roomConnections(level, r.id)
            .filter((c) => c.kind === "door")
            .map((c) => (c.target.kind === "room" ? c.target.name : c.target.kind)),
        ),
      ],
      ...(floors.length > 1 ? { floor: level.name } : {}),
    })),
  );
  return { rooms, brief, selectedRoomId: selectedRoomId && rooms.some((r) => r.id === selectedRoomId) ? selectedRoomId : null };
}

const SPACE_PHRASE: Record<(typeof BRIEF_SPACES)[number], string> = {
  kitchen: "kitchen",
  living: "living room",
  dining: "dining room",
  office: "home office",
  utility: "utility room",
  garage: "garage",
};
const spaceName = (s: (typeof BRIEF_SPACES)[number]) => SPACE_PHRASE[s];

/**
 * Turns a model's reply into the same steps the rule-based reader produces,
 * dropping anything that doesn't fit the plan. Notes in the brief only ever
 * add to it: they never remove spaces or preferences, or lower counts.
 */
export function interpretationFromReply(reply: AiReply, source: Level | PlanDocument | null, brief: HouseBrief, mode: AiMode): Interpretation & { reply: string } {
  const roomOf = (id: Id) => floorsOf(source).find((l) => id in l.rooms)?.rooms[id];
  const steps: RequestStep[] = [];
  const unclear = [...reply.unclear.filter((u) => u.trim())];
  const additive = mode === "instructions";

  // Notes in the brief come before there is a layout, so room changes don't apply to them.
  for (const change of additive ? [] : reply.roomChanges) {
    const room = roomOf(change.roomId);
    if (!room || !change.goals.length) {
      if (change.clause.trim()) unclear.push(change.clause);
      continue;
    }
    const same = steps.find((s): s is Extract<RequestStep, { kind: "room" }> => s.kind === "room" && s.roomId === room.id);
    if (same) same.goals = [...new Set([...same.goals, ...change.goals])];
    else steps.push({ kind: "room", roomId: room.id, goals: [...new Set(change.goals)], clause: change.clause });
  }

  const b = reply.brief;
  let next = brief;
  const push = (patch: Partial<HouseBrief>, describe: string) => {
    const candidate = normaliseBrief({ ...next, ...patch });
    if (JSON.stringify(candidate) === JSON.stringify(next)) return;
    next = candidate;
    steps.push({ kind: "brief", patch, describe, clause: describe });
  };
  const count = (value: number | null, current: number, max: number) => {
    if (value === null) return null;
    const clamped = Math.max(0, Math.min(max, value));
    return additive && clamped < current ? null : clamped;
  };
  const bedrooms = count(b.bedrooms, next.bedrooms, BRIEF_LIMITS.maxBedrooms);
  if (bedrooms !== null) push({ bedrooms }, `The brief now asks for ${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`);
  const bathrooms = count(b.bathrooms, next.bathrooms, BRIEF_LIMITS.maxBathrooms);
  if (bathrooms !== null) push({ bathrooms }, `The brief now asks for ${bathrooms} bathroom${bathrooms === 1 ? "" : "s"}`);
  for (const space of b.addSpaces) push({ requiredSpaces: [...next.requiredSpaces, space] }, `Added a ${spaceName(space)} to the brief`);
  if (!additive) {
    for (const space of b.removeSpaces) push({ requiredSpaces: next.requiredSpaces.filter((s) => s !== space) }, `Removed the ${spaceName(space)} from the brief`);
  }
  for (const pref of b.addPreferences) push({ preferences: [...next.preferences, pref] }, `Added “${PREFERENCE_LABEL[pref]}” to the brief`);
  if (!additive) {
    for (const pref of b.removePreferences) push({ preferences: next.preferences.filter((p) => p !== pref) }, `Removed “${PREFERENCE_LABEL[pref]}” from the brief`);
  }
  for (const { group, size } of b.roomSizes) {
    push({ roomSizes: { ...next.roomSizes, [group]: size } }, `${SIZED_ROOM_LABEL[group]} set to ${size}`);
  }
  if (b.houseShape) push({ houseShape: b.houseShape }, houseShapeStep(b.houseShape));
  if (b.storeys === 1 || b.storeys === 2) push({ storeys: b.storeys }, storeysStep(b.storeys));
  else if (b.storeys !== null && b.storeys > 2) unclear.push(`a house of ${b.storeys} storeys (layouts have one or two for now)`);
  return { steps, unclear: [...new Set(unclear)], reply: reply.reply.trim() };
}
