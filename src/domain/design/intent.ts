import { z } from "zod";
import { houseBriefSchema } from "../brief/schema";
import type { RoomType } from "../plan/types";

/**
 * Structured design intent: what the user (or, later, a language model
 * interpreting the user) wants, without any geometry. Planners turn intents
 * into validated PlanDocuments; nothing upstream ever produces coordinates.
 */

/** Room-level goals a redesign can pursue. */
export const ROOM_GOALS = [
  "make_larger",
  "make_smaller",
  "add_kitchen_island",
  "create_dining_zone",
  "increase_garden_connection",
  "add_storage",
  "make_open_plan",
  "more_natural_light",
  "add_ensuite",
  "improve_privacy",
] as const;

export type RoomGoal = (typeof ROOM_GOALS)[number];

const idSchema = z.string().min(1).max(200);

export const designIntentSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate_layouts"),
    brief: houseBriefSchema,
    count: z.number().int().min(1).max(6),
    /** Arrangements already offered, to leave out ("Generate more"). */
    exclude: z.array(z.string().min(1).max(60)).max(50).optional(),
    /** Offer layouts close to this arrangement instead of the usual spread ("Generate similar"). */
    similarTo: z.string().min(1).max(60).optional(),
  }),
  z.object({
    action: z.literal("redesign_room"),
    roomId: idSchema,
    goals: z.array(z.enum(ROOM_GOALS)),
    /** Options already offered (their variant keys), to leave out. */
    exclude: z.array(z.string().min(1).max(120)).max(100).optional(),
  }),
  z.object({
    action: z.literal("room_variations"),
    roomIds: z.array(idSchema).min(1),
    goals: z.array(z.enum(ROOM_GOALS)),
    count: z.number().int().min(1).max(6),
    exclude: z.array(z.string().min(1).max(120)).max(100).optional(),
  }),
]);

export type DesignIntent = z.infer<typeof designIntentSchema>;

export const ROOM_GOAL_LABEL: Record<RoomGoal, string> = {
  make_larger: "Make it larger",
  make_smaller: "Make it smaller",
  add_kitchen_island: "Add kitchen island",
  create_dining_zone: "Create dining zone",
  increase_garden_connection: "Increase garden connection",
  add_storage: "Add storage",
  make_open_plan: "Make more open-plan",
  more_natural_light: "Bring in more light",
  add_ensuite: "Add an ensuite",
  improve_privacy: "Improve privacy",
};

const SUGGESTIONS: Partial<Record<RoomType, RoomGoal[]>> = {
  kitchen: ["make_larger", "increase_garden_connection", "make_open_plan", "more_natural_light"],
  kitchen_dining: ["make_larger", "increase_garden_connection", "more_natural_light", "make_open_plan"],
  dining: ["increase_garden_connection", "make_open_plan", "more_natural_light", "make_larger"],
  living: ["increase_garden_connection", "make_open_plan", "more_natural_light", "make_larger"],
  bedroom: ["make_larger", "more_natural_light", "make_smaller"],
  primary_bedroom: ["make_larger", "more_natural_light", "increase_garden_connection"],
  bathroom: ["make_larger", "more_natural_light"],
  ensuite: ["make_larger", "more_natural_light"],
  hall: ["make_smaller", "more_natural_light"],
  office: ["more_natural_light", "make_larger", "make_smaller"],
  utility: ["make_larger", "make_smaller"],
};

/** Goals the room planner can act on today; the rest are recorded as intent only. */
export const SUPPORTED_ROOM_GOALS: ReadonlySet<RoomGoal> = new Set([
  "make_larger",
  "make_smaller",
  "more_natural_light",
  "increase_garden_connection",
  "make_open_plan",
]);

/** Up to four goals that make sense for a room of this type, all ones the planner can act on. */
export function suggestedGoals(type: RoomType): RoomGoal[] {
  return (SUGGESTIONS[type] ?? ["make_larger", "more_natural_light", "make_open_plan"]).slice(0, 4);
}
