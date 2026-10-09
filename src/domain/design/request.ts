import { BRIEF_LIMITS, houseShapeStep, type BriefSpace, type HouseBrief, type HouseShape } from "../brief/schema";
import type { Id, Level, RoomType } from "../plan/types";
import { assessPlan } from "./analysis";
import type { RoomGoal } from "./intent";

/**
 * Turns a typed request ("make the kitchen larger and add a utility room")
 * into structured steps: room goals for the room planner, and brief changes
 * for whole-plan generation. A small rule-based reader standing in for a
 * language model; like one, it only ever produces intent, never geometry.
 */

export type RequestStep =
  | { kind: "room"; roomId: Id; goals: RoomGoal[]; clause: string }
  | { kind: "brief"; patch: Partial<HouseBrief>; describe: string; clause: string };

export interface Interpretation {
  steps: RequestStep[];
  /** Clauses that named a change but no room it could apply to, or weren't understood. */
  unclear: string[];
}

const GOAL_PATTERNS: Array<[RoomGoal, RegExp]> = [
  ["make_open_plan", /\bopen(?:[- ]?plan| (?:it |this )?up)\b|\bknock\b|\bcombine\b|\bmerge\b/],
  ["make_larger", /\b(?:larger|bigger|more space|more room|enlarge|extend|expand|grow|wider|roomier)\b/],
  ["make_smaller", /\b(?:smaller|reduce|shrink|tighter|less space)\b/],
  ["increase_garden_connection", /\bgarden\b|\bpatio\b|\bbi-?fold|\bfrench doors\b|\bslid(?:ing|er) doors?\b/],
  ["more_natural_light", /\blight(?:er)?\b|\bbright(?:er)?\b|\bsun(?:ny|light)?\b|\bwindows?\b/],
  ["add_kitchen_island", /\bisland\b/],
  ["add_storage", /\bstorage\b|\bcupboards?\b|\bwardrobes?\b|\bpantry\b/],
  ["improve_privacy", /\bprivacy\b|\bprivate\b|\bquiet(?:er)?\b/],
  ["create_dining_zone", /\bdining (?:zone|area|space)\b/],
];

const SPACE_WORDS: Array<[BriefSpace, RegExp]> = [
  ["utility", /\butility\b|\blaundry\b/],
  ["office", /\boffice\b|\bstudy\b/],
  ["garage", /\bgarage\b/],
  ["dining", /\bdining room\b/],
  ["living", /\bliving room\b|\blounge\b/],
];

const ROOM_WORDS: Array<[RegExp, RoomType[]]> = [
  [/\b(?:primary|master|main) bed(?:room)?\b/, ["primary_bedroom"]],
  [/\bkitchen\b/, ["kitchen", "kitchen_dining"]],
  [/\bliving\b|\blounge\b|\bsitting room\b/, ["living", "kitchen_dining"]],
  [/\bdining\b/, ["dining", "kitchen_dining"]],
  [/\bensuite\b|\ben-suite\b/, ["ensuite"]],
  [/\bbath(?:room)?\b|\bshower room\b/, ["bathroom", "ensuite"]],
  [/\bwc\b|\btoilet\b|\bcloakroom\b/, ["wc"]],
  [/\bbed(?:room)?s?\b/, ["bedroom", "primary_bedroom"]],
  [/\bhall(?:way)?\b|\bcorridor\b|\blanding\b/, ["hall"]],
  [/\boffice\b|\bstudy\b/, ["office"]],
  [/\butility\b/, ["utility"]],
  [/\bgarage\b/, ["garage"]],
];

/** A house shape asked for in a clause: "L-shaped", "a courtyard house", "any shape". */
function houseShapeIn(clause: string): HouseShape | null {
  const letter = /\b([ltu])[- ]?shaped?\b/.exec(clause)?.[1];
  if (letter) return letter.toUpperCase() as HouseShape;
  if (/\bcourtyard\b/.test(clause)) return "U";
  if (/\bany shape\b|\bwhatever shape\b/.test(clause)) return "any";
  if (/\b(?:rectangular|box[- ]shaped|a simple box)\b/.test(clause)) return "rectangle";
  return null;
}

