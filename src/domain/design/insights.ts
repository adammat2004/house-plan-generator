import type { Id, Level, RoomType } from "../plan/types";
import { roomFacts, touchesRear } from "./analysis";
import type { RoomGoal } from "./intent";
import type { ProposalImpact } from "./impact";
import { assessSense } from "./sense";

/** One option the room planner found and checked for a goal: its title and what it would change. */
export interface CheckedOption {
  goal: RoomGoal;
  title: string;
  summary: string;
  impact: ProposalImpact | null;
}

export interface RoomInsight {
  /** The goal the insight is about; its options are the ones to show. */
  goal: RoomGoal;
  text: string;
}

const DAY: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining"]);
const KITCHEN: ReadonlySet<RoomType> = new Set(["kitchen", "kitchen_dining"]);

/** "kitchen / dining" for use mid-sentence. */
const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

/**
 * The one thing most worth saying about a room, with what to do about it,
 * or nothing. Deterministic, from the room's facts and plan-sense findings,
 * and only ever about a goal the planner has an option for: the words never
 * promise a change that couldn't be made.
 */
export function roomInsight(level: Level, roomId: Id, options: readonly CheckedOption[]): RoomInsight | null {
  const room = level.rooms[roomId];
  const facts = roomFacts(level, roomId);
  if (!room || !facts) return null;
  const best = (goal: RoomGoal) => options.find((o) => o.goal === goal);
  const findings = assessSense(level).findings.filter((f) => f.roomIds.includes(roomId));
  const name = lower(room.name);
  const narrow = Math.min(facts.width, facts.depth);

  // A narrow day room: the larger option, with its real gain.
  const larger = best("make_larger");
  if (larger?.impact && larger.impact.areaDelta >= 0.5 && (narrow < 3 || findings.some((f) => f.rule === "room_shape"))) {
    const island = KITCHEN.has(room.type) && best("add_kitchen_island");
    return {
      goal: "make_larger",
      text: `This ${name} is quite narrow at ${narrow.toFixed(1)} m. ${larger.summary}${island ? " There'd be room for an island too." : ""}`,
    };
  }
  // Little daylight.
  const light = best("more_natural_light");
  if (light && (findings.some((f) => f.rule === "daylight") || (DAY.has(room.type) && facts.glazing < facts.area * 0.1))) {
    return { goal: "more_natural_light", text: `The ${name} gets little daylight for its size. ${light.summary}` };
  }
  // A kitchen cut off from where people sit.
  const open = best("make_open_plan");
  if (open && KITCHEN.has(room.type) && findings.some((f) => f.rule === "kitchen_connected")) {
    return { goal: "make_open_plan", text: `The ${name} is cut off from the living spaces. ${open.summary}` };
  }
  // A day room on the garden side with no way out to it.
  const garden = best("increase_garden_connection");
  if (garden && DAY.has(room.type) && touchesRear(level, roomId) && facts.gardenDoor === 0) {
    return { goal: "increase_garden_connection", text: `The ${name} looks onto the garden but has no door to it. ${garden.summary}` };
  }
  return null;
}
