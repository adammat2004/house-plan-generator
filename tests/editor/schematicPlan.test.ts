import { describe, expect, it } from "vitest";
import type { MultiPolygon } from "@/domain/geometry/polygons";
import { buildGarden } from "@/editor/rendering/scene/garden";
import { buildFacePills, type PlanScene } from "@/editor/rendering/scene/planScene";
import { labelsClear, type StairPrimitive } from "@/editor/rendering/scene/stairScene";
import { OUTLINES } from "../fixtures/outlines";
import { level, newHouse, newOutlineHouse } from "../helpers";

/*
 * The schematic plan (2D Plan view): sizes on a pill on every outside face,
 * room names kept clear of stairs and door swings, and a made-up garden that
 * fades out rather than stopping at a hedge.
 */

const rect = (minX: number, minY: number, maxX: number, maxY: number): MultiPolygon => [
  {
    outer: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    holes: [],
  },
];

/** A scene with one room and the given doors, as labelsClear reads it. */
function sceneWith(room: { minX: number; minY: number; maxX: number; maxY: number; label: { x: number; y: number } }, doors: Array<{ leaf: [{ x: number; y: number }, { x: number; y: number }]; arc: Array<{ x: number; y: number }> }>): PlanScene {
  return {
    rooms: [{ id: "r", name: "Ensuite", type: "ensuite", clear: rect(room.minX, room.minY, room.maxX, room.maxY), bounds: room, label: room.label }],
    openings: doors.map((d, i) => ({ id: `d${i}`, kind: "door", wallId: "w", cut: [], jambs: [], ...d })),
  } as unknown as PlanScene;
}

const NONE: StairPrimitive[] = [];

describe("sizes on the outside faces", () => {
  it("puts one pill on each face of a rectangle, in metres to the centimetre", () => {
    const pills = buildFacePills(level(newHouse(8, 10)));
    expect(pills.map((p) => p.text).sort()).toEqual(["10.00 m", "10.00 m", "8.00 m", "8.00 m"]);
  });

  it("measures every face of an L", () => {
    expect(buildFacePills(level(newOutlineHouse(OUTLINES.L)))).toHaveLength(6);
  });
});

describe("room names keep clear of door swings", () => {
  const box = { minX: 0, minY: 0, maxX: 3, maxY: 1.6 };
  // A door at the room's west end, swinging in: its leaf and quarter arc fill the first 0.9 m.
  const door = { leaf: [{ x: 0.05, y: 0.1 }, { x: 0.05, y: 1.0 }] as [{ x: number; y: number }, { x: number; y: number }], arc: [{ x: 0.05, y: 1.0 }, { x: 0.7, y: 0.75 }, { x: 0.95, y: 0.1 }] };

  it("moves a name off a swing it would sit on, into the clear part of the room", () => {
    const scene = sceneWith({ ...box, label: { x: 1.2, y: 0.8 } }, [door]);
    const moved = labelsClear(scene, NONE).rooms[0].label;
    expect(moved.x).toBeGreaterThan(1.5);
  });

  it("leaves the scene alone when no name is near a door or stairs", () => {
    const scene = sceneWith({ ...box, maxX: 6, label: { x: 4.5, y: 0.8 } }, [door]);
    expect(labelsClear(scene, NONE)).toBe(scene);
  });

  it("ignores sliding doors and windows, which sweep nothing", () => {
    const scene = sceneWith({ ...box, label: { x: 1.2, y: 0.8 } }, []);
    expect(labelsClear(scene, NONE)).toBe(scene);
  });
});

describe("a garden made up round the house", () => {
  it("has no hedge of its own and lets the lawn run to the plot's edge", () => {
    const g = buildGarden(level(newHouse(8, 10)))!;
    expect(g.fromSite).toBe(false);
    const edge = (mp: MultiPolygon) => Math.min(...mp.flatMap((p) => p.outer.map((q) => q.x)));
    expect(edge(g.lawnToEdge)).toBeCloseTo(g.plot.minX, 6);
    expect(edge(g.lawn)).toBeGreaterThan(g.plot.minX);
  });

  it("keeps a site's own boundary as a hedge", () => {
    const g = buildGarden(level(newHouse(8, 10)), { plot: { width: 14, depth: 30 }, setbacks: { front: 6, side: 1, rear: 11 } })!;
    expect(g.fromSite).toBe(true);
    expect(g.lawnToEdge).toBe(g.lawn);
  });
});
