import { describe, expect, it } from "vitest";
import { offsetRing } from "@/domain/geometry/outline";
import { pointInRing, type Ring } from "@/domain/geometry/polygons";
import { buildBuildingModel } from "@/editor/rendering/three/buildingModel";
import { buildHouseModel, type HouseModelOptions } from "@/editor/rendering/three/houseModel";
import { multiPolygonArea, pointInPolygon } from "@/domain/geometry/polygons";
import { gabledRoof, hippedRoof, leanToRoof, maximalRects, roofSurfaces, ROOF_FASCIA, ROOF_OVERHANG, ROOF_PITCH, roofHeight, roofTop, roofTriangles, type RoofPiece } from "@/editor/rendering/three/roofModel";
import { OUTLINES, rectRing } from "../fixtures/outlines";
import { level, newOutlineHouse } from "../helpers";

const SLOPE = Math.tan(ROOF_PITCH);
const lines = (ring: Ring, k: "x" | "y") => [...new Set(ring.map((p) => p[k]))].sort((a, b) => a - b);

/** How far p is from leaving the outline, moving in any one direction or diagonally (the L∞ distance to its outside). */
function depthIn(ring: Ring, p: { x: number; y: number }): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = Math.max(Math.min(a.x, b.x) - p.x, 0, p.x - Math.max(a.x, b.x));
    const dy = Math.max(Math.min(a.y, b.y) - p.y, 0, p.y - Math.max(a.y, b.y));
    best = Math.min(best, Math.max(dx, dy));
  }
  return best;
}

