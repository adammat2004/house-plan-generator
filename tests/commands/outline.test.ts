import { describe, expect, it } from "vitest";
import { applyCommand, createPlanDocument, parsePlanDocumentJson, serializePlanDocument, validateDocument } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { normalizeRing } from "@/domain/geometry/outline";
import { polygonArea } from "@/domain/geometry/polygons";
import type { PlanDocument } from "@/domain/plan/types";
import { OUTLINES, randomOutline, rectRing } from "../fixtures/outlines";
import { addWall, apply, envelope, faceCount, level, newHouse, newOutlineHouse, reject, rooms } from "../helpers";

/** L outline wall centrelines: front wing x 0.15–11.85, y 0.15–5.35; rear wing x 0.15–5.35 up to y 10.85. */
const L = { west: 0.15, east: 11.85, south: 0.15, north: 10.85, inner: 5.35 } as const;

describe("creating a house from an outline", () => {
  it("builds a rectangle exactly as createFootprint does", () => {
    const options = { id: "doc-1", name: "Test house", externalThickness: 0.3, wallHeight: 2.4 };
    expect(createPlanDocument({ ...options, outline: rectRing(8, 10) })).toEqual(newHouse());
    expect(createPlanDocument({ ...options, outline: rectRing(8, 10), idPrefix: "p" })).toEqual(
      createPlanDocument({ ...options, width: 8, depth: 10, idPrefix: "p" }),
    );
  });

  it("accepts any direction, start corner and position", () => {
    const moved = [...OUTLINES.L].reverse().map((p) => ({ x: p.x + 3, y: p.y - 7 }));
    expect(newOutlineHouse([...moved.slice(2), ...moved.slice(0, 2)])).toEqual(newOutlineHouse(OUTLINES.L));
    expect(envelope(newOutlineHouse(moved)).outsideRing).toEqual(OUTLINES.L);
  });

  it("replaces the house in one step and names the project", () => {
    let doc = addWall(newHouse(), "w", [4, 0.15], [4, 9.85]);
    doc = apply(doc, { type: "createOutline", outline: OUTLINES.U, externalThickness: 0.3, wallHeight: 2.6, name: "Courtyard house" });
    expect(doc.name).toBe("Courtyard house");
    expect(Object.keys(level(doc).walls)).toHaveLength(8);
    expect(level(doc).defaultWallHeight).toBe(2.6);
    expect(rooms(doc)).toHaveLength(1);
  });

  it("refuses outlines that aren't a house", () => {
    const issues = reject(newHouse(), {
      type: "createOutline",
      outline: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 5.5 }, { x: 0.9, y: 5.5 }, { x: 0.9, y: 11 }, { x: 0, y: 11 }],
      externalThickness: 0.3,
      wallHeight: 2.4,
    });
    expect(issues[0]).toMatchObject({ code: "envelope-invalid", message: expect.stringMatching(/only 0.3 m wide inside/) });
    expect(reject(newHouse(), { type: "createOutline", outline: [{ x: 0, y: 0 }, { x: 1, y: 1 }], externalThickness: 0.3, wallHeight: 2.4 })[0].code).toBe(
      "envelope-invalid",
    );
    expect(reject(newHouse(), { type: "createOutline", outline: rectRing(250, 10), externalThickness: 0.3, wallHeight: 2.4 })[0].message).toBe(
      "House width must be at most 200 m.",
    );
  });
});

