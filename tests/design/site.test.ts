import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { projectFromRooms } from "@/domain/project/fromRooms";
import { loadProjectDocument, projectFromPlan } from "@/domain/project/schema";
import {
  bearingWord,
  buildableLimits,
  buildableRect,
  DEFAULT_SETBACKS,
  facing,
  generationPlot,
  parseSiteLength,
  siteFromLimits,
  siteIssues,
  sitePlot,
  turnNorth,
  type Site,
} from "@/domain/project/site";
import { projectFromSnapshot, snapshotOf } from "@/domain/project/startLink";
import { buildGarden } from "@/editor/rendering/scene/garden";
import { apply, level, newHouse } from "../helpers";

const site = (over: Partial<Site> = {}): Site => ({ plot: { width: 15, depth: 35 }, setbacks: { front: 6, side: 1, rear: 11 }, ...over });
const house = { minX: 0, minY: 0, maxX: 8, maxY: 10 };

describe("the site", () => {
  it("leaves the plot less its gaps for the house, and nothing for a side it isn't told", () => {
    expect(buildableLimits(site())).toEqual({ maxWidth: 13, maxDepth: 18 });
    expect(buildableLimits(site({ plot: { width: 12 } }))).toEqual({ maxWidth: 10 });
    expect(buildableLimits(site({ plot: undefined }))).toBeUndefined();
    // No room left still limits, to the least planners take (no house fits), so nothing is planned there.
    expect(buildableLimits(site({ plot: { width: 6, depth: 6 } }))).toEqual({ maxWidth: 4, maxDepth: 4 });
    expect(buildableLimits(site({ plot: { width: 400, depth: 400 } }))).toEqual({ maxWidth: 200, maxDepth: 200 });
  });

  it("starts from the old house limits, leaving the house the same room, and is used for layouts once set", () => {
    const limits = { maxWidth: 10, maxDepth: 12 };
    const seeded = siteFromLimits(limits);
    expect(seeded.setbacks).toEqual(DEFAULT_SETBACKS);
    expect(buildableLimits(seeded)).toEqual(limits);
    expect(siteFromLimits(undefined).plot).toBeUndefined();
    expect(generationPlot({ sizing: { plot: limits } })).toEqual(limits);
    expect(generationPlot({ site: site(), sizing: { plot: limits } })).toEqual({ maxWidth: 13, maxDepth: 18 });
  });

  it("lays the plot round the house with its street edge opposite the garden, never turning the plan", () => {
    const north = sitePlot(house, "north", site())!;
    expect(north).toEqual({ minX: -3.5, maxX: 11.5, minY: -6, maxY: 29 });
    const east = sitePlot(house, "east", site())!;
    expect(east.minX).toBe(-6);
    expect(east.maxX - east.minX).toBe(35);
    expect(east.maxY - east.minY).toBe(15);
    const south = sitePlot(house, "south", site())!;
    expect(south.maxY).toBe(16);
    // The house sits inside what the gaps leave.
    for (const rear of ["north", "south", "east", "west"] as const) {
      const b = buildableRect(sitePlot(house, rear, site())!, rear, site().setbacks);
      expect(b.minX).toBeLessThanOrEqual(house.minX + 1e-9);
      expect(b.minY).toBeLessThanOrEqual(house.minY + 1e-9);
    }
    // A plot measured one way only takes the house and its gaps the other way.
    expect(sitePlot(house, "north", site({ plot: { width: 20 } }))!.maxY).toBe(10 + 11);
    expect(sitePlot(house, "north", site({ plot: undefined }))).toBeNull();
  });

  it("says plainly what doesn't fit", () => {
    expect(siteIssues(site(), { width: 8, depth: 10 })).toEqual([]);
    expect(siteIssues(site({ plot: { width: 9, depth: 35 } }), { width: 8, depth: 10 })).toEqual(["The house is 8 m wide; the plot leaves 7 m between the side gaps."]);
    expect(siteIssues(site({ plot: { width: 15, depth: 16 } }), null)).toEqual(["The front and back gardens take the plot's whole depth."]);
    expect(siteIssues(site({ plot: { width: 4.5, depth: 35 } }), null)).toEqual(["The side gaps leave only 2.5 m of the plot's width to build on."]);
  });

  it("knows which way the garden faces once north is set", () => {
    expect(facing("north", 0)).toBe("north");
    // North a quarter turn to the right of up: up the plan is west.
    expect(facing("north", 90)).toBe("west");
    expect(facing("east", 45)).toBe("north-east");
    expect(bearingWord(-10)).toBe("north");
    expect(turnNorth(undefined, -1)).toBe(345);
    expect(turnNorth(345, 2)).toBe(15);
  });

  it("reads lengths as typed", () => {
    expect(parseSiteLength("", 5, 200)).toBeUndefined();
    expect(parseSiteLength("12,5", 5, 200)).toBe(12.5);
    expect(parseSiteLength("3", 5, 200)).toBe("invalid");
    expect(parseSiteLength("0", 0, 60)).toBe(0);
  });

  it("is saved with the project and carried by a link to another computer", () => {
    const project = { ...projectFromPlan(newHouse(), { now: "n" }), site: site({ north: 30 }) };
    const loaded = loadProjectDocument(JSON.parse(JSON.stringify(project)), "n");
    expect(loaded.ok && loaded.project.site).toEqual(site({ north: 30 }));
    const bad = loadProjectDocument({ ...JSON.parse(JSON.stringify(project)), site: { setbacks: { front: -1, side: 1, rear: 1 } } }, "n");
    expect(bad.ok).toBe(false);

    const rooms = projectFromRooms(DEFAULT_BRIEF, { id: "p1", idPrefix: "g", now: "n", name: "Mine" });
    if (!rooms.ok) throw new Error(rooms.message);
    const withSite = { ...rooms.project, site: site() };
    const snapshot = snapshotOf(withSite, withSite.plans[1].id)!;
    expect(snapshot.site).toEqual(site());
    expect(projectFromSnapshot(snapshot, { id: "p2", idPrefix: "h", now: "n" })?.site).toEqual(site());
  });

  it("gives the garden the plot, though never less than the house", () => {
    const doc = apply(newHouse(8, 10), { type: "setRearWall", wallId: level(newHouse(8, 10)).envelope.wallIds[2] });
    const g = buildGarden(level(doc), site())!;
    expect(g.plot.maxY - g.plot.minY).toBeCloseTo(35);
    expect(g.plot.maxX - g.plot.minX).toBeCloseTo(15);
    const tight = buildGarden(level(doc), site({ plot: { width: 5, depth: 8 } }))!;
    expect(tight.plot.maxX - tight.plot.minX).toBeGreaterThan(8);
    // Without a plot, the usual margins.
    expect(buildGarden(level(doc))!.plot.maxY - buildGarden(level(doc))!.plot.minY).toBeCloseTo(10 + 9 + 5);
  });

  it("opens a project and a link saved before sites could be traced exactly as they were", () => {
    // Saved as before the change: no `traced`.
    const old = { ...projectFromPlan(newHouse(), { now: "n" }), site: { plot: { width: 15, depth: 35 }, setbacks: { front: 6, side: 1, rear: 11 }, north: 30 } };
    const loaded = loadProjectDocument(JSON.parse(JSON.stringify(old)), "n");
    expect(loaded.ok && loaded.project.site).toEqual(old.site);
    expect(loaded.ok && loaded.project.site && "traced" in loaded.project.site).toBe(false);
    // Layouts for it are sized exactly as before.
    expect(generationPlot({ site: old.site })).toEqual({ maxWidth: 13, maxDepth: 18 });

    const rooms = projectFromRooms(DEFAULT_BRIEF, { id: "p1", idPrefix: "g", now: "n", name: "Mine" });
    if (!rooms.ok) throw new Error(rooms.message);
    const withSite = { ...rooms.project, site: old.site };
    const snapshot = snapshotOf(withSite, withSite.plans[1].id)!;
    expect(projectFromSnapshot(JSON.parse(JSON.stringify(snapshot)), { id: "p2", idPrefix: "h", now: "n" })?.site).toEqual(old.site);
  });

  it("keeps a traced site through saving and a link, and refuses one that isn't a site", () => {
    const traced: Site = {
      ...site(),
      traced: {
        boundary: [[-9.06, 53.27], [-9.0596, 53.27], [-9.0596, 53.2705], [-9.06, 53.2705]],
        exportGrid: "EPSG:2157",
        edges: [{ road: true }, {}, { setback: 12 }, { role: "side" }],
        entrance: [-9.0598, 53.27],
        wastewater: [[-9.0599, 53.2703], [-9.0598, 53.2703], [-9.0598, 53.2704]],
        placement: { x: 4, y: 7, rotation: 0 },
      },
    };
    const project = { ...projectFromPlan(newHouse(), { now: "n" }), site: traced };
    const loaded = loadProjectDocument(JSON.parse(JSON.stringify(project)), "n");
    expect(loaded.ok && loaded.project.site).toEqual(traced);

    const rooms = projectFromRooms(DEFAULT_BRIEF, { id: "p1", idPrefix: "g", now: "n", name: "Mine" });
    if (!rooms.ok) throw new Error(rooms.message);
    const withSite = { ...rooms.project, site: traced };
    const snapshot = snapshotOf(withSite, withSite.plans[1].id)!;
    expect(projectFromSnapshot(JSON.parse(JSON.stringify(snapshot)), { id: "p2", idPrefix: "h", now: "n" })?.site).toEqual(traced);

    const twoCorners = { ...project, site: { ...traced, traced: { ...traced.traced!, boundary: traced.traced!.boundary.slice(0, 2) } } };
    expect(loadProjectDocument(JSON.parse(JSON.stringify(twoCorners)), "n").ok).toBe(false);
  });
});
