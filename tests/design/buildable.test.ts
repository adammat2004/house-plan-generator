import { describe, expect, it } from "vitest";
import { multiPolygonArea } from "@/domain/geometry/polygons";
import { DEFAULT_SETBACKS, type SiteEdge, type TracedSite } from "@/domain/project/site";
import { buildableArea, centredOn, contains, crossedEdges, largestRect, placeHouse, placeRing, plotLimits, rectRing, siteFrame, toFrame } from "@/domain/site/buildable";
import { fromGrid, toGrid } from "@/domain/site/geo";

// A field near Galway; corners given in metres east and north of it.
const ORIGIN = { x: 530000, y: 725000 };
const at = (x: number, y: number) => fromGrid({ x: ORIGIN.x + x, y: ORIGIN.y + y }, "EPSG:2157");
const traced = (corners: [number, number][], edges: SiteEdge[] = [], extra: Partial<TracedSite> = {}): TracedSite => ({
  boundary: corners.map(([x, y]) => at(x, y)),
  exportGrid: "EPSG:2157",
  edges,
  ...extra,
});
const close = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

// 30 m along the road (south), 50 m deep; edges: 0 south, 1 east, 2 north, 3 west.
const RECT: [number, number][] = [[0, 0], [30, 0], [30, 50], [0, 50]];

describe("a traced site", () => {
  it("makes the road edges the front, the edge facing away the rear and the rest sides", () => {
    const f = siteFrame(traced(RECT, [{ road: true }]), DEFAULT_SETBACKS);
    expect(f.edges.map((e) => e.role)).toEqual(["front", "side", "rear", "side"]);
    expect(f.hasRoad).toBe(true);
    expect(close(f.rotation % 360, 0, 1e-6) || close(f.rotation, 360, 1e-6)).toBe(true);
  });

  it("turns a site whose road is to the north so the road faces south, and says where north is", () => {
    const f = siteFrame(traced(RECT, [{}, {}, { road: true }]), DEFAULT_SETBACKS);
    expect(close(f.rotation, 180, 1e-6)).toBe(true);
    expect(f.north).toBeCloseTo(180, 6);
    expect(f.edges[2].normal.y).toBeCloseTo(-1, 6);
    expect(f.edges[0].role).toBe("rear");
  });

  it("isn't turned and has no front until the road is marked", () => {
    const f = siteFrame(traced(RECT), DEFAULT_SETBACKS);
    expect(f.hasRoad).toBe(false);
    expect(f.rotation).toBe(0);
    expect(f.north).toBe(0);
    expect(f.edges.every((e) => e.role === "side")).toBe(true);
  });

  it("gives a corner site two fronts and takes the rear from the edge facing most nearly away", () => {
    const f = siteFrame(traced(RECT, [{ road: true }, { road: true }]), DEFAULT_SETBACKS);
    expect(f.edges.map((e) => e.role)).toEqual(["front", "front", "side", "rear"]);
  });

  it("makes a lane site's access edge the front", () => {
    // Pentagon reached by a lane along its west edge (edge 4).
    const f = siteFrame(traced([[0, 0], [40, 0], [45, 30], [20, 45], [0, 30]], [{}, {}, {}, {}, { road: true }]), DEFAULT_SETBACKS);
    expect(f.edges[4].role).toBe("front");
    expect(f.edges.filter((e) => e.role === "rear")).toHaveLength(1);
    expect(f.edges[4].normal.y).toBeCloseTo(-1, 6);
  });

  it("lets a user's role and gap win, and says where every gap came from", () => {
    const f = siteFrame(traced(RECT, [{ road: true }, { role: "rear" }, { setback: 3 }]), DEFAULT_SETBACKS, { front: 10 });
    expect(f.edges[1]).toMatchObject({ role: "rear", roleSource: "user", setback: 11, setbackSource: "default" });
    expect(f.edges[0]).toMatchObject({ role: "front", setback: 10, setbackSource: "pack" });
    expect(f.edges[2]).toMatchObject({ setback: 3, setbackSource: "user" });
    expect(f.edges[3]).toMatchObject({ role: "side", setback: 1, setbackSource: "default" });
  });

  it("puts traced points such as the entrance in the same frame as the boundary", () => {
    const site = traced(RECT, [{}, {}, { road: true }]);
    const f = siteFrame(site, DEFAULT_SETBACKS);
    const corner = toFrame(f, toGrid(site.boundary[2], "EPSG:2157"));
    expect(corner.x).toBeCloseTo(f.ring[2].x, 6);
    expect(corner.y).toBeCloseTo(f.ring[2].y, 6);
  });
});

