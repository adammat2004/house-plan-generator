import { describe, expect, it } from "vitest";
import { applyCommand } from "@/domain/commands";
import { AXIS, addWall, apply, envelope, level, newHouse, reject, rooms } from "../helpers";

const vertex = (doc: ReturnType<typeof newHouse>, wallId: string, end: "start" | "end") => {
  const lvl = level(doc);
  const wall = lvl.walls[wallId];
  return lvl.vertices[end === "start" ? wall.startVertexId : wall.endVertexId];
};

describe("adding walls", () => {
  it("joins new wall ends to existing vertices", () => {
    let doc = addWall(newHouse(), "a", [AXIS.west, 4], [3, 4]);
    doc = addWall(doc, "b", [3, 4], [3, 2]);
    expect(level(doc).walls.b.startVertexId).toBe(level(doc).walls.a.endVertexId);
  });

  it("rejects zero-length, angled, overlapping and outside walls", () => {
    const doc = addWall(newHouse(), "a", [AXIS.west, 4], [3, 4]);
    const add = (start: [number, number], end: [number, number]) =>
      reject(doc, { type: "addWall", start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] }, thickness: 0.1 });
    expect(add([2, 2], [2, 2])[0].code).toBe("zero-length-wall");
    expect(add([2, 2], [3, 3])[0].code).toBe("non-orthogonal-wall");
    expect(add([1, 4], [5, 4])[0].code).toBe("wall-overlap");
    expect(add([4, 4], [9, 4])[0].code).toBe("outside-envelope");
    expect(add([AXIS.west, 1], [AXIS.west, 3])[0].code).toBe("wall-overlap");
  });

  it("rejects walls whose footprints collide without joining", () => {
    const doc = addWall(newHouse(), "a", [4, AXIS.south], [4, AXIS.north]);
    const clash = reject(doc, { type: "addWall", start: { x: 4.08, y: 2 }, end: { x: 4.08, y: 5 }, thickness: 0.1 });
    expect(clash[0].code).toBe("wall-clash");
    expect(clash[0].entityIds).toContain("a");
    const stub = reject(doc, { type: "addWall", start: { x: 2, y: 3 }, end: { x: 3.98, y: 3 }, thickness: 0.1 });
    expect(stub[0].code).toBe("wall-clash");
  });

  it("refuses to delete or drag external walls", () => {
    const doc = newHouse();
    const south = level(doc).envelope.wallIds[0];
    expect(reject(doc, { type: "deleteWall", wallId: south })[0].code).toBe("envelope-locked");
    expect(reject(doc, { type: "moveWall", wallId: south, delta: 1 })[0].code).toBe("envelope-locked");
  });
});

