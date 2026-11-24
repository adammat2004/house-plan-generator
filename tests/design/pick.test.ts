import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks } from "@/domain/brief/schema";
import { chargeFurniture, MISSING_FURNITURE_COST, missingFurniture } from "@/domain/design/select/pick";
import { planLayouts } from "@/domain/design/stripPlanner";
import { apply, level, newHouse } from "../helpers";

const brief = withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === "family-3")!.picks);
/** A 2.2 m square house whose one room is a bedroom: too small for a bed. */
const cramped = () => {
  const doc = newHouse(2.2, 2.2);
  return apply(doc, { type: "updateRoom", roomId: Object.keys(level(doc).rooms)[0], changes: { type: "bedroom" } });
};
const plan = () => planLayouts({ intent: { action: "generate_layouts", brief, count: 1, footprint: "auto" }, source: newHouse(), brief, idPrefix: "p" }).candidates[0].document;

describe("furniture in judging plans", () => {
  it("counts the pieces a plan's rooms are for that don't fit", () => {
    const doc = plan();
    expect(missingFurniture(doc)).toBe(0);
    // A bedroom too small for its bed.
    expect(missingFurniture(cramped())).toBeGreaterThan(0);
  });

  it("charges the best few plans for each missing piece, leaving the rest and the originals alone", () => {
    const good = plan();
    const small = cramped();
    const candidates = [
      { document: good, sense: { findings: [], score: 90 } },
      { document: small, sense: { findings: [], score: 95 } },
      { document: small, sense: { findings: [], score: 10 } },
    ];
    const charged = chargeFurniture(candidates, 2);
    const missing = missingFurniture(small);
    expect(charged[0].sense.score).toBe(90);
    expect(charged[1].sense.score).toBe(95 - MISSING_FURNITURE_COST * missing);
    // Beyond the best two: not furnished, not charged.
    expect(charged[2].sense.score).toBe(10);
    expect(candidates[1].sense.score).toBe(95);
  });
});
