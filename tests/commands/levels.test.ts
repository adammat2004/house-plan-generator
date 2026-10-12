import { describe, expect, it } from "vitest";
import { applyCommand, parsePlanDocumentJson, serializePlanDocument, validateDocument } from "@/domain/commands";
import { collectIds } from "@/domain/commands/ids";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { difference, polygonArea } from "@/domain/geometry/polygons";
import { changedLevelId, levelView, restack, spliceLevel, storeyName } from "@/domain/plan/levels";
import type { Level, PlanDocument } from "@/domain/plan/types";
import { OUTLINES, seeded } from "../fixtures/outlines";
import { addWall, apply, level, newHouse, newOutlineHouse, reject } from "../helpers";

const env = (l: Level) => {
  const e = analyzeEnvelope(l);
  if (!e.ok) throw new Error(e.message);
  return e.info;
};
const facing = (l: Level, side: "north" | "south" | "east" | "west") => env(l).sides[side];
const floor = (doc: PlanDocument, i: number) => doc.levels[i];
const twoStorey = (doc = newHouse()) => apply(doc, { type: "addLevel" });
const overhang = (doc: PlanDocument, i: number) =>
  difference({ outer: env(floor(doc, i)).outsideRing, holes: [] }, [{ outer: env(floor(doc, i - 1)).outsideRing, holes: [] }]).reduce((s, p) => s + polygonArea(p), 0);

