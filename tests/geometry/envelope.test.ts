import { describe, expect, it } from "vitest";
import { describeEntity, parsePlanDocumentJson, serializePlanDocument, validateDocument } from "@/domain/commands";
import { polygonArea } from "@/domain/geometry/polygons";
import { OUTLINES } from "../fixtures/outlines";
import { AXIS, envelope, faceCount, level, newHouse, newOutlineHouse, rooms } from "../helpers";

describe("rectangular envelope", () => {
  it("measures width and depth outside face to outside face", () => {
    const doc = newHouse(8, 10);
    const env = envelope(doc);
    expect(env.width).toBeCloseTo(8, 9);
    expect(env.depth).toBeCloseTo(10, 9);
    expect(env.outsideRect).toEqual({ minX: 0, minY: 0, maxX: 8, maxY: 10 });
    expect(env.axisRect).toEqual({ minX: AXIS.west, minY: AXIS.south, maxX: AXIS.east, maxY: AXIS.north });
  });

  it("orders the four external walls counterclockwise from the south wall", () => {
    const doc = newHouse();
    const lvl = level(doc);
    const env = envelope(doc);
    expect(lvl.envelope.wallIds).toEqual([env.sides.south, env.sides.east, env.sides.north, env.sides.west]);
    expect(Object.values(lvl.walls).every((w) => w.role === "external")).toBe(true);
    expect(lvl.rearWallId).toBeNull();
  });

  it("derives one room whose clear area excludes wall thickness", () => {
    const doc = newHouse(8, 10);
    expect(faceCount(doc)).toBe(1);
    const [room] = rooms(doc);
    expect(room.name).toBe("Room 1");
    expect(room.clearArea).toBeCloseTo(7.4 * 9.4, 6);
  });

  it("does not persist derived geometry", () => {
    const lvl = level(newHouse()) as unknown as Record<string, unknown>;
    expect(Object.keys(lvl).sort()).toEqual(
      ["defaultWallHeight", "elevation", "envelope", "furniture", "id", "name", "openings", "rearWallId", "rooms", "vertices", "walls"].sort(),
    );
    const room = Object.values(level(newHouse()).rooms)[0] as unknown as Record<string, unknown>;
    expect(Object.keys(room).sort()).toEqual(["id", "name", "seed", "type"]);
  });

  it("round-trips through native JSON", () => {
    const doc = newHouse();
    const parsed = parsePlanDocumentJson(serializePlanDocument(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.document).toEqual(doc);
    expect(validateDocument(doc)).toEqual([]);
  });
});

describe("right-angle outlines", () => {
  it("describes an L: bounding box, rings, facing and family", () => {
    const doc = newOutlineHouse(OUTLINES.L);
    const env = envelope(doc);
    const ids = level(doc).envelope.wallIds;
    expect(ids).toHaveLength(6);
    expect(env.isRectangle).toBe(false);
    expect(env.family).toBe("L");
    expect(env.reflexCount).toBe(1);
    expect(env.outsideRect).toEqual({ minX: 0, minY: 0, maxX: 12, maxY: 11 });
    expect([env.width, env.depth]).toEqual([12, 11]);
    expect(env.outsideRing).toEqual(OUTLINES.L);
    expect(env.grossArea).toBeCloseTo(12 * 5.5 + 5.5 * 5.5, 9);
    // Walls run south, east, north (inner), east (inner), north, west.
    expect(ids.map((id) => env.sideOfWall[id])).toEqual(["south", "east", "north", "east", "north", "west"]);
    expect(env.wallsFacing.north).toEqual([ids[2], ids[4]]);
    // The main wall on each side is the one on the bounding box.
    expect(env.sides).toEqual({ south: ids[0], east: ids[1], north: ids[4], west: ids[5] });
    expect(env.edges[2]).toMatchObject({ startCorner: "convex", endCorner: "reflex" });
    expect(env.edges[2].outside.length).toBeCloseTo(6.5, 9);
  });

  it("derives one room whose clear area is the inside of the outline", () => {
    for (const name of ["L", "T", "U", "Z", "bay", "notch", "plus", "stairs"] as const) {
      const doc = newOutlineHouse(OUTLINES[name]);
      expect(faceCount(doc), name).toBe(1);
      expect(validateDocument(doc), name).toEqual([]);
      const [room] = rooms(doc);
      expect(room.clearArea, name).toBeCloseTo(polygonArea({ outer: envelope(doc).insideRing, holes: [] }), 4);
    }
  });

  it("labels walls that face the same way in order", () => {
    const doc = newOutlineHouse(OUTLINES.U);
    const ids = level(doc).envelope.wallIds;
    const labels = ids.map((id) => describeEntity(level(doc), id));
    // Numbered west to east, or south to north.
    expect(labels).toEqual([
      "South external wall",
      "East external wall 1",
      "North external wall 3",
      "West external wall 2",
      "North external wall 2",
      "East external wall 2",
      "North external wall 1",
      "West external wall 1",
    ]);
  });
});