describe("walls inside an L", () => {
  const house = () => newOutlineHouse(OUTLINES.L);

  it("keeps internal walls out of the notch", () => {
    const add = (start: [number, number], end: [number, number]) =>
      reject(house(), { type: "addWall", start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] }, thickness: 0.1 });
    // Wholly in the notch, though inside the bounding box.
    expect(add([7, 8], [10, 8])[0].code).toBe("outside-envelope");
    // Crossing from the rear wing into the notch.
    expect(add([3, 8], [9, 8])[0].code).toBe("outside-envelope");
    // From the front wing up into the notch.
    expect(add([8, 0.15], [8, 7])[0].code).toBe("outside-envelope");
  });

  it("splits the wings with a wall from the inward corner", () => {
    const doc = addWall(house(), "split", [L.inner, L.inner], [L.west, L.inner]);
    expect(validateDocument(doc)).toEqual([]);
    expect(faceCount(doc)).toBe(2);
    // The wall shares the corner's vertex with the outline.
    const lvl = level(doc);
    const corner = lvl.walls[lvl.envelope.wallIds[3]].startVertexId;
    expect(lvl.walls.split.startVertexId).toBe(corner);
  });

  it("slides a wall off the inward corner onto the outline, but not into the open", () => {
    const doc = addWall(house(), "split", [L.inner, L.inner], [L.west, L.inner]);
    const moved = apply(doc, { type: "moveWall", wallId: "split", delta: 1 });
    const lvl = level(moved);
    expect(lvl.vertices[lvl.walls.split.startVertexId]).toEqual({ x: L.inner, y: 6.35 });
    // The outline keeps its corner.
    expect(envelope(moved).outsideRing).toEqual(OUTLINES.L);
    expect(validateDocument(moved)).toEqual([]);
    expect(faceCount(moved)).toBe(2);
    // Moving it back lands on the corner again.
    const back = apply(moved, { type: "moveWall", wallId: "split", delta: -1 });
    expect(level(back).vertices[level(back).walls.split.startVertexId]).toEqual({ x: L.inner, y: L.inner });
    expect(validateDocument(back)).toEqual([]);
    // South of the corner the wall's end would hang free in the front wing.
    expect(reject(doc, { type: "moveWall", wallId: "split", delta: -1 })[0]).toMatchObject({
      code: "move-disconnects",
      message: "Moving this far would leave Internal wall 1 with a free end.",
    });
  });

  it("drags a wall from the inward corner along the outline", () => {
    const doc = addWall(house(), "down", [L.inner, L.inner], [L.inner, L.south]);
    const moved = apply(doc, { type: "moveWall", wallId: "down", delta: 2 });
    expect(level(moved).vertices[level(moved).walls.down.startVertexId]).toEqual({ x: 7.35, y: L.inner });
    expect(faceCount(moved)).toBe(2);
    // West of the corner its end would stand in the open floor where the wings meet.
    expect(reject(doc, { type: "moveWall", wallId: "down", delta: -2 })[0].code).toBe("move-disconnects");
  });

  it("resizes an L by its easternmost and northernmost walls", () => {
    const wider = apply(house(), { type: "resizeFootprint", width: 14, depth: 12 });
    expect(envelope(wider).outsideRing).toEqual([
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 5.5 },
      { x: 5.5, y: 5.5 },
      { x: 5.5, y: 12 },
      { x: 0, y: 12 },
    ]);
    expect(reject(house(), { type: "resizeFootprint", width: 5.6 })[0]).toMatchObject({
      code: "shrink-conflict",
      message: "House width can't be reduced below 5.700 m without changing the house's shape.",
    });
    expect(reject(house(), { type: "resizeFootprint", depth: 5.6 })[0].message).toBe("House depth can't be reduced below 5.700 m without changing the house's shape.");
  });
});

describe("plan files", () => {
  it("upgrades version 3 files, whose envelope was a rectangle", () => {
    const v3 = JSON.parse(serializePlanDocument(newHouse()));
    v3.schemaVersion = 3;
    v3.levels[0].envelope.kind = "rectangle";
    const parsed = parsePlanDocumentJson(JSON.stringify(v3));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.document).toEqual(newHouse());
  });

  it("round-trips outlines and refuses newer versions", () => {
    const doc = newOutlineHouse(OUTLINES.T);
    const parsed = parsePlanDocumentJson(serializePlanDocument(doc));
    expect(parsed.ok && parsed.document).toEqual(doc);
    const future = parsePlanDocumentJson(JSON.stringify({ ...doc, schemaVersion: 5 }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.issues[0].message).toMatch(/newer than this editor supports \(version 4\)/);
  });
});

describe("random outlines", () => {
  it("either make a valid house with the same outline or say why not", () => {
    let built = 0;
    const shell = newHouse();
    for (let seed = 1; seed <= 300; seed++) {
      const outline = randomOutline(seed);
      const result = applyCommand(shell, { type: "createOutline", outline, externalThickness: 0.3, wallHeight: 2.4 });
      if (!result.ok) {
        expect(["envelope-invalid", "invalid-value"], `seed ${seed}`).toContain(result.issues[0].code);
        expect(result.issues[0].message.length).toBeGreaterThan(10);
        continue;
      }
      built++;
      const doc: PlanDocument = result.document;
      expect(validateDocument(doc), `seed ${seed}`).toEqual([]);
      const env = analyzeEnvelope(level(doc));
      const mm = (ring: Array<{ x: number; y: number }>) => ring.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
      expect(env.ok && mm(env.info.outsideRing), `seed ${seed}`).toEqual(normalizeRing(outline));
      expect(faceCount(doc)).toBe(1);
      if (env.ok) expect(rooms(doc)[0].clearArea).toBeCloseTo(polygonArea({ outer: env.info.insideRing, holes: [] }), 3);
    }
    expect(built).toBeGreaterThan(200);
  });
});
