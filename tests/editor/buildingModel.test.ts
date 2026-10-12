import { describe, expect, it } from "vitest";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { polygonArea } from "@/domain/geometry/polygons";
import { staircasePlan } from "@/domain/geometry/stairs";
import type { PlanDocument } from "@/domain/plan/types";
import { buildBuildingModel, planOf, subtractRects } from "@/editor/rendering/three/buildingModel";
import { buildHouseModel, CUTAWAY_HEIGHT, type Box, type HouseModelOptions } from "@/editor/rendering/three/houseModel";
import { apply, level, newHouse } from "../helpers";

const OPTIONS: HouseModelOptions = { cutaway: false, roof: true, dimensions: false, landscape: false, furniture: false };
const floor = (doc: PlanDocument, i: number) => doc.levels[i];
const top = (b: Box) => b.z0 + b.height;
const area = (b: Box) => b.length * b.depth;

/** An 8 × 10 m house with a first floor and straight stairs up from the ground floor. */
function twoStorey(): PlanDocument {
  let doc = apply(newHouse(), { type: "addLevel" });
  doc = apply(doc, {
    type: "addStairs",
    staircase: { id: "s1", fromLevelId: floor(doc, 0).id, toLevelId: floor(doc, 1).id, shape: "straight", foot: { x: 1.2, y: 1.2 }, rotation: 0, width: 0.9, going: 0.25 },
  });
  return doc;
}

describe("3D model of a house of several floors", () => {
  it("is exactly the floor's own model for a bungalow", () => {
    const doc = newHouse();
    expect(buildBuildingModel(doc, OPTIONS)).toBe(buildHouseModel(level(doc), OPTIONS));
    expect(planOf(level(doc))).toBe(planOf(level(doc)));
  });

  it("raises every floor to its height, on a floor open where the stairs come up", () => {
    const doc = twoStorey();
    const model = buildBuildingModel(doc, OPTIONS);
    const upperWalls = new Set(Object.keys(floor(doc, 1).walls));
    const raised = model.boxes.filter((b) => b.wallId && upperWalls.has(b.wallId));
    expect(raised.length).toBeGreaterThan(0);
    for (const b of raised) expect(b.z0).toBeGreaterThanOrEqual(2.7 - 1e-9);
    expect(model.floors.filter((f) => f.levelId === floor(doc, 1).id).every((f) => f.z === 2.7)).toBe(true);

    const opening = staircasePlan(doc, doc.staircases!.s1).footprint[0];
    const holeArea = (opening.maxX - opening.minX) * (opening.maxY - opening.minY);
    const slabs = model.boxes.filter((b) => b.kind === "slab");
    for (const s of slabs) {
      expect(s.z0).toBeCloseTo(2.4, 9);
      expect(s.height).toBeCloseTo(0.3, 9);
    }
    const env = analyzeEnvelope(floor(doc, 1));
    expect(slabs.reduce((sum, s) => sum + area(s), 0)).toBeCloseTo((env.ok ? env.info.grossArea : 0) - holeArea, 6);

    // The upstairs floor has the stairwell cut out of it.
    const upstairs = model.floors.find((f) => f.levelId === floor(doc, 1).id)!;
    expect(upstairs.polygons.reduce((sum, p) => sum + polygonArea(p), 0)).toBeCloseTo(upstairs.area - holeArea, 6);
    expect(model.boxes.filter((b) => b.kind === "balustrade").length).toBeGreaterThan(0);
  });

  it("builds the stairs step by step up to the floor above", () => {
    const doc = twoStorey();
    const steps = buildBuildingModel(doc, OPTIONS).boxes.filter((b) => b.kind === "stair");
    expect(steps).toHaveLength(12);
    expect(Math.max(...steps.map(top))).toBeCloseTo((12 * 2.7) / 13, 9);
  });

  it("roofs the top floor, and only what no floor covers below it", () => {
    const doc = twoStorey();
    const roofs = buildBuildingModel(doc, OPTIONS).boxes.filter((b) => b.kind === "roof");
    expect(roofs.every((r) => Math.abs(r.z0 - 5.1) < 1e-9)).toBe(true);
    expect(roofs.reduce((s, r) => s + area(r), 0)).toBeCloseTo(80, 6);

    // A single-storey extension at the back gets its own roof and three parapets.
    const north = analyzeEnvelope(floor(doc, 0));
    const extended = apply(doc, { type: "moveOutlineEdge", wallId: north.ok ? north.info.sides.north : "", outward: 4 });
    const boxes = buildBuildingModel(extended, OPTIONS).boxes;
    const low = boxes.filter((b) => b.kind === "roof" && Math.abs(b.z0 - 2.4) < 1e-9);
    expect(low.reduce((s, r) => s + area(r), 0)).toBeCloseTo(8 * 4, 6);
    const lowParapets = boxes.filter((b) => b.kind === "parapet" && Math.abs(b.z0 - 2.65) < 1e-9);
    expect(lowParapets.length).toBeGreaterThanOrEqual(3);
    expect(lowParapets.every((p) => p.center.y > 10 - 0.3)).toBe(true);
  });

  it("leaves the floors above off, and cuts away the top one shown", () => {
    const doc = twoStorey();
    const ground = buildBuildingModel(doc, { ...OPTIONS, upTo: floor(doc, 0).id });
    // Only the stairs climb past the ceiling, up to where the floor above would be.
    expect(Math.max(...ground.boxes.filter((b) => b.kind !== "stair").map(top))).toBeLessThanOrEqual(2.4 + 1e-9);
    expect(Math.max(...ground.boxes.map(top))).toBeLessThan(2.7);
    expect(ground.boxes.some((b) => b.kind === "roof" || b.kind === "slab")).toBe(false);
    expect(ground.floors.every((f) => f.z === undefined)).toBe(true);

    const cut = buildBuildingModel(doc, { ...OPTIONS, cutaway: true });
    const upperWalls = new Set(Object.keys(floor(doc, 1).walls));
    for (const b of cut.boxes.filter((b) => b.wallId && upperWalls.has(b.wallId))) expect(top(b)).toBeLessThanOrEqual(2.7 + CUTAWAY_HEIGHT + 1e-9);
    // The ground floor below stays whole.
    expect(cut.boxes.some((b) => b.kind === "wall" && !upperWalls.has(b.wallId!) && top(b) > 2.3)).toBe(true);
    expect(cut.ceilings?.length).toBeGreaterThan(0);
  });

  it("cuts holes out of rectangles", () => {
    const r = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
    const pieces = subtractRects([r], [{ minX: 1, minY: 1, maxX: 2, maxY: 2 }]);
    expect(pieces.reduce((s, p) => s + (p.maxX - p.minX) * (p.maxY - p.minY), 0)).toBeCloseTo(15, 9);
    expect(subtractRects([r], [{ minX: 5, minY: 5, maxX: 6, maxY: 6 }])).toEqual([r]);
  });
});
