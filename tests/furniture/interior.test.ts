import { describe, expect, it } from "vitest";
import { loadPlanDocument, parsePlanDocumentJson, serializePlanDocument } from "@/domain/commands";
import { renderKey, renderPrompt, renderViewFor, DEFAULT_INTERIOR_STYLE } from "@/domain/design/renderRequest";
import { furnishRoom } from "@/domain/furniture/furnish";
import { furnitureIssues } from "@/domain/furniture/issues";
import { furnitureInRoom } from "@/domain/furniture/layout";
import { deriveRoomRegions, roomFaceIndices } from "@/domain/geometry/derive";
import { applyCommands, furnishInStyle, furnishInStyleCommands } from "@/domain/interior/furnishInStyle";
import { setRoomFinishes } from "@/domain/interior/finishes";
import { INTERIOR_STYLES, WALL_COLOURS } from "@/domain/plan/schema";
import type { PlanDocument, RoomType } from "@/domain/plan/types";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { buildHouseModel, type HouseModelOptions } from "@/editor/rendering/three/houseModel";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { apply, level, newHouse, reject } from "../helpers";

/** One room of the given type with a door in its south wall. */
function singleRoom(type: RoomType, width = 5.3, depth = 4.3): PlanDocument {
  let doc = newHouse(width, depth);
  const roomId = Object.keys(level(doc).rooms)[0];
  doc = apply(doc, { type: "updateRoom", roomId, changes: { type } });
  const south = level(doc).envelope.wallIds[0];
  return apply(doc, { type: "addOpening", opening: { id: "door", wallId: south, kind: "door", offset: 0.6, width: 0.9, height: 2.1, hinge: "start", swingSide: "left" } });
}

const roomIdOf = (doc: PlanDocument) => Object.keys(level(doc).rooms)[0];
const layoutOf = (doc: PlanDocument) =>
  Object.values(level(doc).furniture)
    .map((f) => [f.kind, f.position.x, f.position.y, f.rotation])
    .sort();
const OPTIONS: HouseModelOptions = { cutaway: false, roof: false, dimensions: false, landscape: false, furniture: false };

describe("room finishes", () => {
  it("sets and clears wall paint and a room's own style, and refuses unknown values", () => {
    const doc = singleRoom("living");
    const id = roomIdOf(doc);
    const painted = setRoomFinishes(doc, id, { wallColour: "sage", interiorStyle: "coastal", floorMaterial: "stone" })!;
    expect(level(painted).rooms[id]).toMatchObject({ wallColour: "sage", interiorStyle: "coastal", floorMaterial: "stone" });
    const cleared = setRoomFinishes(painted, id, { wallColour: null, interiorStyle: null })!;
    expect(level(cleared).rooms[id].wallColour).toBeUndefined();
    expect(level(cleared).rooms[id].interiorStyle).toBeUndefined();
    expect(level(cleared).rooms[id].floorMaterial).toBe("stone");
    expect(setRoomFinishes(doc, "nope", { wallColour: "sage" })).toBeNull();
    expect(reject(doc, { type: "updateRoom", roomId: id, changes: { wallColour: "puce" as never } })[0].code).toBe("invalid-value");
    expect(reject(doc, { type: "updateRoom", roomId: id, changes: { interiorStyle: "baroque" as never } })[0].code).toBe("invalid-value");
  });

  it("keeps saved plans without finishes loading unchanged, and round-trips the new fields", () => {
    const doc = singleRoom("bedroom");
    const id = roomIdOf(doc);
    const plain = parsePlanDocumentJson(serializePlanDocument(doc));
    expect(plain.ok).toBe(true);
    if (plain.ok) {
      expect(plain.document.schemaVersion).toBe(doc.schemaVersion);
      expect(level(plain.document).rooms[id]).not.toHaveProperty("wallColour");
    }
    const painted = setRoomFinishes(doc, id, { wallColour: "navy", interiorStyle: "industrial" })!;
    const again = loadPlanDocument(JSON.parse(serializePlanDocument(painted)));
    expect(again.ok).toBe(true);
    if (again.ok) expect(level(again.document).rooms[id]).toMatchObject({ wallColour: "navy", interiorStyle: "industrial" });
  });

  it("offers ten paints and the six interior styles", () => {
    expect(WALL_COLOURS).toHaveLength(10);
    expect(INTERIOR_STYLES).toHaveLength(6);
  });
});

