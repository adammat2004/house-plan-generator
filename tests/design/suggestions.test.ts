import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks } from "@/domain/brief/schema";
import { assessPlan } from "@/domain/design/analysis";
import { interpretRequest } from "@/domain/design/request";
import { planSuggestions } from "@/domain/design/suggestions";
import { projectFromRooms } from "@/domain/project/fromRooms";

function plansFor(presetId: string) {
  const preset = BRIEF_PRESETS.find((p) => p.id === presetId)!;
  const brief = withPicks(DEFAULT_BRIEF, preset.picks);
  const made = projectFromRooms(brief, { id: "p", idPrefix: "s", now: "2026-10-10T00:00:00Z", name: "T", count: 3 });
  if (!made.ok) throw new Error(made.message);
  return { brief, levels: made.project.plans.slice(1).map((p) => p.document.levels[0]) };
}

describe("plan suggestions", () => {
  for (const id of BRIEF_PRESETS.map((p) => p.id)) {
    it(`never suggests adding a room the plan already has (${id})`, () => {
      const { levels } = plansFor(id);
      for (const level of levels) {
        const types = new Set(assessPlan(level).rooms.map((r) => r.type));
        const suggestions = planSuggestions(level);
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.length).toBeLessThanOrEqual(4);
        if (types.has("utility")) expect(suggestions).not.toContain("Add a utility room");
        if (types.has("office")) expect(suggestions).not.toContain("Add a home office");
        if (!types.has("living")) expect(suggestions).not.toContain("More light in the living room");
      }
    });
  }

  it("offers only requests the built-in reader understands", () => {
    const { brief, levels } = plansFor("family-4");
    for (const level of levels) {
      for (const text of planSuggestions(level)) {
        const read = interpretRequest(text, level, brief, null);
        expect(read.steps.length, text).toBeGreaterThan(0);
      }
    }
  });
});
