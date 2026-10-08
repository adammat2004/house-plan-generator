import { describe, expect, it } from "vitest";
import { parsePlanDocumentJson, serializePlanDocument, validateDocument } from "@/domain/commands";
import { AXIS, envelope, faceCount, level, newHouse, rooms } from "../helpers";

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
      ["defaultWallHeight", "elevation", "envelope", "id", "name", "openings", "rearWallId", "rooms", "vertices", "walls"].sort(),
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