describe("furnish in a style", () => {
  it("is deterministic, and seed 0 is the usual layout", () => {
    const doc = singleRoom("living", 7.3, 5.3);
    const id = roomIdOf(doc);
    const a = furnishInStyle(doc, { style: "scandinavian", roomIds: [id], idPrefix: "x" })!;
    const b = furnishInStyle(doc, { style: "scandinavian", roomIds: [id], idPrefix: "x" })!;
    expect(layoutOf(a.document)).toEqual(layoutOf(b.document));
    const usual = furnishRoom(level(doc), id, `x-${id}`)!;
    const round = (r: (string | number)[]) => r.map((v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v));
    expect(layoutOf(a.document).map(round)).toEqual(
      usual.items.map((f) => [f.kind, f.position.x, f.position.y, f.rotation]).sort().map(round),
    );
    expect(level(a.document).rooms[id].interiorStyle).toBe("scandinavian");
  });

  it("gives other arrangements for other seeds, all of them valid", () => {
    const doc = singleRoom("living", 7.3, 5.3);
    const id = roomIdOf(doc);
    const layouts = [0, 1, 2, 3, 4, 5].map((seed) => {
      const result = furnishInStyle(doc, { style: "modern", roomIds: [id], seed, idPrefix: "x" })!;
      expect(furnitureIssues(level(result.document)).size).toBe(0);
      expect(furnitureInRoom(level(result.document), id).length).toBeGreaterThan(2);
      return JSON.stringify(layoutOf(result.document));
    });
    expect(new Set(layouts).size).toBeGreaterThan(1);
    const again = furnishInStyle(doc, { style: "modern", roomIds: [id], seed: 3, idPrefix: "x" })!;
    expect(JSON.stringify(layoutOf(again.document))).toBe(layouts[3]);
  });

  it("replaces what was in the room and skips rooms it can't furnish", () => {
    const doc = singleRoom("bedroom");
    const id = roomIdOf(doc);
    const first = furnishInStyle(doc, { style: "modern", idPrefix: "a" })!;
    const second = furnishInStyle(first.document, { style: "farmhouse", seed: 1, idPrefix: "b" })!;
    expect(Object.keys(level(second.document).furniture).every((key) => key.startsWith("b-"))).toBe(true);
    const hall = singleRoom("hall");
    expect(furnishInStyleCommands(hall, { style: "modern", roomIds: [roomIdOf(hall)], idPrefix: "c" })).toBeNull();
    expect(level(second.document).rooms[id].interiorStyle).toBe("farmhouse");
  });

  it("applies as one undoable step in the editor", () => {
    const doc = singleRoom("bedroom");
    const stores = createEditorStores(doc);
    const actions = createEditorActions(stores);
    const present = () => stores.documents.getState().history.present;
    const before = present();
    expect(actions.furnishInStyle("coastal")).toBe(true);
    expect(Object.keys(level(present()).furniture).length).toBeGreaterThan(0);
    expect(level(present()).rooms[roomIdOf(doc)].interiorStyle).toBe("coastal");
    expect(actions.undo()).toBe(true);
    expect(present()).toEqual(before);
  });

  it("refuses the whole batch if one command fails", () => {
    const doc = singleRoom("bedroom");
    const result = furnishInStyleCommands(doc, { style: "modern", idPrefix: "z" })!;
    expect(applyCommands(doc, [...result.commands, { type: "updateRoom", roomId: "missing", changes: { wallColour: "sage" } }])).toBeNull();
  });
});

describe("photos follow the finishes", () => {
  const target = (doc: PlanDocument) => ({ kind: "room" as const, roomId: roomIdOf(doc) });

  it("marks a photo out of date when the paint or the room's style changes, and not otherwise", () => {
    const doc = singleRoom("living");
    const id = roomIdOf(doc);
    const key = (d: PlanDocument) => renderKey(d, target(doc), DEFAULT_APPEARANCE, DEFAULT_INTERIOR_STYLE);
    const base = key(doc);
    const sage = setRoomFinishes(doc, id, { wallColour: "sage" })!;
    expect(key(sage)).not.toBe(base);
    expect(key(setRoomFinishes(sage, id, { wallColour: "clay" })!)).not.toBe(key(sage));
    expect(key(setRoomFinishes(sage, id, { wallColour: null })!)).toBe(base);
    expect(key(setRoomFinishes(doc, id, { interiorStyle: "coastal" })!)).not.toBe(base);
    expect(key(setRoomFinishes(doc, id, { interiorStyle: DEFAULT_INTERIOR_STYLE })!)).toBe(base);
  });

  it("puts the paint and the room's own style in the prompt", () => {
    const doc = setRoomFinishes(singleRoom("bedroom"), roomIdOf(singleRoom("bedroom")), { wallColour: "navy", interiorStyle: "coastal" })!;
    const view = renderViewFor(doc, target(doc), DEFAULT_APPEARANCE)!;
    const prompt = renderPrompt(view, "modern");
    expect(prompt).toContain("deep navy blue");
    expect(prompt).toContain("coastal");
    expect(renderPrompt(renderViewFor(singleRoom("bedroom"), target(doc), DEFAULT_APPEARANCE)!, "modern")).not.toContain("painted");
  });
});

describe("painted walls in 3D", () => {
  it("paints only the face that looks into the painted room", () => {
    const doc = singleRoom("living");
    const id = roomIdOf(doc);
    const lvl = level(setRoomFinishes(doc, id, { wallColour: "sage" })!);
    const region = deriveRoomRegions(lvl)[roomFaceIndices(lvl).get(id) ?? -1];
    const inside = region.labelPoint;
    const walls = buildHouseModel(lvl, OPTIONS).boxes.filter((b) => b.kind === "wall");
    const painted = walls.filter((b) => b.paint);
    expect(painted.length).toBeGreaterThan(3);
    for (const box of painted) {
      const face = { x: Math.sin(box.angle), y: -Math.cos(box.angle) };
      const towardRoom = (inside.x - box.center.x) * face.x + (inside.y - box.center.y) * face.y > 0;
      expect(box.paint![0] !== undefined).toBe(towardRoom);
      expect(box.paint![1] !== undefined).toBe(!towardRoom);
    }
    expect(buildHouseModel(level(doc), OPTIONS).boxes.some((b) => b.paint)).toBe(false);
  });
});
