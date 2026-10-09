import { describe, expect, it } from "vitest";
import {
  checkOutlineRing,
  classifyOutline,
  normalizeRing,
  outsideToAxis,
  reflexVertices,
  slabPartition,
  axisToOutside,
} from "@/domain/geometry/outline";
import { polygonArea, ringSignedArea } from "@/domain/geometry/polygons";
import type { Point2 } from "@/domain/plan/types";
import { OUTLINES, rectRing } from "../fixtures/outlines";

const pts = (...xy: Array<[number, number]>): Point2[] => xy.map(([x, y]) => ({ x, y }));
const axisOf = (outside: Point2[], t = 0.3) => outsideToAxis(normalizeRing(outside), t);

describe("outline rings", () => {
  it("normalises direction, start corner, repeats and collinear points", () => {
    // Clockwise, starting mid-edge, with a repeated point and a point in the middle of a wall.
    const messy = pts([6, 0], [0, 0], [0, 11], [5.5, 11], [5.5, 11], [5.5, 5.5], [12, 5.5], [12, 0]);
    expect(normalizeRing(messy)).toEqual(OUTLINES.L);
    expect(normalizeRing([...OUTLINES.U.slice(3), ...OUTLINES.U.slice(0, 3)])).toEqual(OUTLINES.U);
  });

  it("starts at the lowest south-facing wall, westmost first", () => {
    // Both feet of the U-turned-over face south at y = 0; the west one comes first.
    const arch = pts([0, 0], [4, 0], [4, 5], [10, 5], [10, 0], [14, 0], [14, 9], [0, 9]);
    expect(normalizeRing([...arch.slice(4), ...arch.slice(0, 4)])[0]).toEqual({ x: 0, y: 0 });
  });

  it("offsets convex and reflex corners alike", () => {
    expect(axisOf(OUTLINES.L)).toEqual(pts([0.15, 0.15], [11.85, 0.15], [11.85, 5.35], [5.35, 5.35], [5.35, 10.85], [0.15, 10.85]));
    const back = axisToOutside(axisOf(OUTLINES.L), 0.3).map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
    expect(back).toEqual(OUTLINES.L);
    // Thicker walls on some sides only move those sides.
    const mixed = outsideToAxis(rectRing(8, 10), [0.3, 0.5, 0.3, 0.5]);
    expect(mixed).toEqual(pts([0.25, 0.15], [7.75, 0.15], [7.75, 9.85], [0.25, 9.85]));
  });

  it("classifies the outline families", () => {
    expect(classifyOutline(rectRing(8, 10))).toBe("rectangle");
    expect(classifyOutline(OUTLINES.L)).toBe("L");
    expect(classifyOutline(OUTLINES.notch)).toBe("L");
    expect(classifyOutline(OUTLINES.T)).toBe("T");
    expect(classifyOutline(OUTLINES.bay)).toBe("T");
    expect(classifyOutline(OUTLINES.U)).toBe("U");
    expect(classifyOutline(OUTLINES.Z)).toBe("Z");
    expect(classifyOutline(OUTLINES.plus)).toBe("custom");
    expect(classifyOutline(OUTLINES.stairs)).toBe("custom");
    expect(reflexVertices(OUTLINES.L)).toEqual([3]);
  });

  it("splits outlines into rectangles that tile them", () => {
    expect(slabPartition(rectRing(8, 10))).toEqual([{ minX: 0, minY: 0, maxX: 8, maxY: 10 }]);
    expect(slabPartition(OUTLINES.L)).toEqual([
      { minX: 0, minY: 0, maxX: 12, maxY: 5.5 },
      { minX: 0, minY: 5.5, maxX: 5.5, maxY: 11 },
    ]);
    for (const ring of Object.values(OUTLINES)) {
      const area = slabPartition(ring).reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxY - r.minY), 0);
      expect(area).toBeCloseTo(ringSignedArea(ring), 9);
    }
    expect(slabPartition(OUTLINES.U)).toHaveLength(3);
  });

  it("accepts every named outline", () => {
    for (const [name, ring] of Object.entries(OUTLINES)) {
      expect(checkOutlineRing(axisOf(ring), 0.3), name).toBeNull();
    }
    expect(checkOutlineRing(axisOf(rectRing(1.1, 1.1)), 0.3)).toBeNull();
  });

  it("refuses outlines that aren't a house, saying where", () => {
    const check = (outside: Point2[]) => checkOutlineRing(outsideToAxis(outside, 0.3), 0.3)?.message;
    // Two squares meeting at one corner.
    expect(check(pts([0, 0], [4, 0], [4, 4], [8, 4], [8, 8], [4, 8], [4, 4], [0, 4]))).toMatch(/touches itself in the middle/);
    // A rear wing only 0.9 m wide outside.
    expect(check(pts([0, 0], [12, 0], [12, 5.5], [0.9, 5.5], [0.9, 11], [0, 11]))).toBe(
      "The house is only 0.3 m wide inside near the north-west corner; it needs at least 0.5 m.",
    );
    // A U whose arms almost meet.
    expect(check(pts([0, 0], [14, 0], [14, 11], [7.2, 11], [7.2, 5.5], [6.8, 5.5], [6.8, 11], [0, 11]))).toMatch(
      /^Two parts of the house along the north side are only 0.4 m apart/,
    );
    // A 100 mm step.
    expect(check(pts([0, 0], [10, 0], [10, 8], [5, 8], [5, 8.1], [0, 8.1]))).toMatch(/^A step in the house outline along the north side is 0.1 m; steps must be at least 300 mm/);
    expect(checkOutlineRing([...outsideToAxis(rectRing(8, 10), 0.3)].reverse(), 0.3)?.message).toBe("Outline walls must run counterclockwise.");
    expect(checkOutlineRing(pts([0, 0], [8, 0], [8, 8], [1, 9]), 0.3)?.message).toBe("House outline walls must be horizontal or vertical.");
    expect(checkOutlineRing(pts([0, 0], [8, 0], [8, 8]), 0.3)?.message).toBe("The house outline needs at least four corners.");
  });

  it("keeps the inside area equal to the area the walls enclose", () => {
    const axis = axisOf(OUTLINES.T);
    const inside = outsideToAxis(axis, 0.3);
    // Bar 13.4 × 4.9 inside, stem 4.4 wide running 5.5 further back.
    expect(polygonArea({ outer: inside, holes: [] })).toBeCloseTo(13.4 * 4.9 + 4.4 * 5.5, 6);
  });
});
