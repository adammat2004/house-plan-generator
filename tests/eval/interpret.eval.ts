import { isDeepStrictEqual } from "node:util";
import { afterAll, describe, it } from "vitest";
import { DEFAULT_BRIEF, normaliseBrief, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { designContext, interpretationFromReply, type AiMode } from "@/domain/design/aiInterpretation";
import type { RoomGoal } from "@/domain/design/intent";
import { planLayouts } from "@/domain/design/stripPlanner";
import { interpret } from "@/server/designInterpreter";
import { level, newHouse } from "../helpers";

/**
 * Opt-in eval: how well Claude reads typed requests and the brief's notes
 * into the editor's steps. Every case is a real, paid call, so the suite runs
 * only with ANTHROPIC_API_KEY set in the shell:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npm run eval
 *
 * A case passes when the room goals, the brief changes and whether anything
 * was left unclear all match exactly. The pass rate is printed at the end.
 */

interface Case {
  text: string;
  /** "request" is typed in the AI Designer (the default); "instructions" is the brief's notes. */
  mode?: AiMode;
  /** The room selected in the editor, by name. */
  selected?: string;
  /** The goals expected for each room, by name. */
  rooms?: Record<string, RoomGoal[]>;
  /** The brief fields expected to change, with their new values. */
  brief?: Partial<HouseBrief>;
  /** Whether part of the text should come back as something the editor can't do. */
  unclear?: boolean;
}

/** The brief's spaces (kitchen, living, dining) plus or minus some. */
const spaces = (add: HouseBrief["requiredSpaces"], remove: HouseBrief["requiredSpaces"] = []) => [...DEFAULT_BRIEF.requiredSpaces.filter((s) => !remove.includes(s)), ...add];

const CASES: Case[] = [
  // Larger and smaller.
  { text: "Make the kitchen bigger", rooms: { Kitchen: ["make_larger"] } },
  { text: "The living room could be a bit smaller", rooms: { "Living Room": ["make_smaller"] } },
  { text: "Can this room be roomier?", selected: "Bedroom 2", rooms: { "Bedroom 2": ["make_larger"] } },
  { text: "Shrink the main bathroom", rooms: { Bathroom: ["make_smaller"] } },
  // Light and the garden.
  { text: "Bring more light into the living room", rooms: { "Living Room": ["more_natural_light"] } },
  { text: "I'd like doors from the dining room out to the garden", rooms: { "Dining Room": ["increase_garden_connection"] } },
  { text: "Brighter please, with doors onto the patio", selected: "Kitchen", rooms: { Kitchen: ["increase_garden_connection", "more_natural_light"] } },
  // Open plan, ensuite, storage, island, dining, privacy.
  { text: "Make the kitchen more open-plan", rooms: { Kitchen: ["make_open_plan"] } },
  { text: "Give bedroom 2 its own ensuite", rooms: { "Bedroom 2": ["add_ensuite"] } },
  { text: "More wardrobe space in the primary bedroom", rooms: { "Master Bedroom": ["add_storage"] } },
  { text: "Put an island in the kitchen", rooms: { Kitchen: ["add_kitchen_island"] } },
  { text: "Make the kitchen bigger and add an island", rooms: { Kitchen: ["add_kitchen_island", "make_larger"] } },
  { text: "I want a dining area in the living room", rooms: { "Living Room": ["create_dining_zone"] } },
  { text: "The primary bedroom should feel more private", rooms: { "Master Bedroom": ["improve_privacy"] } },
  // Adding and removing rooms.
  { text: "Add a utility room", brief: { requiredSpaces: spaces(["utility"]) } },
  { text: "We need a garage", brief: { requiredSpaces: spaces(["garage"]) } },
  { text: "Add a study", brief: { requiredSpaces: spaces(["office"]) } },
  { text: "Drop the dining room from the brief", brief: { requiredSpaces: spaces([], ["dining"]) } },
  // Counts.
  { text: "Add another bedroom", brief: { bedrooms: 4 } },
  { text: "Four bedrooms please", brief: { bedrooms: 4 } },
  { text: "One bathroom is enough", brief: { bathrooms: 1 } },
  // House shape.
  { text: "Make it an L-shaped house", brief: { houseShape: "L" } },
  { text: "Could it be a courtyard house?", brief: { houseShape: "U" } },
  // Storeys.
  { text: "Make it a two-storey house", brief: { storeys: 2 } },
  { text: "Put the bedrooms upstairs", brief: { storeys: 2 } },
  { mode: "instructions", text: "We want a bungalow, everything on one level", brief: {} },
  { text: "Could it have three storeys?", unclear: true },
  // The brief's notes: preferences, sizes and counts, never room changes.
  { mode: "instructions", text: "We'd like an open-plan layout", brief: { preferences: ["open_plan"] } },
  { mode: "instructions", text: "The kitchen should look out onto the garden", brief: { preferences: ["kitchen_faces_garden"] } },
  { mode: "instructions", text: "Lots of natural light everywhere", brief: { preferences: ["maximize_natural_light"] } },
  { mode: "instructions", text: "Step-free and wheelchair accessible throughout", brief: { preferences: ["accessible_layout"] } },
  { mode: "instructions", text: "Keep the bedrooms compact", brief: { roomSizes: { bedrooms: "compact" } } },
  { mode: "instructions", text: "We need four bedrooms and a utility room", brief: { bedrooms: 4, requiredSpaces: spaces(["utility"]) } },
  // Unclear.
  { text: "Make it bigger", unclear: true },
  { text: "Paint the walls sage green", unclear: true },
  { text: "Add a utility room and add a second storey", brief: { requiredSpaces: spaces(["utility"]), storeys: 2 } },
];

/**
 * The plan requests are read against: picked rooms, so it has the separate
 * kitchen, dining and living rooms the cases name whatever the planner does
 * with a counts-only brief.
 */
const PLAN_BRIEF = withPicks(DEFAULT_BRIEF, { master_bedroom: 1, ensuite: 1, double_bedroom: 2, family_bathroom: 1, kitchen: 1, dining_room: 1, living_room: 1 });
const plan = level(planLayouts({ intent: { action: "generate_layouts", brief: PLAN_BRIEF, count: 1, footprint: "auto" }, source: newHouse(), brief: PLAN_BRIEF, idPrefix: "e" }).candidates[0].document);

function roomId(name: string): string {
  const room = Object.values(plan.rooms).find((r) => r.name === name);
  if (!room) throw new Error(`The eval plan has no room called ${name}; it has ${Object.values(plan.rooms).map((r) => r.name).join(", ")}.`);
  return room.id;
}

/** Arrays sorted, so order doesn't count. */
const canonical = <T extends Record<string, unknown>>(record: T) =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]));

