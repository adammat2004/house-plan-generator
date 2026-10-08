import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { planLayouts } from "@/domain/design/stripPlanner";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { buildHouseModel, CUTAWAY_HEIGHT, type HouseModelOptions } from "@/editor/rendering/three/houseModel";
import { apply, level, newHouse } from "../helpers";

const withRear = (doc = newHouse()) => apply(doc, { type: "setRearWall", wallId: level(doc).envelope.wallIds[2] });
const plan = () => planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 1 }, source: withRear(), brief: DEFAULT_BRIEF, idPrefix: "m" }).candidates[0].document;
const OPTIONS: HouseModelOptions = { cutaway: false, roof: false, dimensions: false, landscape: false };

/** Interval a box covers along its wall's axis. */
function span(box: { center: { x: number; y: number }; length: number }, axis: ReturnType<typeof deriveLevelGeometry>["axes"] extends Map<string, infer A> ? A : never) {
  const along = (axis.orientation === "horizontal" ? box.center.x - axis.start.x : box.center.y - axis.start.y) * (axis.orientation === "horizontal" ? Math.sign(axis.dir.x) : Math.sign(axis.dir.y));
  return [along - box.length / 2, along + box.length / 2];
}

describe("3D house model", () => {
  it("leaves every door and window open, with sills and lintels at the right heights", () => {
    const doc = plan();
    const lvl = level(doc);
    const model = buildHouseModel(lvl, OPTIONS);
    const axes = deriveLevelGeometry(lvl).axes;
    expect(Object.keys(lvl.openings).length).toBeGreaterThan(4);
    for (const o of Object.values(lvl.openings)) {
      const axis = axes.get(o.wallId)!;
      for (const box of model.boxes.filter((b) => b.kind === "wall" && b.wallId === o.wallId)) {
        const [a, b] = span(box, axis);
        // Full-height wall never reaches into the opening.
        expect(Math.min(b, o.offset + o.width) - Math.max(a, o.offset)).toBeLessThanOrEqual(1e-6);
      }
      const lintel = model.boxes.find((b) => b.kind === "lintel" && b.wallId === o.wallId && Math.abs(span(b, axis)[0] - o.offset) < 1e-6);
      const top = o.kind === "window" ? o.sillHeight + o.height : o.height;
      if (top < axis.wall.height - 1e-6) expect(lintel?.z0).toBeCloseTo(top, 6);
      if (o.kind === "window") {
        const sill = model.boxes.find((b) => b.kind === "sill" && b.wallId === o.wallId && Math.abs(span(b, axis)[0] - o.offset) < 1e-6);
        expect(sill?.height).toBeCloseTo(o.sillHeight, 6);
      }
    }
    expect(model.boxes.filter((b) => b.kind === "door")).toHaveLength(Object.values(lvl.openings).filter((o) => o.kind === "door").length);
  });

  it("has one floor per room and marks the outside face of external walls", () => {
    const lvl = level(plan());
    const model = buildHouseModel(lvl, OPTIONS);
    expect(model.floors.map((f) => f.roomId).sort()).toEqual(Object.keys(lvl.rooms).sort());
    const external = model.boxes.filter((b) => b.kind === "wall" && b.outward);
    expect(external.length).toBeGreaterThan(0);
    // The outward normal points away from the house centre.
    const c = { x: (model.outside!.minX + model.outside!.maxX) / 2, y: (model.outside!.minY + model.outside!.maxY) / 2 };
    for (const b of external) expect((b.center.x - c.x) * b.outward!.x + (b.center.y - c.y) * b.outward!.y).toBeGreaterThan(0);
  });

  it("cuts walls down for a cutaway view, and adds a roof, labels and site on request", () => {
    const lvl = level(plan());
    const cut = buildHouseModel(lvl, { ...OPTIONS, cutaway: true, roof: true });
    expect(Math.max(...cut.boxes.map((b) => b.z0 + b.height))).toBeLessThanOrEqual(CUTAWAY_HEIGHT + 1e-9);
    expect(cut.boxes.some((b) => b.kind === "roof")).toBe(false);
    const full = buildHouseModel(lvl, { cutaway: false, roof: true, dimensions: true, landscape: true });
    expect(full.boxes.filter((b) => b.kind === "roof")).toHaveLength(1);
    expect(full.boxes.filter((b) => b.kind === "parapet")).toHaveLength(4);
    expect(full.labels).toHaveLength(2);
    expect(full.site?.trees.length).toBeGreaterThan(0);
    // Same level and options give the same model object.
    expect(buildHouseModel(lvl, OPTIONS)).toBe(buildHouseModel(lvl, OPTIONS));
  });
});
