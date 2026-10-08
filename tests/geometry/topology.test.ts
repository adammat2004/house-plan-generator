import { describe, expect, it } from "vitest";
import { deriveLevelGeometry, openingHostIntervals } from "@/domain/geometry/derive";
import { AXIS, addWall, faceCount, level, newHouse, rooms } from "../helpers";

describe("wall topology and enclosed regions", () => {
  it("splits the house at a T-junction into two rooms", () => {
    const doc = addWall(newHouse(), "w-v", [4, AXIS.south], [4, AXIS.north]);
    const geometry = deriveLevelGeometry(level(doc));
    const contacts = geometry.contacts.get("w-v")!;
    expect(contacts.map((c) => c.thisEnd)).toEqual(["start", "end"]);
    expect(contacts.every((c) => c.otherEnd === null && c.perpendicular)).toBe(true);
    expect(faceCount(doc)).toBe(2);
    // Each side: (4 - 0.05 - 0.3) × 9.4 m clear.
    expect(rooms(doc).map((r) => r.clearArea)).toEqual([34.31, 34.31]);
  });

  it("creates four rooms from an X-junction of two crossing walls", () => {
    let doc = addWall(newHouse(), "w-v", [4, AXIS.south], [4, AXIS.north]);
    doc = addWall(doc, "w-h", [AXIS.west, 5], [AXIS.east, 5]);
    const geometry = deriveLevelGeometry(level(doc));
    const cross = geometry.contacts.get("w-h")!.find((c) => c.otherWallId === "w-v")!;
    expect(cross.thisEnd).toBeNull();
    expect(cross.otherEnd).toBeNull();
    expect(faceCount(doc)).toBe(4);
    const areas = rooms(doc).map((r) => r.clearArea);
    // Widths 3.65 m; depths (5 - 0.05 - 0.3) = 4.65 and (9.7 - 5.05) = 4.65.
    expect(areas).toEqual([16.9725, 16.9725, 16.9725, 16.9725]);
    const total = areas.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(7.4 * 9.4 - 0.1 * 9.4 - 0.1 * 7.4 + 0.01, 6);
  });

  it("keeps a dangling wall from creating a room but subtracts its footprint", () => {
    const doc = addWall(newHouse(), "w-stub", [AXIS.west, 5], [3, 5]);
    expect(faceCount(doc)).toBe(1);
    // Stub occupies x 0.3 → 3.0 inside the clear area, 100 mm thick.
    expect(rooms(doc)[0].clearArea).toBeCloseTo(69.56 - 2.7 * 0.1, 6);
  });

  it("closes a room only when the last wall completes the enclosure", () => {
    let doc = addWall(newHouse(), "a", [AXIS.west, 4], [3, 4]);
    expect(faceCount(doc)).toBe(1);
    doc = addWall(doc, "b", [3, 4], [3, AXIS.north]);
    expect(faceCount(doc)).toBe(2);
    const geometry = deriveLevelGeometry(level(doc));
    const corner = geometry.contacts.get("a")!.find((c) => c.otherWallId === "b")!;
    expect(corner.thisEnd).toBe("end");
    expect(corner.otherEnd).toBe("start");
    expect(level(doc).walls.a.endVertexId).toBe(level(doc).walls.b.startVertexId);
  });

  it("treats a freestanding enclosure as a hole in the surrounding room", () => {
    let doc = addWall(newHouse(), "s", [2, 2], [4, 2]);
    doc = addWall(doc, "e", [4, 2], [4, 4]);
    doc = addWall(doc, "n", [4, 4], [2, 4]);
    doc = addWall(doc, "w", [2, 4], [2, 2]);
    expect(faceCount(doc)).toBe(2);
    const [outer, inner] = [...rooms(doc)].sort((a, b) => b.clearArea - a.clearArea);
    // Inner clear: 1.9 × 1.9. Outer: house clear minus the box's outside footprint 2.1 × 2.1.
    expect(inner.clearArea).toBeCloseTo(1.9 * 1.9, 6);
    expect(outer.clearArea).toBeCloseTo(69.56 - 2.1 * 2.1, 6);
  });

  it("ignores a bridge wall connecting a freestanding box to the envelope", () => {
    let doc = addWall(newHouse(), "s", [2, 2], [4, 2]);
    doc = addWall(doc, "e", [4, 2], [4, 4]);
    doc = addWall(doc, "n", [4, 4], [2, 4]);
    doc = addWall(doc, "w", [2, 4], [2, 2]);
    doc = addWall(doc, "bridge", [AXIS.west, 3], [2, 3]);
    expect(faceCount(doc)).toBe(2);
  });

  it("blocks opening placement over junction zones", () => {
    const doc = addWall(newHouse(), "w-v", [4, AXIS.south], [4, AXIS.north]);
    const lvl = level(doc);
    const south = lvl.envelope.wallIds[0];
    const intervals = openingHostIntervals(deriveLevelGeometry(lvl), south);
    // South axis runs 0.15 → 7.85 (length 7.7). Corners block 0.15 at each end; the tee at s = 3.85 blocks ±0.05.
    expect(intervals).toEqual([
      [0.15, expect.closeTo(3.8, 9)],
      [expect.closeTo(3.9, 9), expect.closeTo(7.55, 9)],
    ]);
  });
});
