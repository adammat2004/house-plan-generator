import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { annexLayouts, doorwaysOn, type Annex } from "@/domain/design/annexPlanner";
import { DOWN } from "@/domain/design/bands";
import { programFromBrief, storeyPrograms, type SpaceSpec } from "@/domain/design/program";
import { splitGround, stackCores } from "@/domain/design/stackPlanner";
import { storeyShapeFootprints } from "@/domain/design/storeyShapes";
import { planLayouts } from "@/domain/design/stripPlanner";
import type { LabeledRoom } from "@/domain/design/wingLayout";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { presetProblem } from "@/domain/geometry/outlinePresets";
import { buildBuildingModel } from "@/editor/rendering/three/buildingModel";
import type { HouseModelOptions } from "@/editor/rendering/three/houseModel";
import { STOREY_OUTLINES } from "../fixtures/outlines";
import { apply, envelope, newOutlineHouse } from "../helpers";

const two = (brief: HouseBrief): HouseBrief => ({ ...brief, storeys: 2 });
const family3 = two(withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === "family-3")!.picks));
const space = (type: SpaceSpec["type"]) => programFromBrief(family3).spaces.find((s) => s.type === type)!;

/** A 4 × 5 m wing behind a 4 m stretch of living room and 4 m of hall, at y = 9. */
const WING: Annex = { index: 1, rect: { minX: 0, maxX: 8, minY: 9, maxY: 14 }, side: "south", lo: 0, hi: 8, parent: -1 };
const BESIDE: LabeledRoom[] = [
  { key: "hall", kind: "hall", name: "Hall", type: "hall", window: "none", rects: [{ minX: 0, maxX: 4, minY: 4, maxY: 9 }] },
  { key: "living", kind: "room", name: "Living Room", type: "living", window: "large", rects: [{ minX: 4, maxX: 8, minY: 4, maxY: 9 }] },
];

describe("wings beside a stacked house", () => {
  it("finds the stretches of the junction each room meets, clear of the stairs", () => {
    expect(doorwaysOn(WING, BESIDE)).toEqual([
      { from: "hall", lo: 0, hi: 4 },
      { from: { key: "living", type: "living" }, lo: 4, hi: 8 },
    ]);
    // Stairs climbing to within a door's swing of the junction take their stretch of the hall.
    const stairs = { minX: 0.2, maxX: 1.1, minY: 5, maxY: 8.5 };
    expect(doorwaysOn(WING, BESIDE, [stairs]).filter((d) => d.from === "hall")).toEqual([
      { from: "hall", lo: 0, hi: 0.15 },
      { from: "hall", lo: 1.15, hi: 4 },
    ]);
  });

  it("fills a wing with rooms opening off what it meets", () => {
    const layouts = annexLayouts(WING, [space("kitchen_dining"), space("utility")], doorwaysOn(WING, BESIDE), DOWN, { doorWidth: 0.9 });
    expect(layouts.length).toBeGreaterThan(0);
    const best = layouts[0];
    // The wing is filled exactly.
    expect(best.rooms.reduce((sum, r) => sum + r.rects.reduce((s, q) => s + (q.maxX - q.minX) * (q.maxY - q.minY), 0), 0)).toBeCloseTo(40, 6);
    // The kitchen opens to the garden; the utility off the kitchen or the hall.
    const kitchen = best.rooms.find((r) => r.type === "kitchen_dining")!;
    expect(kitchen.gardenDoor).toBe(true);
    const utility = best.rooms.find((r) => r.type === "utility")!;
    expect([undefined, kitchen.key]).toContain(utility.via);
  });

  it("can't fill a wing it has no way into", () => {
    const shut: LabeledRoom[] = [{ key: "wc", kind: "room", name: "WC", type: "wc", window: "small", rects: [{ minX: 0, maxX: 8, minY: 4, maxY: 9 }] }];
    expect(annexLayouts(WING, [space("kitchen_dining")], doorwaysOn(WING, shut), DOWN, { doorWidth: 0.9 })).toEqual([]);
  });

  it("stacks the main part of an L house that reaches the street", () => {
    const env = analyzeEnvelope(newOutlineHouse(STOREY_OUTLINES.L).levels[0]);
    if (!env.ok) throw new Error(env.message);
    const { stacks } = stackCores(env.info.axisRing, "north");
    expect(stacks[0].core).toEqual({ minX: 0.15, maxX: 8.35, minY: 0.15, maxY: 8.85 });
    expect(stacks[0].annexes).toHaveLength(1);
    // Every part stacked reaches the street.
    for (const s of stacks) expect(s.core.minY).toBeCloseTo(0.15, 6);
  });

  it("keeps the WC and a living space in the part with the stairs", () => {
    const env = analyzeEnvelope(newOutlineHouse(STOREY_OUTLINES.U).levels[0]);
    if (!env.ok) throw new Error(env.message);
    const { stacks } = stackCores(env.info.axisRing, "north");
    const { ground } = storeyPrograms(family3, 0, { wings: true });
    for (const stack of stacks) {
      for (const split of splitGround(ground.spaces, stack.annexes, stack.core)) {
        expect(split.core.some((s) => s.type === "wc")).toBe(true);
        expect(split.core.some((s) => s.type === "living" || s.type === "kitchen_dining")).toBe(true);
        expect(split.annexes).toHaveLength(stack.annexes.length);
      }
    }
  });

  it("keeps an office downstairs when there are wings to put it in", () => {
    const brief = two(withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === "family-4")!.picks));
    expect(storeyPrograms(brief).upper.spaces.map((s) => s.name)).toContain("Study");
    expect(storeyPrograms(brief, 0, { wings: true }).ground.spaces.map((s) => s.type)).toContain("office");
  });

  it("sizes shaped two-storey houses round a main part deep enough for the stairs", () => {
    const { ground, upper } = storeyPrograms(two(withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === "family-4")!.picks)), 0, { wings: true });
    for (const family of ["L", "T", "U"] as const) {
      const sizes = storeyShapeFootprints(ground, upper, family, { externalThickness: 0.3, doorWidth: 0.9, risers: 13 });
      expect(sizes.length, family).toBeGreaterThan(0);
      for (const fp of sizes) {
        expect(fp.key.startsWith(`${family}:`)).toBe(true);
        expect(presetProblem(family, fp.params, 0.3)).toBeNull();
        // The main part, outside, at least 7 m from the street.
        expect(fp.params.front).toBeGreaterThanOrEqual(7);
        expect(fp.core.maxY - fp.core.minY).toBeCloseTo(fp.params.front - 0.3, 6);
      }
    }
  });

  it("roofs a single-storey wing", () => {
    const doc = newOutlineHouse(STOREY_OUTLINES.L);
    const source = apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
    const result = planLayouts({ intent: { action: "generate_layouts", brief: family3, count: 1 }, source, brief: family3, idPrefix: "r" });
    const house = result.candidates[0].document;
    const options: HouseModelOptions = { cutaway: false, roof: true, dimensions: false, landscape: false, furniture: false };
    const roofs = buildBuildingModel(house, options).boxes.filter((b) => b.kind === "roof");
    const low = roofs.filter((b) => Math.abs(b.z0 - house.levels[0].defaultWallHeight) < 1e-9);
    // The wing behind, 4.5 × 4 m outside, under its own flat roof.
    expect(low.reduce((s, r) => s + r.length * r.depth, 0)).toBeGreaterThan(15);
  });
});
