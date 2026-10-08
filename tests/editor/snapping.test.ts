import { describe, expect, it } from "vitest";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { hitTest } from "@/editor/tools/hitTest";
import { SNAP_RADIUS_PX } from "@/editor/tools/controller";
import { snapPoint } from "@/editor/tools/snapping";
import { DEFAULT_VIEWPORT, fitRect, pixelsToMetres, screenToWorld, worldToScreen, zoomAt, panBy } from "@/editor/viewport/viewport";
import { AXIS, addWall, level, newHouse } from "../helpers";

const doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
const lvl = level(doc);
const geometry = deriveLevelGeometry(lvl);

describe("viewport", () => {
  it("round-trips world and screen coordinates with Y flipped", () => {
    const v = { ...DEFAULT_VIEWPORT, scale: 50, offsetX: 100, offsetY: 600 };
    expect(worldToScreen(v, { x: 2, y: 3 })).toEqual({ x: 200, y: 450 });
    expect(screenToWorld(v, { x: 200, y: 450 })).toEqual({ x: 2, y: 3 });
  });

  it("zooms around the cursor without moving the point under it", () => {
    const v = DEFAULT_VIEWPORT;
    const anchor = { x: 321, y: 234 };
    const before = screenToWorld(v, anchor);
    const zoomed = zoomAt(v, anchor, 2.5);
    const after = screenToWorld(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("never changes document coordinates when panning or zooming", () => {
    const snapshot = JSON.stringify(doc);
    let v = fitRect({ ...DEFAULT_VIEWPORT, width: 1200, height: 800 }, { minX: 0, minY: 0, maxX: 8, maxY: 10 });
    v = zoomAt(panBy(v, 40, -20), { x: 10, y: 10 }, 3);
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(v.scale).toBeGreaterThan(0);
  });
});

describe("snapping", () => {
  const radiusAt = (scale: number) => pixelsToMetres({ ...DEFAULT_VIEWPORT, scale }, SNAP_RADIUS_PX);

  it("prefers endpoints and junctions over walls and grid", () => {
    const r = radiusAt(60);
    const near = { x: 4 + r * 0.5, y: AXIS.north - r * 0.4 };
    const result = snapPoint(lvl, geometry, near, { radius: r, grid: 0.1 });
    expect(result.point).toEqual({ x: 4, y: AXIS.north });
    expect(["endpoint", "junction"]).toContain(result.kind);
  });

  it("projects onto a wall axis before falling back to the grid", () => {
    const r = radiusAt(60);
    const result = snapPoint(lvl, geometry, { x: 4.06, y: 3.43 }, { radius: r, grid: 0.1 });
    expect(result.kind).toBe("wall");
    expect(result.point).toEqual({ x: 4, y: 3.4 });
    const grid = snapPoint(lvl, geometry, { x: 2.04, y: 3.43 }, { radius: r, grid: 0.1 });
    expect(grid).toEqual({ point: { x: 2, y: 3.4 }, kind: "grid" });
  });

  it("acquires targets within the same screen distance at every zoom level", () => {
    for (const scale of [15, 60, 240, 900]) {
      const v = { ...DEFAULT_VIEWPORT, scale };
      const r = pixelsToMetres(v, SNAP_RADIUS_PX);
      const vertex = { x: 4, y: AXIS.north };
      const inside = { x: vertex.x + pixelsToMetres(v, 6), y: vertex.y };
      const outside = { x: vertex.x + pixelsToMetres(v, 11), y: vertex.y - pixelsToMetres(v, 11) };
      expect(snapPoint(lvl, geometry, inside, { radius: r, grid: null }).point).toEqual(vertex);
      expect(snapPoint(lvl, geometry, outside, { radius: r, grid: null }).kind).not.toMatch(/endpoint|junction/);
    }
  });

  it("constrains wall drawing to orthogonal lines and snaps onto crossing walls", () => {
    const r = radiusAt(60);
    const result = snapPoint(lvl, geometry, { x: 3.95, y: 5.3 }, { radius: r, grid: 0.1, from: { x: 1, y: 5 } });
    expect(result.point).toEqual({ x: 4, y: 5 });
    expect(result.kind).toBe("wall");
    const vertical = snapPoint(lvl, geometry, { x: 1.2, y: 7.04 }, { radius: r, grid: 0.1, from: { x: 1, y: 5 } });
    expect(vertical.point).toEqual({ x: 1, y: 7 });
  });
});

describe("hit testing", () => {
  it("picks walls, then rooms, by world position", () => {
    const tol = pixelsToMetres(DEFAULT_VIEWPORT, SNAP_RADIUS_PX);
    expect(hitTest(lvl, geometry, { x: 4.02, y: 5 }, tol)).toEqual({ kind: "wall", id: "v" });
    expect(hitTest(lvl, geometry, { x: 2, y: 5 }, tol)?.kind).toBe("room");
    expect(hitTest(lvl, geometry, { x: 20, y: 20 }, tol)).toBeNull();
  });
});
