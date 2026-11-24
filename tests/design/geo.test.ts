import { describe, expect, it } from "vitest";
import { checkBand, DEFAULT_CHECK_BAND, fromGrid, toGrid } from "@/domain/site/geo";

describe("site coordinates", () => {
  it("puts the Irish grid's own origin where the grid defines it", () => {
    // ITM is defined so that 53.5° N, 8° W is easting 600000, northing 750000.
    const p = toGrid([-8, 53.5], "EPSG:2157");
    expect(p.x).toBeCloseTo(600000, 3);
    expect(p.y).toBeCloseTo(750000, 3);
  });

  it("goes to metres and back without moving a traced corner", () => {
    for (const corner of [[-9.0568, 53.2707], [-6.2603, 53.3498], [-10.2, 51.8]] as const) {
      const back = fromGrid(toGrid([corner[0], corner[1]], "EPSG:2157"), "EPSG:2157");
      // 1e-8 degrees is about a millimetre.
      expect(Math.abs(back[0] - corner[0])).toBeLessThan(1e-8);
      expect(Math.abs(back[1] - corner[1])).toBeLessThan(1e-8);
    }
  });

  it("measures north as +y and east as +x", () => {
    const a = toGrid([-9, 53.3], "EPSG:2157");
    expect(toGrid([-9, 53.301], "EPSG:2157").y).toBeGreaterThan(a.y);
    expect(toGrid([-8.999, 53.3], "EPSG:2157").x).toBeGreaterThan(a.x);
  });

  it("uses the default band until an imagery's accuracy has been checked", () => {
    expect(checkBand(undefined)).toBe(DEFAULT_CHECK_BAND);
    expect(checkBand("some-imagery")).toBe(DEFAULT_CHECK_BAND);
  });
});
