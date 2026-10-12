import { describe, expect, it } from "vitest";
import { roomInsight, type CheckedOption } from "@/domain/design/insights";
import type { ProposalImpact } from "@/domain/design/impact";
import { apply, AXIS, level, newHouse } from "../helpers";

/** A house with a narrow kitchen down its west side. */
function narrowKitchen() {
  let doc = newHouse(8, 10);
  doc = apply(doc, { type: "addWall", wallId: "v", start: { x: 2.6, y: AXIS.south }, end: { x: 2.6, y: AXIS.north }, thickness: 0.1, idPrefix: "v" });
  const kitchen = Object.values(level(doc).rooms).sort((a, b) => a.seed.x - b.seed.x)[0];
  doc = apply(doc, { type: "updateRoom", roomId: kitchen.id, changes: { type: "kitchen", name: "Kitchen" } });
  return { lvl: level(doc), kitchenId: kitchen.id };
}

const impact = (roomId: string, areaDelta: number): ProposalImpact => ({ roomId, afterRoomId: roomId, areaBefore: 20, areaAfter: 20 + areaDelta, areaDelta, changes: [], introduced: [], resolved: [] });

describe("what the AI Designer says about a room", () => {
  it("says nothing without an option to back it", () => {
    const { lvl, kitchenId } = narrowKitchen();
    expect(roomInsight(lvl, kitchenId, [])).toBeNull();
  });

  it("points out a narrow room with the larger option's own words and numbers", () => {
    const { lvl, kitchenId } = narrowKitchen();
    const options: CheckedOption[] = [{ goal: "make_larger", title: "Larger kitchen", summary: "Kitchen 2.4 m² larger, taking space from the living room.", impact: impact(kitchenId, 2.4) }];
    const insight = roomInsight(lvl, kitchenId, options);
    expect(insight?.goal).toBe("make_larger");
    expect(insight?.text).toMatch(/^This kitchen is quite narrow at 2\.\d m\. Kitchen 2\.4 m² larger/);
  });

  it("only ever talks about a goal it has an option for", () => {
    const { lvl, kitchenId } = narrowKitchen();
    const options: CheckedOption[] = [{ goal: "more_natural_light", title: "Wider windows", summary: "Wider windows on the outside walls.", impact: impact(kitchenId, 0) }];
    const insight = roomInsight(lvl, kitchenId, options);
    expect(insight === null || insight.goal === "more_natural_light").toBe(true);
  });
});