describe("adding, removing and changing floors", () => {
  it("adds a floor over the whole of the one below, with fresh ids and nothing inside", () => {
    const ground = addWall(newHouse(), "w", [4, 0.15], [4, 9.85]);
    const doc = twoStorey(apply(ground, { type: "setRearWall", wallId: facing(level(ground), "north") }));
    expect(doc.levels).toHaveLength(2);
    const first = floor(doc, 1);
    expect(first.name).toBe("First floor");
    expect(first.elevation).toBeCloseTo(2.4 + 0.3, 9);
    expect(first.floorThickness).toBe(0.3);
    expect(env(first).outsideRing).toEqual(env(floor(doc, 0)).outsideRing);
    expect(Object.values(first.walls).every((w) => w.role === "external" && w.height === 2.4)).toBe(true);
    expect(Object.keys(first.openings)).toHaveLength(0);
    expect(Object.keys(first.rooms)).toHaveLength(1);
    // One house, one set of names: the new floor's room doesn't repeat the ground floor's.
    const groundNames = Object.values(floor(doc, 0).rooms).map((r) => r.name);
    expect(groundNames).not.toContain(Object.values(first.rooms)[0].name);
    expect(env(first).sideOfWall[first.rearWallId!]).toBe("north");
    const groundIds = new Set(collectIds(floor(doc, 0)));
    expect(collectIds(first).filter((id) => groundIds.has(id))).toEqual([]);
    expect(validateDocument(doc)).toEqual([]);
  });

  it("stops at three floors and never removes the ground floor", () => {
    const three = apply(twoStorey(), { type: "addLevel" });
    expect(three.levels.map((l) => l.name)).toEqual(["Ground floor", "First floor", "Second floor"]);
    expect(floor(three, 2).elevation).toBeCloseTo(5.4, 9);
    expect(reject(three, { type: "addLevel" })[0].code).toBe("level-limit");
    expect(reject(three, { type: "removeLevel", levelId: floor(three, 0).id })[0].message).toMatch(/ground floor can't be removed/);
    const two = apply(three, { type: "removeLevel", levelId: floor(three, 1).id });
    expect(two.levels.map((l) => l.id)).toEqual([floor(three, 0).id, floor(three, 2).id]);
    expect(floor(two, 1).elevation).toBeCloseTo(2.7, 9);
  });

  it("keeps a floor with pinned rooms", () => {
    const doc = twoStorey();
    const room = Object.values(floor(doc, 1).rooms)[0];
    const pinned = apply(doc, { type: "updateRoom", roomId: room.id, changes: { locked: true } });
    expect(reject(pinned, { type: "removeLevel", levelId: floor(doc, 1).id })[0].code).toBe("room-pinned");
  });

  it("restacks the floors above when a ceiling height or floor thickness changes", () => {
    const doc = apply(twoStorey(), { type: "addLevel" });
    const taller = apply(doc, { type: "updateLevel", wallHeight: 2.7 });
    expect(floor(taller, 0).defaultWallHeight).toBe(2.7);
    expect(Object.values(floor(taller, 0).walls).every((w) => w.height === 2.7)).toBe(true);
    expect(floor(taller, 1).elevation).toBeCloseTo(3, 9);
    expect(floor(taller, 2).elevation).toBeCloseTo(5.7, 9);
    const thicker = apply(taller, { type: "updateLevel", levelId: floor(doc, 1).id, floorThickness: 0.4 });
    expect(floor(thicker, 1).elevation).toBeCloseTo(3.1, 9);
    expect(floor(thicker, 2).elevation).toBeCloseTo(5.8, 9);
    expect(reject(doc, { type: "updateLevel", floorThickness: 0.3 })[0].message).toMatch(/ground floor stands on the ground/);
    const renamed = apply(doc, { type: "updateLevel", levelId: floor(doc, 2).id, name: "  Loft " });
    expect(floor(renamed, 2).name).toBe("Loft");
    expect(reject(doc, { type: "updateLevel", levelId: floor(doc, 2).id, name: " " })[0].code).toBe("invalid-value");
  });

  it("refuses walls taller than the ceiling under another floor", () => {
    const doc = twoStorey();
    const wallId = facing(floor(doc, 0), "east");
    const issues = reject(doc, { type: "updateWall", wallId, height: 3 });
    expect(issues[0].code).toBe("level-stack");
    expect(issues[0].message).toMatch(/at most 2.4 m tall.*first floor stands on it/);
    // The top floor's walls can be as tall as you like.
    expect(applyCommand(doc, { type: "updateWall", wallId: facing(floor(doc, 1), "east"), height: 3 }).ok).toBe(true);
  });
});

describe("commands on a floor", () => {
  it("acts on the floor named, or the floor holding what it names", () => {
    const doc = twoStorey();
    const upstairs = apply(doc, { type: "addWall", levelId: floor(doc, 1).id, start: { x: 4, y: 0.15 }, end: { x: 4, y: 9.85 }, thickness: 0.1 });
    expect(floor(upstairs, 0)).toBe(floor(doc, 0));
    expect(Object.keys(floor(upstairs, 1).rooms)).toHaveLength(2);
    expect(changedLevelId(doc, upstairs)).toBe(floor(doc, 1).id);

    const wallId = Object.values(floor(upstairs, 1).walls).find((w) => w.role === "internal")!.id;
    const moved = apply(upstairs, { type: "moveWall", wallId, delta: 1 });
    expect(floor(moved, 0)).toBe(floor(doc, 0));
    expect(moved.levels[1].vertices).not.toEqual(upstairs.levels[1].vertices);
    expect(reject(doc, { type: "addWall", levelId: "nowhere", start: { x: 1, y: 1 }, end: { x: 2, y: 1 }, thickness: 0.1 })[0].message).toMatch(/floor no longer exists/);
  });

  it("keeps ids unique across floors, even without a prefix", () => {
    let doc = twoStorey();
    doc = apply(doc, { type: "addWall", start: { x: 4, y: 0.15 }, end: { x: 4, y: 9.85 }, thickness: 0.1 });
    doc = apply(doc, { type: "addWall", levelId: floor(doc, 1).id, start: { x: 3, y: 0.15 }, end: { x: 3, y: 9.85 }, thickness: 0.1 });
    const all = doc.levels.flatMap(collectIds);
    expect(new Set(all).size).toBe(all.length);
    const taken = Object.keys(floor(doc, 0).walls)[0];
    expect(reject(doc, { type: "addWall", levelId: floor(doc, 1).id, wallId: taken, start: { x: 2, y: 0.15 }, end: { x: 2, y: 9.85 }, thickness: 0.1 })[0].code).toBe("invalid-value");
  });

  it("works on one floor through a view and splices it back", () => {
    const doc = twoStorey();
    const id = floor(doc, 1).id;
    const view = levelView(doc, id);
    expect(view.levels).toEqual([floor(doc, 1)]);
    const wall = { type: "addWall", start: { x: 4, y: 0.15 }, end: { x: 4, y: 9.85 }, thickness: 0.1 } as const;
    const back = spliceLevel(doc, id, apply(view, { ...wall, idPrefix: "view" }));
    expect(floor(back, 0)).toBe(floor(doc, 0));
    expect(validateDocument(back)).toEqual([]);
    // A view only knows its own floor's ids, so edits in it need a prefix of their own; clashes are caught.
    const clash = spliceLevel(doc, id, apply(view, wall));
    expect(validateDocument(clash)[0].message).toMatch(/both use the id/);
  });
});

describe("outlines on several floors", () => {
  it("pulls the floors above in with a wall they sit flush on, but pushing out changes one floor", () => {
    const doc = twoStorey(newHouse(12, 9));
    const north = facing(floor(doc, 0), "north");
    const pulled = apply(doc, { type: "moveOutlineEdge", wallId: north, outward: -1 });
    expect(env(floor(pulled, 0)).depth).toBeCloseTo(8, 9);
    expect(env(floor(pulled, 1)).depth).toBeCloseTo(8, 9);

    // A single-storey extension at the back.
    const extended = apply(doc, { type: "moveOutlineEdge", wallId: north, outward: 4 });
    expect(env(floor(extended, 0)).depth).toBeCloseTo(13, 9);
    expect(env(floor(extended, 1)).depth).toBeCloseTo(9, 9);
    expect(validateDocument(extended)).toEqual([]);
  });

  it("carries a notch up, and words problems on another floor", () => {
    const doc = twoStorey(newHouse(12, 9));
    const north = facing(floor(doc, 0), "north");
    const notched = apply(doc, { type: "moveOutlineEdge", wallId: north, from: 0, to: 3, outward: -2 });
    expect(overhang(notched, 1)).toBe(0);
    expect(env(floor(notched, 1)).family).toBe("L");

    const withUpper = apply(doc, { type: "addWall", levelId: floor(doc, 1).id, wallId: "up", start: { x: 0.15, y: 7.5 }, end: { x: 11.85, y: 7.5 }, thickness: 0.1, idPrefix: "up" });
    const issues = reject(withUpper, { type: "moveOutlineEdge", wallId: north, outward: -2 });
    expect(issues[0].message).toMatch(/^On the first floor: .*in the way/);
  });

  it("refuses an upper floor that overhangs, and allows one set back", () => {
    const doc = twoStorey(newHouse(12, 9));
    const upperNorth = facing(floor(doc, 1), "north");
    const out = reject(doc, { type: "moveOutlineEdge", wallId: upperNorth, outward: 1 });
    expect(out[0].code).toBe("level-overhang");
    expect(out[0].message).toMatch(/first floor would overhang the ground floor along the north side/);
    const setBack = apply(doc, { type: "moveOutlineEdge", wallId: upperNorth, outward: -3 });
    expect(env(floor(setBack, 1)).depth).toBeCloseTo(6, 9);
    expect(floor(setBack, 0)).toBe(floor(doc, 0));
  });

  it("resizes every floor sitting flush with the side that moves", () => {
    const doc = twoStorey(newHouse(12, 9));
    const wider = apply(doc, { type: "resizeFootprint", width: 14 });
    expect(env(floor(wider, 0)).width).toBeCloseTo(14, 9);
    expect(env(floor(wider, 1)).width).toBeCloseTo(14, 9);
    const setBack = apply(doc, { type: "moveOutlineEdge", wallId: facing(floor(doc, 1), "east"), outward: -2 });
    const deeper = apply(setBack, { type: "resizeFootprint", width: 13, depth: 10 });
    expect(env(floor(deeper, 1)).width).toBeCloseTo(10, 9);
    expect(env(floor(deeper, 1)).depth).toBeCloseTo(10, 9);
    expect(reject(setBack, { type: "resizeFootprint", width: 9 })[0].code).toBe("level-overhang");
  });

  it("rebuilds the floors above when a floor gets a new outline", () => {
    let doc = apply(twoStorey(newHouse(12, 9)), { type: "addLevel" });
    doc = apply(doc, { type: "addWall", levelId: floor(doc, 2).id, start: { x: 4, y: 0.15 }, end: { x: 4, y: 8.85 }, thickness: 0.1 });
    const reshaped = apply(doc, { type: "createOutline", outline: OUTLINES.L, externalThickness: 0.3, wallHeight: 2.4 });
    for (const i of [1, 2]) {
      expect(env(floor(reshaped, i)).outsideRing).toEqual(env(floor(reshaped, 0)).outsideRing);
      expect(floor(reshaped, i).id).toBe(floor(doc, i).id);
      expect(floor(reshaped, i).name).toBe(storeyName(i));
      expect(Object.keys(floor(reshaped, i).rooms)).toHaveLength(1);
    }
    expect(floor(reshaped, 2).elevation).toBeCloseTo(5.4, 9);

    // An upper floor drawn smaller stays where it is drawn, over the floor below.
    const loft = apply(doc, { type: "createOutline", levelId: floor(doc, 2).id, outline: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 7 }, { x: 2, y: 7 }], externalThickness: 0.3, wallHeight: 2.4 });
    const box = env(floor(loft, 2)).outsideRect;
    expect([box.minX, box.minY, box.maxX, box.maxY].map((v) => Math.round(v * 1000) / 1000)).toEqual([2, 2, 8, 7]);
    expect(reject(doc, { type: "createOutline", levelId: floor(doc, 2).id, outline: [{ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 7 }, { x: 2, y: 7 }], externalThickness: 0.3, wallHeight: 2.4 })[0].code).toBe("level-overhang");
  });

  it("keeps the garden side the same on every floor", () => {
    const doc = twoStorey(newOutlineHouse(OUTLINES.L));
    const east = facing(floor(doc, 0), "east");
    const set = apply(doc, { type: "setRearWall", wallId: east });
    expect(env(floor(set, 1)).sideOfWall[floor(set, 1).rearWallId!]).toBe("east");
    const upper = apply(set, { type: "setRearWall", wallId: facing(floor(set, 1), "west") });
    expect(env(floor(upper, 0)).sideOfWall[floor(upper, 0).rearWallId!]).toBe("west");
  });

  it("keeps every floor valid and inside the one below through random pushes and pulls", () => {
    const random = seeded(7);
    const starts = [twoStorey(newHouse(12, 9)), apply(twoStorey(newOutlineHouse(OUTLINES.L)), { type: "addLevel" })];
    let applied = 0;
    for (const start of starts) {
      let doc = start;
      for (let step = 0; step < 120; step++) {
        const i = Math.floor(random() * doc.levels.length);
        const ids = floor(doc, i).envelope.wallIds;
        const wallId = ids[Math.floor(random() * ids.length)];
        const len = env(floor(doc, i)).edges.find((e) => e.wallId === wallId)!.axis.length;
        const outward = (Math.floor(random() * 9) - 4) * 0.5;
        const a = Math.round(random() * len * 2) / 2;
        const range = random() < 0.5 ? {} : { from: 0, to: Math.max(a, 0.5) };
        const result = applyCommand(doc, { type: "moveOutlineEdge", wallId, outward, ...range });
        if (!result.ok) continue;
        doc = result.document;
        applied++;
        expect(validateDocument(doc)).toEqual([]);
        for (let k = 1; k < doc.levels.length; k++) expect(overhang(doc, k)).toBeLessThan(1e-5);
      }
      expect(restack(doc)).toBe(doc);
      const parsed = parsePlanDocumentJson(serializePlanDocument(doc));
      expect(parsed.ok && parsed.document).toEqual(doc);
    }
    expect(applied).toBeGreaterThan(60);
  });
});

