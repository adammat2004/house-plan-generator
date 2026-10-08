import { describe, expect, it } from "vitest";
import { deriveLevelGeometry, openingPlacement } from "@/domain/geometry/derive";
import type { Opening, PlanDocument, Window as WindowOpening } from "@/domain/plan/types";
import { AXIS, addWall, apply, level, newHouse, reject, rooms } from "../helpers";

const door = (id: string, wallId: string, offset: number, width = 0.9): Opening => ({
  id,
  wallId,
  kind: "door",
  offset,
  width,
  height: 2.1,
  hinge: "start",
  swingSide: "left",
});

const window = (id: string, wallId: string, offset: number, width = 1.2): WindowOpening => ({
  id,
  wallId,
  kind: "window",
  offset,
  width,
  height: 1.2,
  sillHeight: 0.9,
});

const worldStart = (doc: PlanDocument, id: string) => {
  const lvl = level(doc);
  return openingPlacement(deriveLevelGeometry(lvl), lvl.openings[id])!.start;
};

describe("hosted openings", () => {
  it("places doors and windows on host walls", () => {
    let doc = newHouse();
    const [south, , north] = level(doc).envelope.wallIds;
    doc = apply(doc, { type: "addOpening", opening: door("d1", south, 2) });
    doc = apply(doc, { type: "addOpening", opening: window("w1", north, 1) });
    expect(worldStart(doc, "d1")).toEqual({ x: 2.15, y: AXIS.south });
    // North wall runs east → west, so offset 1 is 1 m from the north-east corner.
    expect(worldStart(doc, "w1")).toEqual({ x: 6.85, y: AXIS.north });
  });

  it("rejects overlapping, out-of-bounds and junction-crossing openings", () => {
    let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
    const south = level(doc).envelope.wallIds[0];
    doc = apply(doc, { type: "addOpening", opening: door("d1", south, 1) });
    expect(reject(doc, { type: "addOpening", opening: window("w1", south, 1.5) })[0].code).toBe("opening-overlap");
    expect(reject(doc, { type: "addOpening", opening: window("w2", south, 7) })[0].code).toBe("opening-out-of-bounds");
    expect(reject(doc, { type: "addOpening", opening: window("w3", south, 3.5) })[0].code).toBe(
      "opening-crosses-junction",
    );
    expect(reject(doc, { type: "addOpening", opening: window("w4", south, 0.05) })[0].code).toBe(
      "opening-crosses-junction",
    );
    expect(reject(doc, { type: "addOpening", opening: { ...window("w5", south, 5), sillHeight: 2 } })[0].code).toBe(
      "opening-too-tall",
    );
  });

  it("does not merge rooms through a door", () => {
    let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
    doc = apply(doc, { type: "addOpening", opening: door("d1", "v", 3) });
    expect(rooms(doc)).toHaveLength(2);
  });

  it("keeps openings hosted and in place through moves and resizes", () => {
    let doc = addWall(newHouse(), "h", [AXIS.west, 5], [AXIS.east, 5]);
    const [south, , north] = level(doc).envelope.wallIds;
    doc = apply(doc, { type: "addOpening", opening: door("d-int", "h", 2) });
    doc = apply(doc, { type: "addOpening", opening: door("d-south", south, 1) });
    doc = apply(doc, { type: "addOpening", opening: window("w-north", north, 2) });
    const northBefore = worldStart(doc, "w-north");

    doc = apply(doc, { type: "moveWall", wallId: "h", delta: 1 });
    expect(level(doc).openings["d-int"]).toMatchObject({ wallId: "h", offset: 2 });
    expect(worldStart(doc, "d-int")).toEqual({ x: 2.15, y: 6 });

    doc = apply(doc, { type: "resizeFootprint", width: 10 });
    expect(worldStart(doc, "d-south")).toEqual({ x: 1.15, y: AXIS.south });
    expect(worldStart(doc, "w-north")).toEqual(northBefore);
    expect(level(doc).openings["w-north"].offset).toBeCloseTo(4, 9);
  });

  it("deletes hosted openings with their wall in one transaction", () => {
    let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
    doc = apply(doc, { type: "addOpening", opening: door("d1", "v", 3) });
    doc = apply(doc, { type: "deleteWall", wallId: "v" });
    expect(level(doc).openings).toEqual({});
  });

  it("rejects a wall move that would push a junction into an opening", () => {
    let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
    const south = level(doc).envelope.wallIds[0];
    doc = apply(doc, { type: "addOpening", opening: window("w1", south, 5) });
    expect(reject(doc, { type: "moveWall", wallId: "v", delta: 1.5 })[0].code).toBe("opening-crosses-junction");
  });

  it("edits door swing and moves openings along the wall", () => {
    let doc = newHouse();
    const south = level(doc).envelope.wallIds[0];
    doc = apply(doc, { type: "addOpening", opening: door("d1", south, 1) });
    doc = apply(doc, { type: "updateOpening", openingId: "d1", changes: { hinge: "end", swingSide: "right", offset: 2.5 } });
    expect(level(doc).openings.d1).toMatchObject({ hinge: "end", swingSide: "right", offset: 2.5 });
  });

  it("marks exactly one rear wall and keeps it through resizing", () => {
    let doc = newHouse();
    const [, , north, west] = level(doc).envelope.wallIds;
    doc = apply(doc, { type: "setRearWall", wallId: north });
    doc = apply(doc, { type: "setRearWall", wallId: west });
    expect(level(doc).rearWallId).toBe(west);
    doc = apply(doc, { type: "resizeFootprint", width: 12 });
    expect(level(doc).rearWallId).toBe(west);
    doc = addWall(doc, "v", [4, AXIS.south], [4, AXIS.north]);
    expect(reject(doc, { type: "setRearWall", wallId: "v" })[0].code).toBe("rear-wall-invalid");
  });
});