const ringArea = (r: Ring) => r.reduce((sum, p, i) => sum + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2;

/** The roof at a point: the highest piece over it. */
const surface = (pieces: readonly RoofPiece[], x: number, y: number) =>
  Math.max(-Infinity, ...pieces.filter((p) => x >= p.rect.minX - 1e-9 && x <= p.rect.maxX + 1e-9 && y >= p.rect.minY - 1e-9 && y <= p.rect.maxY + 1e-9).map((p) => roofHeight(p, x, y)));

/** Volume enclosed by triangles wound outward. */
function volume(tris: ReturnType<typeof roofTriangles>): number {
  let v = 0;
  for (const [a, b, c] of tris) v += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
  return v;
}

describe("pitched roofs", () => {
  it("covers an outline with its largest rectangles", () => {
    const L = OUTLINES.L;
    expect(maximalRects(lines(L, "x"), lines(L, "y"), (x, y) => pointInRing(L, { x, y }))).toHaveLength(2);
    const U = OUTLINES.U;
    expect(maximalRects(lines(U, "x"), lines(U, "y"), (x, y) => pointInRing(U, { x, y }))).toHaveLength(3);
    const rect = rectRing(10, 8);
    expect(maximalRects(lines(rect, "x"), lines(rect, "y"), (x, y) => pointInRing(rect, { x, y }))).toEqual([{ minX: 0, maxX: 10, minY: 0, maxY: 8 }]);
  });

  it("hips a rectangle to a ridge half its depth (plus overhang) up", () => {
    const pieces = hippedRoof(rectRing(10, 8), 2.4);
    expect(pieces).toHaveLength(1);
    expect(roofTop(pieces)).toBeCloseTo(2.4 + ROOF_FASCIA + SLOPE * (4 + ROOF_OVERHANG), 9);
    // The eaves stand out past the walls.
    expect(pieces[0].rect).toEqual({ minX: -ROOF_OVERHANG, maxX: 10 + ROOF_OVERHANG, minY: -ROOF_OVERHANG, maxY: 8 + ROOF_OVERHANG });
  });

  it("makes every outline's roof its straight skeleton: hips, ridges and valleys at one pitch", () => {
    for (const [name, ring] of Object.entries(OUTLINES)) {
      const pieces = hippedRoof(ring, 0);
      const eaves = offsetRing(ring, ROOF_OVERHANG);
      for (let x = -0.3; x < 15; x += 0.37) {
        for (let y = -0.3; y < 13; y += 0.41) {
          if (!pointInRing(eaves, { x, y })) continue;
          expect(surface(pieces, x, y), `${name} at ${x.toFixed(2)},${y.toFixed(2)}`).toBeCloseTo(ROOF_FASCIA + SLOPE * depthIn(eaves, { x, y }), 6);
        }
      }
    }
  });

  it("draws each piece as a closed solid wound outward", () => {
    for (const piece of [...hippedRoof(OUTLINES.L, 2.4), ...leanToRoof(rectRing(10, 12), rectRing(10, 8), 2.4, 2.65)]) {
      const r = piece.rect;
      // The volume under the roof surface, summed on a fine grid.
      const n = 200;
      let expected = 0;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const x = r.minX + ((i + 0.5) * (r.maxX - r.minX)) / n;
          const y = r.minY + ((j + 0.5) * (r.maxY - r.minY)) / n;
          expected += (roofHeight(piece, x, y) - piece.z0) * ((r.maxX - r.minX) / n) * ((r.maxY - r.minY) / n);
        }
      expect(volume(roofTriangles(piece))).toBeCloseTo(expected, 1);
    }
  });

  it("merges faces that share a plane, still covering the whole roof at its height", () => {
    for (const [name, ring] of Object.entries(OUTLINES)) {
      const pieces = hippedRoof(ring, 0);
      const surfaces = roofSurfaces(pieces);
      const eaves = offsetRing(ring, ROOF_OVERHANG);
      // A fascia the whole length of every eave, and one soffit the shape of the eaves.
      for (let i = 0; i < eaves.length; i++) {
        const [a, b] = [eaves[i], eaves[(i + 1) % eaves.length]];
        const horizontal = Math.abs(a.y - b.y) < 1e-9;
        const [lo, hi] = horizontal ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
        const covering = surfaces.fascias.filter((f) => (horizontal ? Math.abs(f.a.y - a.y) < 1e-9 && Math.abs(f.b.y - a.y) < 1e-9 : Math.abs(f.a.x - a.x) < 1e-9 && Math.abs(f.b.x - a.x) < 1e-9));
        const spans = covering.map((f) => (horizontal ? [Math.min(f.a.x, f.b.x), Math.max(f.a.x, f.b.x)] : [Math.min(f.a.y, f.b.y), Math.max(f.a.y, f.b.y)]));
        expect(spans.some(([s0, s1]) => s0 <= lo + 1e-9 && s1 >= hi - 1e-9), `${name} edge ${i}`).toBe(true);
      }
      expect(surfaces.soffits).toHaveLength(1);
      expect(multiPolygonArea(surfaces.soffits[0].polygons), name).toBeCloseTo(Math.abs(ringArea(eaves)), 6);
      for (let x = -0.3; x < 15; x += 0.53) {
        for (let y = -0.3; y < 13; y += 0.47) {
          if (!pointInRing(eaves, { x, y })) continue;
          const tops = surfaces.slopes.filter((s) => s.polygons.some((poly) => pointInPolygon(poly, { x, y }))).map((s) => s.a * x + s.b * y + s.c);
          expect(Math.max(...tops), `${name} at ${x.toFixed(2)},${y.toFixed(2)}`).toBeCloseTo(surface(pieces, x, y), 6);
        }
      }
    }
  });

  it("leans a roof against the floor above, rising to it and staying under its windows", () => {
    // A 10 × 12 m ground floor with a 10 × 8 m floor over its front.
    const pieces = leanToRoof(rectRing(10, 12), rectRing(10, 8), 2.4, 2.65);
    expect(pieces).toHaveLength(1);
    const [p] = pieces;
    expect(p.eaves).toEqual({ minX: true, maxX: true, minY: false, maxY: true });
    // Out past the outside faces, but not into the floor above.
    expect(p.rect).toEqual({ minX: -ROOF_OVERHANG, maxX: 10 + ROOF_OVERHANG, minY: 8, maxY: 12 + ROOF_OVERHANG });
    expect(roofHeight(p, 5, 8)).toBeGreaterThan(roofHeight(p, 5, 11));
    expect(roofTop(pieces)).toBeLessThanOrEqual(2.65 + 0.75 + 1e-9);
    // A floor above covering the whole of the one below leaves nothing to roof.
    expect(leanToRoof(rectRing(10, 8), rectRing(10, 8), 2.4, 2.65)).toEqual([]);
  });

  it("puts a hipped roof on the house model in place of the flat slab and parapets", () => {
    const options: HouseModelOptions = { cutaway: false, roof: true, dimensions: false, landscape: false, furniture: false };
    const lvl = level(newOutlineHouse(OUTLINES.U));
    const flat = buildHouseModel(lvl, options);
    expect(flat.roofs).toBeUndefined();
    expect(flat.boxes.some((b) => b.kind === "parapet")).toBe(true);
    const hipped = buildHouseModel(lvl, { ...options, roofForm: "hipped" });
    expect(hipped.boxes.some((b) => b.kind === "roof" || b.kind === "parapet")).toBe(false);
    expect(hipped.roofs).toHaveLength(3);
    expect(hipped.top).toBeGreaterThan(hipped.wallHeight + 2);
    // No roof in a cutaway, whatever its shape.
    expect(buildHouseModel(lvl, { ...options, roofForm: "hipped", cutaway: true }).roofs).toBeUndefined();
    // A house of one floor is the same model either way.
    expect(buildBuildingModel({ schemaVersion: 6, id: "d", name: "d", units: "m", levels: [lvl] }, { ...options, roofForm: "hipped" }).roofs).toHaveLength(3);
  });

  it("gables a rectangle along its length, with eaves on the long sides and flush gable ends", () => {
    const pieces = gabledRoof(rectRing(10, 8), 2.4);
    expect(pieces).toHaveLength(1);
    const [p] = pieces;
    expect(p.gable).toBe(true);
    expect(p.eaves).toEqual({ minX: false, maxX: false, minY: true, maxY: true });
    // Eaves stand out on the long sides; the gable ends are flush with the walls.
    expect(p.rect).toEqual({ minX: 0, maxX: 10, minY: -ROOF_OVERHANG, maxY: 8 + ROOF_OVERHANG });
    // The ridge runs the full length at half the span up.
    expect(roofTop(pieces)).toBeCloseTo(2.4 + ROOF_FASCIA + SLOPE * (4 + ROOF_OVERHANG), 9);
    expect(roofHeight(p, 0, 4)).toBeCloseTo(roofTop(pieces), 9);
    // A deep house runs its ridge front to back.
    expect(gabledRoof(rectRing(8, 12), 0)[0].eaves).toEqual({ minX: true, maxX: true, minY: false, maxY: false });
  });

  it("draws gable ends as upright wall triangles, apart from the roof's own faces", () => {
    const surfaces = roofSurfaces(gabledRoof(rectRing(10, 8), 0));
    expect(surfaces.ends).toEqual([]);
    // One triangle (or a fan of them) at each end, all upright on x = 0 or x = 10.
    expect(surfaces.gables.length).toBeGreaterThanOrEqual(2);
    for (const tri of surfaces.gables) {
      const x = tri[0].x;
      expect(x === 0 || x === 10).toBe(true);
      expect(tri.every((q) => q.x === x)).toBe(true);
    }
    // Wings of an L, T or U each get a gabled roof; the closed solids still hold.
    for (const ring of Object.values(OUTLINES)) {
      for (const piece of gabledRoof(ring, 0)) expect(volume(roofTriangles(piece))).toBeGreaterThan(0);
    }
  });

  it("puts a gabled roof on the house model", () => {
    const options: HouseModelOptions = { cutaway: false, roof: true, dimensions: false, landscape: false, furniture: false, roofForm: "gabled" };
    const lvl = level(newOutlineHouse(OUTLINES.L));
    const gabled = buildHouseModel(lvl, options);
    expect(gabled.roofs?.every((p) => p.gable)).toBe(true);
    expect(gabled.boxes.some((b) => b.kind === "parapet")).toBe(false);
    expect(buildBuildingModel({ schemaVersion: 6, id: "d", name: "d", units: "m", levels: [lvl] }, options).roofs?.length).toBe(gabled.roofs?.length);
  });

  it("merges faces whose outlines carry float noise from the overhang, without failing", () => {
    // An L whose wing edge came out of the offset as 5.199999999999999: the union used to throw and take the editor down.
    const all = { minX: true, maxX: true, minY: true, maxY: true };
    const pieces: RoofPiece[] = [
      { minX: -0.4, maxX: 9.9, minY: -0.4, maxY: 10.4 },
      { minX: 5.199999999999999, maxX: 9.9, minY: -0.4, maxY: 15.4 },
    ].map((rect) => ({ rect, z0: 2.4, skirt: ROOF_FASCIA, slope: SLOPE, eaves: all }));
    const surfaces = roofSurfaces(pieces);
    // Every face merged: the shared eave planes come out as one shape each, not overlapping pairs.
    for (const slope of surfaces.slopes) expect(slope.polygons.length).toBe(1);
    expect(multiPolygonArea(surfaces.soffits[0].polygons)).toBeCloseTo(10.3 * 10.8 + 4.7 * 5, 3);
  });
});

