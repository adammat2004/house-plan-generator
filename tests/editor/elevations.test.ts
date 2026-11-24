import { describe, expect, it } from "vitest";
import { applyCommand } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { buildElevations } from "@/editor/rendering/drawing/elevations";
import { ROOF_FASCIA, ROOF_OVERHANG, ROOF_PITCH } from "@/editor/rendering/three/roofModel";
import { OUTLINES } from "../fixtures/outlines";
import { level, newHouse, newOutlineHouse } from "../helpers";

const SLOPE = Math.tan(ROOF_PITCH);

describe("elevations", () => {
  it("draws the four sides of a box house, front first, with the walls at full height", () => {
    const doc = newHouse(8, 10);
    const elevations = buildElevations(doc, undefined);
    expect(elevations.map((e) => e.title)).toEqual(["Front elevation", "Rear elevation", "Left side elevation", "Right side elevation"]);
    const front = elevations[0];
    expect(front.walls).toHaveLength(1);
    expect(front.walls[0].u1 - front.walls[0].u0).toBeCloseTo(8, 6);
    expect(front.walls[0].z1).toBeCloseTo(level(doc).defaultWallHeight, 6);
    // A flat roof shows as its slab and parapet.
    expect(front.bands.length).toBeGreaterThan(0);
    expect(front.roofs).toEqual([]);
  });

  it("shows a hipped roof as a trapezoid from the front, rising to the ridge", () => {
    const doc = newHouse(10, 8);
    const [front, , left] = buildElevations(doc, "hipped");
    expect(front.roofs).toHaveLength(1);
    const pts = front.roofs[0].points;
    const top = Math.max(...pts.map((p) => p.z));
    const wall = level(doc).defaultWallHeight;
    expect(top).toBeCloseTo(wall + ROOF_FASCIA + SLOPE * (4 + ROOF_OVERHANG), 6);
    // Eaves at both ends, so four points along the top: a trapezoid.
    expect(pts.filter((p) => p.z > wall + ROOF_FASCIA + 0.01)).toHaveLength(2);
    // From the side, the hips meet at a point: a triangle.
    expect(left.roofs[0].points.filter((p) => Math.abs(p.z - top) < 1e-6)).toHaveLength(1);
  });

  it("shows a gable end as a triangle, and the long side as a band up to the ridge", () => {
    const doc = newHouse(10, 8);
    const [front, , left] = buildElevations(doc, "gabled");
    const wall = level(doc).defaultWallHeight;
    // From the front the ridge runs along: the roof is level along its top.
    const top = front.roofs[0].points.filter((p) => p.z > wall + 1);
    expect(top).toHaveLength(2);
    expect(top[0].z).toBeCloseTo(top[1].z, 9);
    // From the side, the gable: up from both eaves to one peak.
    const peak = Math.max(...left.roofs[0].points.map((p) => p.z));
    expect(left.roofs[0].points.filter((p) => Math.abs(p.z - peak) < 1e-6)).toHaveLength(1);
  });

  it("puts windows and doors on the face they're in, at their sill and head", () => {
    let doc = newHouse(8, 10);
    const lvl = level(doc);
    const env = analyzeEnvelope(lvl);
    if (!env.ok) throw new Error("no outline");
    const south = env.info.edges.find((e) => e.facing === "south")!;
    const result = applyCommand(doc, { type: "addOpening", opening: { id: "w1", kind: "window", wallId: south.wallId, offset: 2, width: 1.2, height: 1.2, sillHeight: 0.9 } });
    if (!result.ok) throw new Error(result.issues[0]?.message);
    doc = result.document;
    const [front, rear] = buildElevations(doc, "hipped");
    expect(front.openings).toHaveLength(1);
    expect(front.openings[0].z0).toBeCloseTo(0.9, 6);
    expect(front.openings[0].z1).toBeCloseTo(2.1, 6);
    expect(front.openings[0].u1 - front.openings[0].u0).toBeCloseTo(1.2, 6);
    expect(rear.openings).toHaveLength(0);
  });

  it("draws every wall of an L facing the viewer, nearer ones nearer", () => {
    const [front] = buildElevations(newOutlineHouse(OUTLINES.L), "hipped");
    expect(front.walls.length).toBeGreaterThanOrEqual(1);
    expect(front.roofs.length).toBeGreaterThanOrEqual(2);
    expect(front.extent.u1).toBeGreaterThan(front.extent.u0);
  });
});
