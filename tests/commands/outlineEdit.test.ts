import { describe, expect, it } from "vitest";
import { applyCommand, parsePlanDocumentJson, serializePlanDocument, validateDocument } from "@/domain/commands";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { pointAtParam } from "@/domain/geometry/walls";
import type { Opening, PlanDocument } from "@/domain/plan/types";
import { OUTLINES, seeded } from "../fixtures/outlines";
import { addWall, apply, envelope, faceCount, level, newHouse, newOutlineHouse, reject, rooms } from "../helpers";

const ring = (doc: PlanDocument) => envelope(doc).outsideRing.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
const wallFacing = (doc: PlanDocument, side: "north" | "south" | "east" | "west") => envelope(doc).sides[side];
const window_ = (id: string, wallId: string, offset: number, width = 1.2): Opening => ({ id, wallId, kind: "window", offset, width, height: 1.2, sillHeight: 0.9 });
const worldOf = (doc: PlanDocument, id: string) => {
  const o = level(doc).openings[id];
  return pointAtParam(deriveLevelGeometry(level(doc)).axes.get(o.wallId)!, o.offset);
};

describe("pushing and pulling the outline", () => {
  it("moves a whole wall like a resize, stretching walls tee'd onto it", () => {
    let doc = addWall(newHouse(12, 9), "split", [6, 0.15], [6, 8.85]);
    doc = apply(doc, { type: "addOpening", opening: window_("w1", wallFacing(doc, "east"), 2) });
    doc = apply(doc, { type: "addOpening", opening: window_("w2", wallFacing(doc, "north"), 2) });
    const north = worldOf(doc, "w2");
    const moved = apply(doc, { type: "moveOutlineEdge", wallId: wallFacing(doc, "north"), outward: 1 });
    expect(ring(moved)).toEqual(ring(apply(doc, { type: "resizeFootprint", depth: 10 })));
    expect(level(moved).vertices[level(moved).walls.split.endVertexId]).toEqual({ x: 6, y: 9.85 });
    // The window on the moved wall goes with it; the one on a stretched wall stays put.
    expect(worldOf(moved, "w2")).toEqual({ x: north.x, y: 9.85 });
    expect(worldOf(moved, "w1")).toEqual(worldOf(doc, "w1"));
    expect(Object.keys(level(moved).walls)).toHaveLength(5);
  });

  it("cuts a notch from a corner, and fills it again to the same walls", () => {
    const doc = newHouse(12, 9);
    const north = wallFacing(doc, "north");
    // The north wall runs east to west, so its first 3 m are at the north-east corner.
    const notched = apply(doc, { type: "moveOutlineEdge", wallId: north, from: 0, to: 3, outward: -2 });
    expect(ring(notched)).toEqual(OUTLINES.notch);
    expect(level(notched).envelope.wallIds).toHaveLength(6);
    expect(envelope(notched).family).toBe("L");
    // The longer piece keeps the north wall's id.
    expect(envelope(notched).sides.north).toBe(north);
    const inner = level(notched).envelope.wallIds.find((id) => !level(doc).walls[id] && envelope(notched).sideOfWall[id] === "north")!;
    const filled = apply(notched, { type: "moveOutlineEdge", wallId: inner, outward: 2 });
    expect(level(filled).envelope.wallIds).toEqual(level(doc).envelope.wallIds);
    expect(ring(filled)).toEqual(ring(doc));
    expect(validateDocument(filled)).toEqual([]);
  });

  it("makes a bay in the middle of a wall, taking its window with it", () => {
    let doc = newHouse(12, 9);
    const north = wallFacing(doc, "north");
    doc = apply(doc, { type: "addOpening", opening: window_("w", north, 5.2, 1.2) });
    const before = worldOf(doc, "w");
    const bay = apply(doc, { type: "moveOutlineEdge", wallId: north, from: 4.5, to: 7.7, outward: 1 });
    expect(ring(bay)).toEqual(OUTLINES.bay);
    expect(level(bay).envelope.wallIds).toHaveLength(8);
    expect(worldOf(bay, "w")).toEqual({ x: before.x, y: before.y + 1 });
    expect(rooms(bay)).toHaveLength(1);
    // A window across where the step would start stops the move.
    expect(reject(doc, { type: "moveOutlineEdge", wallId: north, from: 5.5, to: 8, outward: 1 })[0]).toMatchObject({
      code: "opening-crosses-junction",
      message: "Window 1 is where the step would start; move it or start the step elsewhere.",
    });
  });

  it("keeps the garden side on the wall that keeps its identity", () => {
    let doc = newHouse(12, 9);
    const north = wallFacing(doc, "north");
    doc = apply(doc, { type: "setRearWall", wallId: north });
    const bay = apply(doc, { type: "moveOutlineEdge", wallId: north, from: 4.5, to: 7.7, outward: 1 });
    expect(level(bay).rearWallId).toBe(north);
    expect(level(bay).walls[north]).toBeDefined();
  });

  it("refuses moves that pass through walls, collide or leave a sliver", () => {
    const doc = addWall(newHouse(12, 9), "across", [0.15, 6], [11.85, 6]);
    const north = wallFacing(doc, "north");
    expect(reject(doc, { type: "moveOutlineEdge", wallId: north, from: 0, to: 3, outward: -4 })[0]).toMatchObject({ code: "move-blocked", message: expect.stringMatching(/is in the way/) });
    expect(reject(doc, { type: "moveOutlineEdge", wallId: north, from: 0.1, to: 3, outward: 1 })[0].message).toMatch(/Leave at least 200 mm of wall beside a step/);
    // The U's arms can't be pushed into each other.
    const u = newOutlineHouse(OUTLINES.U);
    const westArmInner = level(u).envelope.wallIds.find((id) => envelope(u).sideOfWall[id] === "east" && envelope(u).edges.find((e) => e.wallId === id)!.axis.start.x < 7)!;
    expect(reject(u, { type: "moveOutlineEdge", wallId: westArmInner, outward: 4.9 })[0].code).toBe("envelope-invalid");
    // A step shorter than the walls are thick.
    const notched = apply(newHouse(12, 9), { type: "moveOutlineEdge", wallId: wallFacing(newHouse(12, 9), "north"), from: 0, to: 3, outward: -2 });
    const inner = level(notched).envelope.wallIds.find((id) => !level(newHouse(12, 9)).walls[id] && envelope(notched).sideOfWall[id] === "north")!;
    expect(reject(notched, { type: "moveOutlineEdge", wallId: inner, outward: 1.9 })[0].message).toMatch(/A step in the house outline .* is 0.1 m/);
  });

  it("keeps every plan valid through a random series of pushes and pulls", () => {
    const random = seeded(42);
    const starts = [newHouse(12, 9), newOutlineHouse(OUTLINES.L), newOutlineHouse(OUTLINES.U), addWall(newHouse(14, 10), "mid", [7, 0.15], [7, 9.85])];
    let applied = 0;
    for (const start of starts) {
      let doc = start;
      for (let move = 0; move < 120; move++) {
        const ids = level(doc).envelope.wallIds;
        const wallId = ids[Math.floor(random() * ids.length)];
        const len = envelope(doc).edges.find((e) => e.wallId === wallId)!.axis.length;
        const outward = (Math.floor(random() * 13) - 6) * 0.5;
        const kind = random();
        const a = Math.round(random() * len * 2) / 2;
        const b = Math.round(random() * len * 2) / 2;
        const range = kind < 0.4 ? {} : kind < 0.7 ? { from: 0, to: Math.max(a, 0.5) } : { from: Math.min(a, b), to: Math.max(a, b) };
        const result = applyCommand(doc, { type: "moveOutlineEdge", wallId, outward, ...range });
        if (!result.ok) {
          expect(result.issues[0].message.length).toBeGreaterThan(10);
          continue;
        }
        applied++;
        doc = result.document;
        expect(validateDocument(doc)).toEqual([]);
        expect(faceCount(doc)).toBe(Object.keys(level(doc).rooms).length);
      }
      const parsed = parsePlanDocumentJson(serializePlanDocument(doc));
      expect(parsed.ok && parsed.document).toEqual(doc);
    }
    expect(applied).toBeGreaterThan(100);
  });
});
