import { describe, expect, it } from "vitest";
import { deriveWallMass, deriveWallMassCut } from "@/domain/geometry/derive";
import { multiPolygonArea } from "@/domain/geometry/polygons";
import { buildPlanScene } from "@/editor/rendering/scene/planScene";
import { buildLargePlan } from "../fixtures/largePlan";
import { apply, AXIS, level, newHouse } from "../helpers";

describe("doors and windows cut out of the walls", () => {
  const house = () => {
    let doc = newHouse();
    doc = apply(doc, { type: "addWall", wallId: "v", start: { x: 3, y: AXIS.south }, end: { x: 3, y: AXIS.north }, thickness: 0.1, idPrefix: "v" });
    const north = level(doc).envelope.wallIds[2];
    doc = apply(doc, { type: "addOpening", opening: { id: "d1", wallId: "v", kind: "door", offset: 2, width: 0.9, height: 2.1, hinge: "start", swingSide: "left" } });
    doc = apply(doc, { type: "addOpening", opening: { id: "w1", wallId: north, kind: "window", offset: 3, width: 1.2, height: 1.2, sillHeight: 0.9 } });
    return doc;
  };

  it("takes each opening's own width out of its wall, and nothing else", () => {
    const lvl = level(house());
    const outside = level(house()).walls[level(house()).envelope.wallIds[2]].thickness;
    const removed = multiPolygonArea(deriveWallMass(lvl)) - multiPolygonArea(deriveWallMassCut(lvl));
    // A hair more than the wall's thickness is cut, so no sliver is left along either face.
    expect(removed).toBeCloseTo(0.9 * 0.1 + 1.2 * outside, 2);
  });

  it("is the plain wall mass when there are no openings, and cached per plan", () => {
    const plain = level(newHouse());
    expect(deriveWallMassCut(plain)).toBe(deriveWallMass(plain));
    const lvl = level(house());
    expect(deriveWallMassCut(lvl)).toBe(deriveWallMassCut(lvl));
  });

  it("knows the floor a doorway shows and which side a window's sill is on", () => {
    const lvl = level(house());
    const scene = buildPlanScene(lvl);
    const door = scene.openings.find((o) => o.id === "d1")!;
    const window = scene.openings.find((o) => o.id === "w1")!;
    expect(door.floorRoomId).toBeTruthy();
    expect(door.panel).toHaveLength(4);
    expect(window.sill).toHaveLength(4);
    // The sill stands outside the north wall.
    expect(Math.min(...window.sill!.map((p) => p.y))).toBeGreaterThan(AXIS.north);
  });

  it("slides wide outside doors instead of swinging them", () => {
    let doc = newHouse();
    const south = level(doc).envelope.wallIds[0];
    doc = apply(doc, { type: "addOpening", opening: { id: "g", wallId: south, kind: "door", offset: 2, width: 2.4, height: 2.1, hinge: "start", swingSide: "left" } });
    const door = buildPlanScene(level(doc)).openings[0];
    expect(door.sliders).toHaveLength(2);
    expect(door.arc).toBeUndefined();
  });

  it("cuts a 100-wall plan quickly enough to redraw during a drag", () => {
    const lvl = level(buildLargePlan());
    const t0 = performance.now();
    deriveWallMassCut(lvl);
    const ms = performance.now() - t0;
    console.info(`100-wall wall-mass cut: ${ms.toFixed(1)} ms (${Object.keys(lvl.openings).length} openings)`);
    expect(ms).toBeLessThan(40);
  });
});
