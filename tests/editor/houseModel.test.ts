import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { planLayouts } from "@/domain/design/stripPlanner";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { buildHouseModel, CUTAWAY_HEIGHT, type HouseModelOptions } from "@/editor/rendering/three/houseModel";
import { offsetRing } from "@/domain/geometry/outline";
import { ringSignedArea } from "@/domain/geometry/polygons";
import { OUTLINES } from "../fixtures/outlines";
import { addWall, apply, level, newHouse, newOutlineHouse } from "../helpers";

const withRear = (doc = newHouse()) => apply(doc, { type: "setRearWall", wallId: level(doc).envelope.wallIds[2] });
const plan = () => planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 1 }, source: withRear(), brief: DEFAULT_BRIEF, idPrefix: "m" }).candidates[0].document;
const OPTIONS: HouseModelOptions = { cutaway: false, roof: false, dimensions: false, landscape: false, furniture: true };

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
    const full = buildHouseModel(lvl, { cutaway: false, roof: true, dimensions: true, landscape: true, furniture: false });
    expect(full.boxes.some((b) => b.kind === "furniture")).toBe(false);
    expect(full.boxes.filter((b) => b.kind === "roof")).toHaveLength(1);
    expect(full.boxes.filter((b) => b.kind === "parapet")).toHaveLength(4);
    expect(full.labels).toHaveLength(2);
    expect(full.site?.trees.length).toBeGreaterThan(0);
    // Same level and options give the same model object.
    expect(buildHouseModel(lvl, OPTIONS)).toBe(buildHouseModel(lvl, OPTIONS));
  });

  it("stands every piece of furniture on the floor, turned with it", () => {
    const lvl = level(plan());
    const model = buildHouseModel(lvl, OPTIONS);
    const pieces = model.boxes.filter((b) => b.kind === "furniture");
    expect(new Set(pieces.map((b) => b.furnitureId))).toEqual(new Set(Object.keys(lvl.furniture)));
    for (const box of pieces) {
      expect(box.z0).toBeGreaterThanOrEqual(0);
      const item = lvl.furniture[box.furnitureId!];
      expect(box.angle).toBeCloseTo((item.rotation * Math.PI) / 180);
      // Every box stays within its piece's footprint.
      expect(Math.abs(box.center.x - item.position.x)).toBeLessThanOrEqual(Math.max(item.width, item.depth) / 2 + 1e-9);
    }
  });
});

describe("3D model of an outline other than a rectangle", () => {
  const full = { cutaway: false, roof: true, dimensions: true, landscape: true, furniture: false };
  const area = (b: { length: number; depth: number }) => b.length * b.depth;
  const footprint = (b: { center: { x: number; y: number }; length: number; depth: number; angle: number }) => {
    const [w, d] = Math.abs(Math.sin(b.angle)) > 0.5 ? [b.depth, b.length] : [b.length, b.depth];
    return { minX: b.center.x - w / 2, maxX: b.center.x + w / 2, minY: b.center.y - d / 2, maxY: b.center.y + d / 2 };
  };
  const overlap = (a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>) =>
    Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));

  it("roofs an L with slabs that tile it and a parapet along every outside face", () => {
    const model = buildHouseModel(level(newOutlineHouse(OUTLINES.L)), full);
    const roofs = model.boxes.filter((b) => b.kind === "roof");
    const parapets = model.boxes.filter((b) => b.kind === "parapet");
    expect(roofs).toHaveLength(2);
    expect(parapets).toHaveLength(6);
    expect(model.slabs).toHaveLength(2);
    expect(roofs.reduce((sum, b) => sum + area(b), 0)).toBeCloseTo(12 * 5.5 + 5.5 * 5.5, 9);
    expect(model.outline).toEqual(OUTLINES.L);
  });

  it("joins parapets without gaps or overlaps on every named outline", () => {
    for (const [name, ring] of Object.entries(OUTLINES)) {
      const model = buildHouseModel(level(newOutlineHouse(ring)), full);
      const parapets = model.boxes.filter((b) => b.kind === "parapet").map(footprint);
      expect(parapets, name).toHaveLength(ring.length);
      for (let i = 0; i < parapets.length; i++) for (let j = i + 1; j < parapets.length; j++) expect(overlap(parapets[i], parapets[j]), name).toBeLessThan(1e-9);
      // Together they cover exactly the 150 mm strip inside the outside faces.
      const strip = ringSignedArea(ring) - ringSignedArea(offsetRing(ring, -0.15));
      expect(parapets.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxY - r.minY), 0), name).toBeCloseTo(strip, 9);
    }
  });

  it("floors rooms of any shape", () => {
    let doc = newOutlineHouse(OUTLINES.L);
    doc = addWall(doc, "split", [5.35, 5.35], [0.15, 5.35]);
    const model = buildHouseModel(level(doc), OPTIONS);
    expect(model.floors).toHaveLength(2);
    for (const floor of model.floors) {
      expect(floor.polygons).toHaveLength(1);
      expect(floor.area).toBeGreaterThan(20);
    }
  });
});