/** Which room a clause is about: a room named in it, then a room type, then the fallback. */
function findRoom(clause: string, level: Level, fallback: Id | null): Id | null {
  const rooms = assessPlan(level).rooms;
  const byName = [...rooms].sort((a, b) => b.name.length - a.name.length).find((r) => r.name.length > 2 && clause.includes(r.name.toLowerCase()));
  if (byName) return byName.id;
  for (const [pattern, types] of ROOM_WORDS) {
    if (!pattern.test(clause)) continue;
    const matches = rooms.filter((r) => types.includes(r.type));
    if (!matches.length) continue;
    // The selected room if it is one of them, otherwise the largest.
    return matches.find((r) => r.id === fallback)?.id ?? matches[0].id;
  }
  return fallback;
}

export function interpretRequest(text: string, level: Level, brief: HouseBrief, selectedRoomId: Id | null): Interpretation {
  const clauses = text
    .toLowerCase()
    .split(/\band then\b|\band\b|\balso\b|\bplus\b|[,;.!?\n]/)
    .map((c) => c.trim())
    .filter((c) => c.length > 1);
  const steps: RequestStep[] = [];
  const unclear: string[] = [];
  let lastRoom = selectedRoomId;
  let next = { ...brief };

  for (const clause of clauses) {
    // The shape of the house is part of the brief.
    const shape = houseShapeIn(clause);
    if (shape) {
      if (next.houseShape !== shape) {
        next = { ...next, houseShape: shape };
        steps.push({ kind: "brief", patch: { houseShape: shape }, describe: houseShapeStep(shape), clause });
      }
      continue;
    }
    // Asking for a new space changes the brief: a room-level edit can't add rooms.
    const adding = /\b(?:add|include|need|want|give me|make room for)\b/.test(clause);
    const removing = /\b(?:remove|drop|without|lose|get rid of)\b/.test(clause) && !/\bwall\b/.test(clause);
    if (adding || removing) {
      const space = SPACE_WORDS.find(([, p]) => p.test(clause))?.[0];
      if (space) {
        const has = next.requiredSpaces.includes(space);
        if (adding && !has) next = { ...next, requiredSpaces: [...next.requiredSpaces, space] };
        if (removing && has) next = { ...next, requiredSpaces: next.requiredSpaces.filter((s) => s !== space) };
        steps.push({ kind: "brief", patch: { requiredSpaces: next.requiredSpaces }, describe: `${adding ? "Added" : "Removed"} ${space === "office" ? "a home office" : `a ${space}${space === "utility" || space === "dining" ? " room" : ""}`} ${adding ? "to" : "from"} the brief`, clause });
        continue;
      }
      if (/\bbed(?:room)?s?\b/.test(clause) && !/\b(?:bigger|larger|smaller)\b/.test(clause)) {
        const bedrooms = Math.max(0, Math.min(BRIEF_LIMITS.maxBedrooms, next.bedrooms + (adding ? 1 : -1)));
        next = { ...next, bedrooms };
        steps.push({ kind: "brief", patch: { bedrooms }, describe: `The brief now asks for ${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`, clause });
        continue;
      }
      if (/\bbath(?:room)?s?\b|\bshower room\b|\bwc\b|\btoilet\b/.test(clause) && !/\b(?:bigger|larger|smaller)\b/.test(clause)) {
        const bathrooms = Math.max(0, Math.min(BRIEF_LIMITS.maxBathrooms, next.bathrooms + (adding ? 1 : -1)));
        next = { ...next, bathrooms };
        steps.push({ kind: "brief", patch: { bathrooms }, describe: `The brief now asks for ${bathrooms} bathroom${bathrooms === 1 ? "" : "s"}`, clause });
        continue;
      }
    }
    const goals = GOAL_PATTERNS.filter(([, p]) => p.test(clause)).map(([g]) => g);
    if (!goals.length) {
      unclear.push(clause);
      continue;
    }
    const roomId = findRoom(clause, level, lastRoom);
    if (!roomId) {
      unclear.push(clause);
      continue;
    }
    lastRoom = roomId;
    const previous = steps[steps.length - 1];
    if (previous?.kind === "room" && previous.roomId === roomId) previous.goals = [...new Set([...previous.goals, ...goals])];
    else steps.push({ kind: "room", roomId, goals, clause });
  }
  return { steps, unclear };
}