/** What one case expects, and what Claude's reply came to, in the same form. */
async function score(c: Case) {
  const mode = c.mode ?? "request";
  // As in the editor: notes are read before any layout exists.
  const lvl = mode === "request" ? plan : null;
  const brief: HouseBrief = mode === "instructions" ? { ...DEFAULT_BRIEF, additionalInstructions: c.text } : DEFAULT_BRIEF;
  for (const name of Object.keys(c.rooms ?? {})) roomId(name);
  const want = {
    rooms: Object.fromEntries(Object.entries(c.rooms ?? {}).map(([name, goals]) => [name, [...goals].sort()])),
    brief: canonical(c.brief ?? {}),
    unclear: !!c.unclear,
  };
  const result = await interpret({ mode, text: c.text, context: designContext(lvl, brief, c.selected ? roomId(c.selected) : null) });
  if (!result.ok) return { want, got: { error: result.message }, said: "" };
  const read = interpretationFromReply(result.reply, lvl, brief, mode);
  const rooms: Record<string, RoomGoal[]> = {};
  let after = brief;
  for (const step of read.steps) {
    if (step.kind === "room") rooms[plan.rooms[step.roomId].name] = [...step.goals].sort();
    else after = normaliseBrief({ ...after, ...step.patch });
  }
  const changed = Object.fromEntries(Object.entries(after).filter(([k, v]) => !isDeepStrictEqual(v, brief[k as keyof HouseBrief])));
  const said = [read.reply, ...read.unclear.map((u) => `unclear: “${u}”`)].join(" ");
  return { want, got: { rooms, brief: canonical(changed), unclear: read.unclear.length > 0 }, said };
}

const outcomes: Array<{ text: string; pass: boolean; detail: string }> = [];

describe.skipIf(!process.env.ANTHROPIC_API_KEY).concurrent("Claude reading requests and notes", () => {
  afterAll(() => {
    const passed = outcomes.filter((o) => o.pass).length;
    const lines = [`\nClaude eval: ${passed} of ${outcomes.length} cases passed (${Math.round((100 * passed) / Math.max(1, outcomes.length))}%).`];
    for (const o of outcomes.filter((o) => !o.pass)) lines.push(`  ✗ “${o.text}”: ${o.detail}`);
    console.log(lines.join("\n"));
  });

  it.for(CASES)("$text", async (c, { expect }) => {
    const { want, got, said } = await score(c);
    // Key order doesn't matter, as with toEqual.
    const pass = isDeepStrictEqual(got, want);
    outcomes.push({ text: c.text, pass, detail: `wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}. ${said}` });
    expect(got).toEqual(want);
  });
});
