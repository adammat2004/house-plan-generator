import { describe, expect, it } from "vitest";
import { withPicks } from "@/domain/brief/schema";
import { projectFromRooms } from "@/domain/project/fromRooms";
import { DRAFT_NAME, isUntouchedDraft, STARTING_BRIEF } from "@/home/drafts";

const draft = (count = 0, name = DRAFT_NAME) => {
  const made = projectFromRooms(STARTING_BRIEF, { id: "d", idPrefix: "d", now: "2026-10-10T00:00:00Z", name, count });
  if (!made.ok) throw new Error(made.message);
  return made.project;
};

describe("untouched drafts", () => {
  it("recognises a project started from Home that nobody has changed", () => {
    expect(isUntouchedDraft(draft())).toBe(true);
  });

  it("stops being a draft once rooms change, layouts exist or it's renamed", () => {
    const p = draft();
    expect(isUntouchedDraft({ ...p, brief: withPicks(p.brief, { ...p.brief.rooms, office: 1 }) })).toBe(false);
    expect(isUntouchedDraft(draft(3))).toBe(false);
    expect(isUntouchedDraft(draft(0, "Our bungalow"))).toBe(false);
    expect(isUntouchedDraft({ ...p, sizing: undefined })).toBe(false);
  });
});
