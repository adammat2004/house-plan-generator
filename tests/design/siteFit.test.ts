import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF, type HouseBrief } from "@/domain/brief/schema";
import type { PlanningResult } from "@/domain/design/planner";
import { planLayouts } from "@/domain/design/stripPlanner";
import { DEFAULT_SETBACKS, generationPlot, type Site } from "@/domain/project/site";
import { contains, placeRing, rectRing } from "@/domain/site/buildable";
import { fitToSite, houseRing, NOTHING_FITS_ON_SITE, placeOwnHouse, siteAnchor, tracedSite, type SiteFit } from "@/domain/site/fit";
import { fromGrid } from "@/domain/site/geo";
import { newHouse } from "../helpers";

const ORIGIN = { x: 530000, y: 725000 };
const at = (x: number, y: number) => fromGrid({ x: ORIGIN.x + x, y: ORIGIN.y + y }, "EPSG:2157");
const tracedRect = (w: number, d: number, plot?: Site["plot"]): Site => ({
  setbacks: DEFAULT_SETBACKS,
  ...(plot ? { plot } : {}),
  traced: { boundary: [at(0, 0), at(w, 0), at(w, d), at(0, d)], exportGrid: "EPSG:2157", edges: [{ road: true }] },
});
const box = (w: number, d: number): SiteFit => {
  const ring = rectRing({ minX: 0, maxX: w, minY: 0, maxY: d });
  return { area: [{ outer: ring, holes: [] }], rect: { minX: 0, maxX: w, minY: 0, maxY: d } };
};

function auto(brief: HouseBrief, plot: { maxWidth: number; maxDepth: number }, count: number, site?: SiteFit): PlanningResult {
  return planLayouts({ intent: { action: "generate_layouts", brief, count, footprint: "auto", plot }, source: newHouse(), brief, idPrefix: "a", ...(site ? { site } : {}) });
}
const depthOf = (c: PlanningResult["candidates"][number]) => {
  const ys = houseRing(c.document)!.map((p) => p.y);
  return Math.max(...ys) - Math.min(...ys);
};

describe("layouts on a traced site", () => {
  it("are sized from the traced site, not a plot typed earlier", () => {
    // 30 × 50 m, road to the south: 28 × 33 m between the gaps, less the 2 m band each side.
    const plot = generationPlot({ site: tracedRect(30, 50, { width: 15, depth: 35 }) })!;
    expect(plot.maxWidth).toBeGreaterThanOrEqual(23.5);
    expect(plot.maxDepth).toBeGreaterThanOrEqual(28.5);
  });

  it("are limited to the least the planners take when the gaps leave no room", () => {
    expect(tracedSite(tracedRect(10, 12))!.limits).toBeNull();
    expect(generationPlot({ site: tracedRect(10, 12) })).toEqual({ maxWidth: 4, maxDepth: 4 });
  });

  it("only include houses that fit somewhere on the site, and still as many as asked for", () => {
    const plot = { maxWidth: 16, maxDepth: 14 };
    // Without the site, some layouts are deeper than the 12 m the site leaves.
    expect(auto(DEFAULT_BRIEF, plot, 6).candidates.some((c) => depthOf(c) > 12)).toBe(true);
    const site = box(13, 12);
    const result = auto(DEFAULT_BRIEF, plot, 3, site);
    expect(result.candidates).toHaveLength(3);
    for (const c of result.candidates) {
      expect(c.placement).toBeDefined();
      expect(contains(site.area, placeRing(houseRing(c.document)!, c.placement!))).toBe(true);
    }
  });

  it("says plainly when no layout fits on the site", () => {
    const result = auto(DEFAULT_BRIEF, { maxWidth: 16, maxDepth: 14 }, 3, box(6, 6));
    expect(result.candidates).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: "does-not-fit", message: NOTHING_FITS_ON_SITE });
  });

  it("does the same for two-storey houses", () => {
    const brief: HouseBrief = { ...DEFAULT_BRIEF, storeys: 2 };
    const site = box(14, 12);
    const result = auto(brief, { maxWidth: 14, maxDepth: 12 }, 2, site);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) expect(contains(site.area, placeRing(houseRing(c.document)!, c.placement!))).toBe(true);
  });

  it("leaves layouts as they were without a traced site", () => {
    const plain = auto(DEFAULT_BRIEF, { maxWidth: 16, maxDepth: 14 }, 3);
    expect(plain.candidates.every((c) => c.placement === undefined)).toBe(true);
    expect(fitToSite(plain.candidates, undefined)).toEqual(plain.candidates);
  });

  it("keeps a house where the last one was when the new one fits there", () => {
    const site = { ...box(30, 30), previous: { x: 2, y: 3, rotation: 0 } };
    const [first] = auto(DEFAULT_BRIEF, { maxWidth: 16, maxDepth: 14 }, 1, site).candidates;
    expect(first.placement).toEqual({ x: 2, y: 3, rotation: 0 });
  });
});

describe("the user's own house on a traced site", () => {
  it("is placed where it fits and checked, never dropped or resized", () => {
    const summary = tracedSite(tracedRect(30, 50))!;
    const own = newHouse(12, 9);
    const placed = placeOwnHouse(summary, own)!;
    expect(placed).toMatchObject({ fits: true, crossed: [], outside: false });
    // Too wide for the site between its side gaps: still placed, with the gaps it crosses named.
    const wide = placeOwnHouse(summary, newHouse(29.5, 9))!;
    expect(wide.fits).toBe(false);
    expect(wide.crossed.map((e) => e.role).sort()).toEqual(["side", "side"]);
    expect(wide.outside).toBe(false);
  });
});

describe("the site anchor", () => {
  it("draws the buildable area and the room for a house back where the site actually is", () => {
    const site = tracedRect(30, 50);
    const summary = tracedSite(site)!;
    const anchor = siteAnchor(summary, "EPSG:2157");
    expect(anchor.buildable.length).toBeGreaterThan(0);
    expect(anchor.house).not.toBeNull();
    expect(anchor.houseSize!.width).toBeGreaterThan(20);
    // Every anchor corner lands inside the traced boundary's lon/lat bounding box.
    const lons = site.traced!.boundary.map((p) => p[0]);
    const lats = site.traced!.boundary.map((p) => p[1]);
    for (const corner of anchor.house!) {
      expect(corner[0]).toBeGreaterThanOrEqual(Math.min(...lons) - 1e-6);
      expect(corner[0]).toBeLessThanOrEqual(Math.max(...lons) + 1e-6);
      expect(corner[1]).toBeGreaterThanOrEqual(Math.min(...lats) - 1e-6);
      expect(corner[1]).toBeLessThanOrEqual(Math.max(...lats) + 1e-6);
    }
  });
});
