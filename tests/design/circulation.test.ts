import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { circulationOf, labelCirculation } from "@/domain/design/circulation";
import { planMetrics } from "@/domain/design/eval/metrics";
import { planLayouts } from "@/domain/design/stripPlanner";
import { apply, level, newHouse } from "../helpers";

const preset = (id: string, extra: Partial<HouseBrief> = {}): HouseBrief => ({ ...withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks), ...extra });
const auto = (brief: HouseBrief) => planLayouts({ intent: { action: "generate_layouts", brief, count: 3, footprint: "auto" }, source: newHouse(), brief, idPrefix: "c" }).candidates;

describe("what each hall is for", () => {
  it("marks every hall of a generated plan, keeping the planners' names", () => {
    for (const c of auto(preset("family-3"))) {
      const halls = c.document.levels.flatMap((l) => Object.values(l.rooms).filter((r) => r.type === "hall"));
      expect(halls.length).toBeGreaterThan(0);
      for (const h of halls) {
        expect(h.circulation, c.arrangement).toBeDefined();
        expect(["Hall", "Landing"]).toContain(h.name);
      }
      // A hall with the front door in it is the entrance hall; the rest are passages or hubs.
      const front = halls.find((h) => h.circulation === "entry");
      if (front) expect(circulationOf(c.document, level(c.document), front.id)).toBe("entry");
    }
  });

  it("calls the hall at the top of the stairs a landing", () => {
    const doc = auto(preset("family-3", { storeys: 2 }))[0].document;
    const upstairs = Object.values(doc.levels[1].rooms).filter((r) => r.type === "hall");
    expect(upstairs.length).toBeGreaterThan(0);
    for (const h of upstairs) expect(h.circulation).toBe("landing");
    expect(planMetrics(doc).hallByKind.landing).toBeGreaterThan(0);
  });

  it("measures each kind of hall, and leaves rooms that aren't halls alone", () => {
    const doc = auto(preset("family-3"))[0].document;
    const m = planMetrics(doc);
    const kinds = Object.values(m.hallByKind).reduce((a, b) => a + b, 0);
    expect(kinds).toBeCloseTo(m.hallShare, 6);
    const room = Object.values(level(doc).rooms).find((r) => r.type === "living")!;
    expect(circulationOf(doc, level(doc), room.id)).toBeNull();
    // Labelling twice changes nothing.
    expect(labelCirculation(doc)).toBe(doc);
  });

  it("can be set or cleared on a room", () => {
    const doc = newHouse();
    const id = Object.keys(level(doc).rooms)[0];
    const set = apply(doc, { type: "updateRoom", roomId: id, changes: { circulation: "hub" } });
    expect(level(set).rooms[id].circulation).toBe("hub");
    expect(level(apply(set, { type: "updateRoom", roomId: id, changes: { circulation: null } })).rooms[id].circulation).toBeUndefined();
  });
});
