import { describe, expect, it } from "vitest";
import { partitionOutline } from "@/domain/geometry/partition";
import { ringSignedArea } from "@/domain/geometry/polygons";
import type { Rect } from "@/domain/geometry/vector";
import { OUTLINES, randomOutline, rectRing } from "../fixtures/outlines";
import { envelope, newOutlineHouse } from "../helpers";

const axisRing = (outline: Parameters<typeof newOutlineHouse>[0]) => envelope(newOutlineHouse(outline)).axisRing;
const r = (minX: number, minY: number, maxX: number, maxY: number): Rect => ({ minX, minY, maxX, maxY });
const area = (x: Rect) => (x.maxX - x.minX) * (x.maxY - x.minY);

describe("splitting outlines into wings", () => {
  it("keeps a rectangle whole", () => {
    expect(partitionOutline(axisRing(rectRing(8, 10)))).toEqual([{ cores: [r(0.15, 0.15, 7.85, 9.85)], fringe: [], mask: 0 }]);
  });

  it("offers both ways of cutting an L, front wing first", () => {
    const [p0, p1] = partitionOutline(axisRing(OUTLINES.L));
    expect(p0.cores).toEqual([r(0.15, 0.15, 11.85, 5.35), r(0.15, 5.35, 5.35, 10.85)]);
    expect(p1.cores).toEqual([r(0.15, 0.15, 5.35, 10.85), r(5.35, 0.15, 11.85, 5.35)]);
    expect(p0.fringe).toEqual([]);
  });

  it("splits a T into its bar and stem, and a U into its base and arms", () => {
    expect(partitionOutline(axisRing(OUTLINES.T))[0].cores).toEqual([r(0.15, 0.15, 13.85, 5.35), r(4.65, 5.35, 9.35, 10.85)]);
    expect(partitionOutline(axisRing(OUTLINES.U))[0].cores).toEqual([r(0.15, 0.15, 13.85, 5.35), r(0.15, 5.35, 4.35, 10.85), r(9.65, 5.35, 13.85, 10.85)]);
  });

  it("treats a bay and the strip beside a corner notch as fringe on the main core", () => {
    const [bay] = partitionOutline(axisRing(OUTLINES.bay));
    expect(bay.cores).toEqual([r(0.15, 0.15, 11.85, 8.85)]);
    expect(bay.fringe).toEqual([{ rect: r(4.15, 8.85, 7.35, 9.85), core: 0, toward: "south" }]);
    const [notch] = partitionOutline(axisRing(OUTLINES.notch));
    expect(notch.cores).toEqual([r(0.15, 0.15, 11.85, 6.85)]);
    expect(notch.fringe).toEqual([{ rect: r(0.15, 6.85, 8.85, 8.85), core: 0, toward: "south" }]);
  });

  it("tiles random outlines exactly, the same way every time", () => {
    let split = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const outline = randomOutline(seed);
      const parts = partitionOutline(outline);
      expect(partitionOutline(outline)).toEqual(parts);
      for (const p of parts) {
        const pieces = [...p.cores, ...p.fringe.map((f) => f.rect)];
        expect(pieces.reduce((sum, x) => sum + area(x), 0), `seed ${seed}`).toBeCloseTo(ringSignedArea(outline), 6);
        for (let i = 0; i < pieces.length; i++) {
          for (let j = i + 1; j < pieces.length; j++) {
            const a = pieces[i];
            const b = pieces[j];
            const overlap = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
            expect(overlap).toBeLessThan(1e-9);
          }
        }
      }
      if (parts.length) split++;
    }
    expect(split).toBeGreaterThan(120);
  });

  it("is quick even with many inward corners", () => {
    const comb: Array<[number, number]> = [[0, 0], [30, 0], [30, 20]];
    for (let i = 0; i < 4; i++) comb.push([26 - i * 6, 20], [26 - i * 6, 14], [23 - i * 6, 14], [23 - i * 6, 20]);
    comb.push([0, 20]);
    const ring = comb.map(([x, y]) => ({ x, y }));
    const start = performance.now();
    expect(partitionOutline(ring).length).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