describe("connected wall moves", () => {
  it("slides a wall and stretches the walls attached to it", () => {
    let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
    doc = addWall(doc, "h", [AXIS.west, 5], [4, 5]);
    doc = apply(doc, { type: "moveWall", wallId: "v", delta: 1.25 });
    expect(vertex(doc, "v", "start")).toEqual({ x: 5.25, y: AXIS.south });
    expect(vertex(doc, "v", "end")).toEqual({ x: 5.25, y: AXIS.north });
    expect(vertex(doc, "h", "end")).toEqual({ x: 5.25, y: 5 });
    expect(rooms(doc)).toHaveLength(3);
  });

  it("moves walls that tee into the moved wall's length", () => {
    let doc = addWall(newHouse(), "h", [AXIS.west, 5], [AXIS.east, 5]);
    doc = addWall(doc, "v", [3, AXIS.south], [3, 5]);
    doc = apply(doc, { type: "moveWall", wallId: "h", delta: -1 });
    expect(vertex(doc, "v", "end")).toEqual({ x: 3, y: 4 });
    expect(vertex(doc, "h", "start")).toEqual({ x: AXIS.west, y: 4 });
  });

  it("rejects moves that would disconnect a junction", () => {
    let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, 6]);
    doc = addWall(doc, "h", [AXIS.west, 3], [4, 3]);
    const issues = reject(doc, { type: "moveWall", wallId: "h", delta: 3.5 });
    expect(issues[0].code).toBe("move-disconnects");
    expect(issues[0].entityIds).toEqual(["h", "v"]);
  });

  it("rejects moves that would collapse an attached wall", () => {
    let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
    doc = addWall(doc, "h", [4, 5], [5, 5]);
    const issues = reject(doc, { type: "moveWall", wallId: "v", delta: 1.5 });
    expect(issues[0].code).toBe("move-collapses-wall");
    expect(reject(doc, { type: "moveWall", wallId: "v", delta: 4 })[0].code).toBe("move-blocked");
  });

  it("stops a wall from sliding through a parallel wall", () => {
    let doc = addWall(newHouse(), "a", [AXIS.west, 3], [AXIS.east, 3]);
    doc = addWall(doc, "b", [AXIS.west, 5], [AXIS.east, 5]);
    const issues = reject(doc, { type: "moveWall", wallId: "a", delta: 2.5 });
    expect(issues[0].code).toBe("move-blocked");
    expect(issues[0].entityIds).toEqual(["a", "b"]);
    expect(reject(doc, { type: "moveWall", wallId: "a", delta: 1.95 })[0].code).toBe("wall-clash");
    expect(rooms(apply(doc, { type: "moveWall", wallId: "a", delta: 1.8 }))).toHaveLength(3);
  });

  it("moves collinear segments of the same straight wall together", () => {
    let doc = addWall(newHouse(), "a", [AXIS.west, 5], [3, 5]);
    doc = addWall(doc, "b", [3, 5], [5, 5]);
    doc = addWall(doc, "c", [3, 5], [3, AXIS.north]);
    doc = apply(doc, { type: "moveWall", wallId: "a", delta: 1 });
    expect(vertex(doc, "a", "start")).toEqual({ x: AXIS.west, y: 6 });
    expect(vertex(doc, "b", "end")).toEqual({ x: 5, y: 6 });
    expect(vertex(doc, "c", "start")).toEqual({ x: 3, y: 6 });
  });

  it("extends and trims a wall end, detaching it from a shared corner", () => {
    let doc = addWall(newHouse(), "a", [AXIS.west, 4], [3, 4]);
    doc = addWall(doc, "b", [3, 4], [3, AXIS.north]);
    doc = apply(doc, { type: "moveWallEndpoint", wallId: "a", end: "end", position: 5, idPrefix: "x" });
    expect(vertex(doc, "a", "end")).toEqual({ x: 5, y: 4 });
    // b's corner vertex now tees into a's length.
    expect(vertex(doc, "b", "start")).toEqual({ x: 3, y: 4 });
    expect(rooms(doc)).toHaveLength(2);
    doc = apply(doc, { type: "moveWallEndpoint", wallId: "a", end: "end", position: 2, idPrefix: "y" });
    expect(rooms(doc)).toHaveLength(1);
    expect(reject(doc, { type: "moveWallEndpoint", wallId: "a", end: "end", position: 0.1 })[0].code).toBe(
      "move-collapses-wall",
    );
  });
});

describe("house resizing", () => {
  it("keeps the lower-left corner and internal coordinates fixed", () => {
    let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
    doc = addWall(doc, "h", [4, 5], [AXIS.east, 5]);
    doc = apply(doc, { type: "resizeFootprint", width: 9, depth: 11 });
    const env = envelope(doc);
    expect(env.outsideRect).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 11 });
    expect(vertex(doc, "v", "start")).toEqual({ x: 4, y: AXIS.south });
    expect(vertex(doc, "v", "end")).toEqual({ x: 4, y: 10.85 });
    expect(vertex(doc, "h", "start")).toEqual({ x: 4, y: 5 });
    expect(vertex(doc, "h", "end")).toEqual({ x: 8.85, y: 5 });
  });

  it("rejects shrinking past internal walls and explains the limit", () => {
    const doc = addWall(newHouse(), "v", [6, AXIS.south], [6, AXIS.north]);
    const issues = reject(doc, { type: "resizeFootprint", width: 6.2 });
    expect(issues[0].code).toBe("shrink-conflict");
    expect(issues[0].message).toContain("6.350 m");
    expect(issues[0].entityIds).toContain("v");
    expect(applyCommand(doc, { type: "resizeFootprint", width: 6.35 }).ok).toBe(true);
  });

  it("rejects dimensions too small for the walls", () => {
    expect(reject(newHouse(), { type: "resizeFootprint", width: 0.9 })[0].code).toBe("invalid-value");
  });
});