describe("files with several floors", () => {
  it("round-trips, and refuses floors that don't stack", () => {
    const doc = twoStorey();
    const parsed = parsePlanDocumentJson(serializePlanDocument(doc));
    expect(parsed.ok && parsed.document).toEqual(doc);

    const floating = { ...doc, levels: [floor(doc, 0), { ...floor(doc, 1), elevation: 5 }] };
    const bad = parsePlanDocumentJson(JSON.stringify(floating));
    expect(!bad.ok && bad.issues[0].code).toBe("level-stack");

    const shared = { ...doc, levels: [floor(doc, 0), { ...floor(doc, 1), id: floor(doc, 0).id }] };
    const clash = parsePlanDocumentJson(JSON.stringify(shared));
    expect(!clash.ok && clash.issues[0].message).toMatch(/both use the id/);
  });

  it("loads version 4 files as one-floor houses", () => {
    const v4 = { ...newHouse(), schemaVersion: 4 };
    const parsed = parsePlanDocumentJson(JSON.stringify(v4));
    expect(parsed.ok && parsed.document).toEqual(newHouse());
  });

  it("loads version 5 files unchanged, and takes wood boards as a floor from version 6", () => {
    const v5 = { ...newHouse(), schemaVersion: 5 };
    const parsed = parsePlanDocumentJson(JSON.stringify(v5));
    expect(parsed.ok && parsed.document).toEqual(newHouse());
    const house = newHouse();
    const roomId = Object.keys(house.levels[0].rooms)[0];
    const boards = { ...house, levels: [{ ...house.levels[0], rooms: { [roomId]: { ...house.levels[0].rooms[roomId], floorMaterial: "boards" } } }] };
    const loaded = parsePlanDocumentJson(JSON.stringify(boards));
    expect(loaded.ok && loaded.document.levels[0].rooms[roomId].floorMaterial).toBe("boards");
  });
});
