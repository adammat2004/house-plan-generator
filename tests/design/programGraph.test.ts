import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { roomConnections } from "@/domain/design/analysis";
import { DOWN, UP } from "@/domain/design/bands";
import { programGraph } from "@/domain/design/concept/programGraph";
import { planLayouts } from "@/domain/design/stripPlanner";
import { isZoneLayout } from "@/domain/design/zoneLayouts";
import { level, newHouse } from "../helpers";

const preset = (id: string, extra: Partial<HouseBrief> = {}): HouseBrief => ({ ...withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks), ...extra });
const auto = (brief: HouseBrief) => planLayouts({ intent: { action: "generate_layouts", brief, count: 3, footprint: "auto" }, source: newHouse(), brief, idPrefix: "g" }).candidates;
const spec = (type: string, key = type) => ({ key, type, name: type, target: 10, minWidth: 2, zone: "day", window: "standard", ensuite: false }) as Parameters<typeof DOWN.hall>[0];

describe("the program graph", () => {
  it("is where every planner's door rules come from", () => {
    const g = programGraph();
    // Living spaces open off the hall, or off each other; the second one off the hall turns it into a corridor.
    expect(g.down("hall", "living")).toBe(0);
    expect(g.down("hall", "living", true)).toBe(2);
    expect(g.down("kitchen", "dining")).toBe(0);
    expect(g.down("kitchen_dining", "utility")).toBe(0);
    expect(g.down("living", "utility")).toBe(2);
    expect(g.down("utility", "garage")).toBe(0.5);
    expect(g.down("bedroom", "living")).toBe(Infinity);
    // The bands use the same graph.
    expect(DOWN.hall(spec("office"))).toBe(g.down("hall", "office"));
    expect(DOWN.via({ key: "k", type: "kitchen" }, spec("utility"))).toBe(0);
    expect(UP.via({ key: "m", type: "primary_bedroom" }, spec("ensuite", "m-ensuite"))).toBe(0);
    expect(UP.hall(spec("ensuite"))).toBe(Infinity);
  });

  it("takes the brief's preferences in", () => {
    expect(programGraph({ primaryPrivate: true }).quiet).toBeGreaterThan(programGraph().quiet);
    expect(programGraph({ kitchenGarden: true }).kitchenAway).toBeGreaterThan(0);
    expect(programGraph().kitchenAway).toBe(0);
    const near = programGraph({ utilityNearKitchen: true });
    expect(near.down("hall", "utility")).toBeGreaterThan(programGraph().down("hall", "utility"));
    expect(near.down("living", "utility")).toBeGreaterThan(programGraph().down("living", "utility"));
    expect(near.down("kitchen", "utility")).toBe(0);
    expect(programGraph({ utilityNearKitchen: true })).toBe(near);
  });

  it("puts the utility through the kitchen when the brief asks", () => {
    for (const c of auto(preset("family-3", { preferences: ["utility_near_kitchen"] })).filter((x) => isZoneLayout(x.arrangement))) {
      const lvl = level(c.document);
      const utility = Object.values(lvl.rooms).find((r) => r.type === "utility");
      if (!utility) continue;
      const into = roomConnections(lvl, utility.id).filter((x) => x.kind === "door" && x.target.kind === "room").map((x) => (x.target.kind === "room" ? lvl.rooms[x.target.roomId].type : null));
      expect(into.some((t) => t === "kitchen" || t === "kitchen_dining"), c.arrangement).toBe(true);
    }
  });
});
