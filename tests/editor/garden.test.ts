import { describe, expect, it } from "vitest";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { distanceToRing, intersection, multiPolygonArea, pointInPolygon, type MultiPolygon } from "@/domain/geometry/polygons";
import { buildGarden, GARDEN_MARGIN } from "@/editor/rendering/scene/garden";
import { apply, level, newHouse } from "../helpers";
import type { PlanDocument } from "@/domain/plan/types";

const sides = (doc: PlanDocument) => {
  const [south, east, north, west] = level(doc).envelope.wallIds;
  return { south, east, north, west };
};

const door = (doc: PlanDocument, id: string, wallId: string, offset: number, width = 0.9) =>
  apply(doc, { type: "addOpening", opening: { id, wallId, kind: "door", offset, width, height: 2.1, hinge: "start", swingSide: "left" } });

const overlap = (a: MultiPolygon, b: MultiPolygon) => a.reduce((sum, p) => sum + b.reduce((s, q) => s + multiPolygonArea(intersection(p, q)), 0), 0);

const bounds = (mp: MultiPolygon) => {
  const pts = mp.flatMap((p) => p.outer);
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
};

describe("the garden round the house", () => {
  const house = () => {
    let doc = newHouse(8, 10);
    const s = sides(doc);
    doc = door(doc, "front", s.south, 3.5);
    doc = door(doc, "garden", s.north, 2.5, 1.8);
    return doc;
  };

  it("fills the plot with lawn, never under the house, the terrace or the path", () => {
    const lvl = level(house());
    const g = buildGarden(lvl)!;
    const env = analyzeEnvelope(lvl);
    if (!env.ok) throw new Error("no outline");
    const housePoly = [{ outer: env.info.outsideRing, holes: [] }];
    expect(multiPolygonArea(g.lawn)).toBeGreaterThan(100);
    expect(overlap(g.lawn, housePoly)).toBeLessThan(1e-6);
    expect(overlap(g.lawn, g.terrace)).toBeLessThan(1e-6);
    expect(overlap(g.lawn, g.path)).toBeLessThan(1e-6);
    expect(overlap(g.lawn, g.apron)).toBeLessThan(1e-6);
    expect(overlap(g.terrace, housePoly)).toBeLessThan(1e-6);
    // The garden side is the deepest; the street side next.
    const r = env.info.outsideRect;
    expect(g.rear).toBe("north");
    expect(g.plot.maxY - r.maxY).toBeCloseTo(GARDEN_MARGIN.rear);
    expect(r.minY - g.plot.minY).toBeCloseTo(GARDEN_MARGIN.front);
  });

  it("lays the terrace on the garden side, across the garden doors", () => {
    const lvl = level(house());
    const g = buildGarden(lvl)!;
    const t = bounds(g.terrace);
    const env = analyzeEnvelope(lvl);
    if (!env.ok) throw new Error("no outline");
    expect(t.minY).toBeCloseTo(env.info.outsideRect.maxY);
    expect(t.maxY - t.minY).toBeCloseTo(3);
    // The doors run 2.5 to 4.3 m along the wall from its start; the terrace takes them in with room either side.
    const doorMid = (t.minX + t.maxX) / 2;
    expect(t.maxX - t.minX).toBeGreaterThanOrEqual(4);
    expect(Math.abs(doorMid - (env.info.outsideRect.minX + env.info.outsideRect.maxX) / 2)).toBeLessThan(4);
  });

  it("runs a path from the front door straight to the street, through a gap in the hedge", () => {
    const lvl = level(house());
    const g = buildGarden(lvl)!;
    const p = bounds(g.path);
    expect(p.maxX - p.minX).toBeCloseTo(1.2);
    expect(p.minY).toBeCloseTo(g.plot.minY);
    // Nothing of the hedge where the path meets the street.
    const gate = { x: (p.minX + p.maxX) / 2, y: g.plot.minY + 0.3 };
    expect(g.hedges.some((h) => pointInPolygon(h, gate))).toBe(false);
    expect(g.hedges.some((h) => pointInPolygon(h, { x: g.plot.minX + 0.3, y: g.plot.minY + 0.3 }))).toBe(true);
  });

  it("goes round the corner from a door in a side wall", () => {
    let doc = newHouse(8, 10);
    doc = door(doc, "side", sides(doc).east, 4);
    const g = buildGarden(level(doc))!;
    const p = bounds(g.path);
    const env = analyzeEnvelope(level(doc));
    if (!env.ok) throw new Error("no outline");
    expect(p.minX).toBeGreaterThanOrEqual(env.info.outsideRect.maxX - 1e-6);
    expect(p.minY).toBeCloseTo(g.plot.minY);
  });

  it("turns with the garden side", () => {
    let doc = house();
    doc = apply(doc, { type: "setRearWall", wallId: sides(doc).south });
    const g = buildGarden(level(doc))!;
    expect(g.rear).toBe("south");
    const env = analyzeEnvelope(level(doc));
    if (!env.ok) throw new Error("no outline");
    expect(env.info.outsideRect.minY - g.plot.minY).toBeCloseTo(GARDEN_MARGIN.rear);
    // The terrace follows the garden doors on the new garden side: there are none there now, so it sits mid-wall.
    expect(bounds(g.terrace).maxY).toBeCloseTo(env.info.outsideRect.minY);
  });

  it("plants trees on the lawn, clear of the house and of each other, in the same places every time", () => {
    const lvl = level(house());
    const g = buildGarden(lvl)!;
    const env = analyzeEnvelope(lvl);
    if (!env.ok) throw new Error("no outline");
    expect(g.trees.length).toBeGreaterThan(4);
    for (const t of g.trees) {
      expect(g.lawn.some((p) => pointInPolygon(p, t))).toBe(true);
      expect(distanceToRing(env.info.outsideRing, t)).toBeGreaterThan(t.r + 2);
      for (const o of g.trees) if (o !== t) expect(Math.hypot(o.x - t.x, o.y - t.y)).toBeGreaterThan((o.r + t.r) * 0.8);
    }
    // A fresh copy of the same house grows the same garden.
    expect(buildGarden(level(house()))!.trees).toEqual(g.trees);
    expect(buildGarden(lvl)).toBe(g);
  });
});
