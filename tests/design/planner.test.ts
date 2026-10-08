import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF, type HouseBrief } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { planLayouts } from "@/domain/design/stripPlanner";
import { deriveRoomRegions, roomFaceIndices } from "@/domain/geometry/derive";
import { apply, level, newHouse } from "../helpers";

const withRear = (doc = newHouse()) => apply(doc, { type: "setRearWall", wallId: level(doc).envelope.wallIds[2] });

function generate(brief: HouseBrief, source = withRear(), count = 3) {
  return planLayouts({ intent: { action: "generate_layouts", brief, count }, source, brief, idPrefix: "t" });
}

const typesOf = (doc: ReturnType<typeof newHouse>) => Object.values(level(doc).rooms).map((r) => r.type).sort();

describe("strip planner", () => {
  it("generates several valid, distinct layouts for the default brief without touching the source", () => {
    const source = withRear();
    const snapshot = JSON.stringify(source);
    const result = generate(DEFAULT_BRIEF, source);
    for (const c of result.candidates) console.info(`${c.summary} | ${c.notes.join(" ")} | ${typesOf(c.document).join(",")}`);
    expect(result.issues).toEqual([]);
    expect(result.candidates.length).toBe(3);
    for (const c of result.candidates) {
      expect(validateDocument(c.document)).toEqual([]);
      const types = typesOf(c.document);
      expect(types.filter((t) => t === "primary_bedroom" || t === "bedroom")).toHaveLength(3);
      expect(types).toContain("ensuite");
      expect(types).toContain("bathroom");
      expect(types).toContain("hall");
      expect(types).not.toContain("unspecified");
      expect(Object.values(level(c.document).openings).filter((o) => o.kind === "door").length).toBeGreaterThanOrEqual(6);
    }
    expect(new Set(result.candidates.map((c) => JSON.stringify(level(c.document).walls))).size).toBe(3);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("is deterministic for the same request", () => {
    expect(JSON.stringify(generate(DEFAULT_BRIEF))).toBe(JSON.stringify(generate(DEFAULT_BRIEF)));
  });

  it("puts the kitchen on the garden side when asked", () => {
    const brief: HouseBrief = { ...DEFAULT_BRIEF, preferences: ["kitchen_faces_garden", "open_plan"] };
    const result = generate(brief, withRear(newHouse(10, 11)));
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) {
      const lvl = level(c.document);
      const regions = deriveRoomRegions(lvl);
      const faces = roomFaceIndices(lvl);
      const kitchen = Object.values(lvl.rooms).find((r) => r.type === "kitchen" || r.type === "kitchen_dining")!;
      const top = Math.max(...regions[faces.get(kitchen.id)!].clear.flatMap((p) => p.outer.map((q) => q.y)));
      // Clear region reaches the inside face of the north (rear) wall.
      expect(top).toBeCloseTo(11 - 0.3, 3);
    }
  });

  it("plans a large brief with every optional space in a bigger house", () => {
    const brief: HouseBrief = {
      bedrooms: 4,
      bathrooms: 3,
      requiredSpaces: ["kitchen", "living", "dining", "office", "utility", "garage"],
      preferences: ["utility_near_kitchen", "maximize_natural_light", "accessible_layout"],
      additionalInstructions: "Somewhere for bikes",
    };
    const result = generate(brief, withRear(newHouse(14, 13)));
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) {
      expect(validateDocument(c.document)).toEqual([]);
      expect(c.notes.join(" ")).toMatch(/free text/);
    }
  });

  it("explains when nothing fits and refuses room-level intents for now", () => {
    const tiny = generate({ ...DEFAULT_BRIEF, bedrooms: 6, bathrooms: 4 }, withRear(newHouse(5, 6)));
    expect(tiny.candidates).toEqual([]);
    expect(tiny.issues[0].code).toBe("does-not-fit");
    const room = planLayouts({ intent: { action: "redesign_room", roomId: "r", goals: ["add_storage"] }, source: newHouse(), brief: DEFAULT_BRIEF, idPrefix: "t" });
    expect(room.issues[0].code).toBe("unsupported-intent");
  });
});