describe("the buildable area", () => {
  it("is the site less each edge's gap", () => {
    const f = siteFrame(traced(RECT, [{ road: true }]), DEFAULT_SETBACKS);
    const area = buildableArea(f);
    // 30 − 2 × 1 wide, 50 − 6 − 11 deep.
    expect(multiPolygonArea(area)).toBeCloseTo(28 * 33, 0);
    const rect = largestRect(area)!;
    expect(rect.maxX - rect.minX).toBeGreaterThanOrEqual(27.5);
    expect(rect.maxY - rect.minY).toBeGreaterThanOrEqual(32.5);
    expect(contains(area, rectRing(rect))).toBe(true);
  });

  it("gives the planners the largest rectangle less the check band, so a house sized to fit isn't on the line", () => {
    const f = siteFrame(traced(RECT, [{ road: true }]), DEFAULT_SETBACKS);
    const limits = plotLimits(largestRect(buildableArea(f), 0.5)!, 2);
    // 28 × 33 less 2 m each side, to within one 0.5 m step (the gaps' round corners are drawn a little generously).
    expect(limits.maxWidth!).toBeGreaterThanOrEqual(23.5);
    expect(limits.maxWidth!).toBeLessThanOrEqual(24);
    expect(limits.maxDepth!).toBeGreaterThanOrEqual(28.5);
    expect(limits.maxDepth!).toBeLessThanOrEqual(29);
  });

  it("cuts out the wastewater area with its distance, and can split the site", () => {
    const f = siteFrame(traced([[0, 0], [60, 0], [60, 40], [0, 40]], [{ road: true }]), DEFAULT_SETBACKS);
    const plain = buildableArea(f);
    // A treatment area across the middle, 10 m clear all round.
    const split = buildableArea(f, [{ ring: rectRing({ minX: 25, maxX: 30, minY: -5, maxY: 45 }), distance: 10 }]);
    expect(split).toHaveLength(2);
    expect(multiPolygonArea(split)).toBeLessThan(multiPolygonArea(plain));
    const rect = largestRect(split)!;
    expect(contains(split, rectRing(rect))).toBe(true);
    // The larger piece is the east one (40 − 1 − 10 wide against 25 − 1 − 10).
    expect(rect.minX).toBeGreaterThan(30);
  });

  it("finds a rectangle that really fits an L-shaped site", () => {
    const f = siteFrame(traced([[0, 0], [40, 0], [40, 20], [20, 20], [20, 50], [0, 50]], [{ road: true }]), DEFAULT_SETBACKS);
    const area = buildableArea(f);
    const rect = largestRect(area)!;
    expect(contains(area, rectRing(rect))).toBe(true);
    expect((rect.maxX - rect.minX) * (rect.maxY - rect.minY)).toBeGreaterThan(400);
  });

  it("is empty when the gaps take the whole site", () => {
    const f = siteFrame(traced([[0, 0], [10, 0], [10, 12], [0, 12]], [{ road: true }]), DEFAULT_SETBACKS);
    expect(buildableArea(f)).toEqual([]);
    expect(largestRect([])).toBeNull();
  });
});

describe("the house on the site", () => {
  const f = siteFrame(traced(RECT, [{ road: true }]), DEFAULT_SETBACKS);
  const area = buildableArea(f);
  const house = rectRing({ minX: 0, maxX: 12, minY: 0, maxY: 9 });

  it("is centred on the largest rectangle", () => {
    const placed = placeHouse(area, house)!;
    expect(placed.how).toBe("centred");
    expect(contains(area, placeRing(house, placed.placement))).toBe(true);
  });

  it("stays where the last one was if it fits there, else is centred", () => {
    const corner = { x: 1.5, y: 6.5, rotation: 0 };
    expect(placeHouse(area, house, corner)).toEqual({ placement: corner, how: "kept" });
    const tooFar = { x: 25, y: 6.5, rotation: 0 };
    expect(placeHouse(area, house, tooFar)!.how).toBe("centred");
  });

  it("takes the nearest spot that fits when the centre doesn't", () => {
    const lop = siteFrame(traced([[0, 0], [60, 0], [60, 40], [0, 40]], [{ road: true }]), DEFAULT_SETBACKS);
    const split = buildableArea(lop, [{ ring: rectRing({ minX: 25, maxX: 30, minY: -5, maxY: 45 }), distance: 10 }]);
    const wide = rectRing({ minX: 0, maxX: 14, minY: 0, maxY: 8 });
    const placed = placeHouse(split, wide, undefined, { minX: 0, maxX: 60, minY: 0, maxY: 40 })!;
    expect(placed.how).toBe("moved");
    expect(contains(split, placeRing(wide, placed.placement))).toBe(true);
  });

  it("fits nowhere when it's too big", () => {
    expect(placeHouse(area, rectRing({ minX: 0, maxX: 40, minY: 0, maxY: 9 }))).toBeNull();
  });

  it("names the gap a house is dragged into", () => {
    const tooNearTheRoad = placeRing(house, centredOn(house, { x: 15, y: 6 }));
    expect(crossedEdges(f, tooNearTheRoad).map((e) => e.role)).toEqual(["front"]);
    expect(crossedEdges(f, placeRing(house, placeHouse(area, house)!.placement))).toEqual([]);
  });
});
