import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, normaliseBrief, withPicks, type HouseBrief } from "@/domain/brief/schema";
import type { ProjectDocument } from "@/domain/project/schema";

/** The rooms a new rooms-first project starts with: a typical three-bed family home, any shape of house. */
export const STARTING_BRIEF: HouseBrief = { ...withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === "family-3")!.picks), houseShape: "any" };

/** The name a project started from Home gets until someone renames it. */
export const DRAFT_NAME = "My house";

const same = (a: HouseBrief, b: HouseBrief) => JSON.stringify(normaliseBrief(a)) === JSON.stringify(normaliseBrief(b));

/**
 * A rooms-first project nobody has done anything with yet: still the
 * starting rooms, no layouts, nothing else in it. "Start designing" reopens
 * one of these instead of making another, and lists don't show them.
 */
export function isUntouchedDraft(project: ProjectDocument): boolean {
  return (
    project.sizing?.footprint === "auto" &&
    project.plans.length === 1 &&
    project.plans.every((p) => p.origin.kind !== "generated") &&
    project.name === DRAFT_NAME &&
    same(project.brief, STARTING_BRIEF)
  );
}
