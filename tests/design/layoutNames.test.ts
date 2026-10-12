import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks } from "@/domain/brief/schema";
import { assessPlan } from "@/domain/design/analysis";
import { layoutNames } from "@/domain/design/layoutNames";
import { projectFromRooms } from "@/domain/project/fromRooms";

function setFor(presetId: string, idPrefix = "n") {
  const preset = BRIEF_PRESETS.find((p) => p.id === presetId)!;
  const made = projectFromRooms(withPicks(DEFAULT_BRIEF, preset.picks), { id: "p", idPrefix, now: "2026-10-10T00:00:00Z", name: "T", count: 3 });
  if (!made.ok) throw new Error(made.message);
  return made.project.plans.slice(1).map((p) => p.document.levels[0]);
}

describe("layout names", () => {
  for (const { id } of BRIEF_PRESETS) {
    it(`gives every layout in a set its own name (${id})`, () => {
      const names = layoutNames(setFor(id));
      expect(names).toHaveLength(3);
      expect(new Set(names).size).toBe(names.length);
      expect(names.every((n) => n.length > 0 && n.length <= 60)).toBe(true);
    });
  }

  it("names the same set the same way every time", () => {
    expect(layoutNames(setFor("family-3", "a"))).toEqual(layoutNames(setFor("family-3", "b")));
  });

  it("calls the smallest house the most compact, when it clearly is", () => {
    const levels = setFor("family-4");
    const names = layoutNames(levels);
    const i = names.indexOf("Most compact");
    if (i >= 0) {
      const area = (l: (typeof levels)[number]) => {
        const o = assessPlan(l).outside!;
        return o.width * o.depth;
      };
      for (const other of levels) expect(area(levels[i])).toBeLessThanOrEqual(area(other));
    }
  });

  it("describes a lone layout by what it has", () => {
    const [one] = setFor("starter");
    expect(layoutNames([one])[0]).toMatch(/Open-plan living|Kitchen-diner|Separate living room|Balanced/);
  });
});
