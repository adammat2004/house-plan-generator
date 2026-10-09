import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { describeEntity, loadPlanDocument, parsePlanDocumentJson, serializePlanDocument, validateDocument } from "@/domain/commands";
import { planLayouts } from "@/domain/design/stripPlanner";
import { roomAtPoint } from "@/domain/design/analysis";
import { canFurnish, furnishPlan, furnishRoom } from "@/domain/furniture/furnish";
import { backDirection, furnitureRect, toLocal, toPlan, turn } from "@/domain/furniture/geometry";
import { furnitureIssues } from "@/domain/furniture/issues";
import type { Furniture, PlanDocument, RoomType } from "@/domain/plan/types";
import { AXIS, addWall, apply, level, newHouse, reject } from "../helpers";

const sofa = (over: Partial<Furniture> = {}): Furniture => ({
  id: "sofa",
  kind: "sofa_3",
  position: { x: 2, y: 2 },
  rotation: 0,
  width: 2.1,
  depth: 0.9,
  height: 0.85,
  ...over,
});

/** One room of the given type (5 × 4 m clear by default), with a door in its south wall. */
function singleRoom(type: RoomType, width = 5.3, depth = 4.3): PlanDocument {
  let doc = newHouse(width, depth);
  const roomId = Object.keys(level(doc).rooms)[0];
  doc = apply(doc, { type: "updateRoom", roomId, changes: { type } });
  const south = level(doc).envelope.wallIds[0];
  return apply(doc, {
    type: "addOpening",
    opening: { id: "door", wallId: south, kind: "door", offset: 0.6, width: 0.9, height: 2.1, hinge: "start", swingSide: "left" },
  });
}

const kinds = (items: Furniture[]) => items.map((f) => f.kind).sort();

function furnished(doc: PlanDocument): PlanDocument {
  const roomId = Object.keys(level(doc).rooms)[0];
  const result = furnishRoom(level(doc), roomId, "t")!;
  return apply(doc, { type: "replaceFurniture", remove: result.remove, add: result.items });
}

describe("furniture geometry", () => {
  it("maps between the item's frame and the plan for every quarter turn", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const item = { position: { x: 3, y: 4 }, rotation };
      const p = toPlan(item, { x: 0.5, y: 0.2 });
      expect(toLocal(item, p).x).toBeCloseTo(0.5);
      expect(toLocal(item, p).y).toBeCloseTo(0.2);
      const back = toPlan(item, { x: 0, y: 1 });
      expect(back.x - 3).toBeCloseTo(backDirection(rotation).x);
      expect(back.y - 4).toBeCloseTo(backDirection(rotation).y);
    }
    expect(furnitureRect(sofa({ rotation: 90 }))).toEqual({ minX: 1.55, minY: 0.95, maxX: 2.45, maxY: 3.05 });
    expect(turn(0, -1)).toBe(270);
    expect(turn(270, 1)).toBe(0);
  });
});

describe("furniture commands", () => {
  it("adds, moves, turns, resizes and deletes furniture as ordinary undoable edits", () => {
    let doc = apply(newHouse(), { type: "addFurniture", item: sofa() });
    expect(level(doc).furniture.sofa.kind).toBe("sofa_3");
    expect(describeEntity(level(doc), "sofa")).toBe("Three-seat sofa");
    doc = apply(doc, { type: "updateFurniture", furnitureId: "sofa", changes: { position: { x: 3.1234, y: 2 }, rotation: 90, width: 1.8 } });
    expect(level(doc).furniture.sofa).toMatchObject({ position: { x: 3.123, y: 2 }, rotation: 90, width: 1.8 });
    doc = apply(doc, { type: "deleteFurniture", furnitureId: "sofa" });
    expect(level(doc).furniture).toEqual({});
  });

  it("refuses bad values but never refuses an awkward spot", () => {
    const doc = newHouse();
    expect(reject(doc, { type: "addFurniture", item: sofa({ width: 0 }) })[0].code).toBe("invalid-value");
    expect(reject(doc, { type: "addFurniture", item: sofa({ rotation: 45 as 0 }) })[0].code).toBe("invalid-value");
    expect(reject(doc, { type: "addFurniture", item: sofa({ id: level(doc).envelope.wallIds[0] }) })[0].code).toBe("invalid-value");
    // Straddling the outside wall is allowed, and reported.
    const outside = apply(doc, { type: "addFurniture", item: sofa({ position: { x: 0.2, y: 3 } }) });
    expect(furnitureIssues(level(outside)).get("sofa")).toBe("wall");
  });

  it("keeps furniture where it is when walls move", () => {
    let doc = apply(newHouse(), { type: "addFurniture", item: sofa({ position: { x: 6, y: 2 } }) });
    doc = addWall(doc, "v", [4, AXIS.south], [4, AXIS.north]);
    doc = apply(doc, { type: "moveWall", wallId: "v", delta: 1 });
    expect(level(doc).furniture.sofa.position).toEqual({ x: 6, y: 2 });
    expect(furnitureIssues(level(doc)).get("sofa")).toBe("wall");
  });

  it("round-trips furniture through the file format and upgrades version 2 plans", () => {
    const doc = apply(newHouse(), { type: "addFurniture", item: sofa() });
    const parsed = parsePlanDocumentJson(serializePlanDocument(doc));
    expect(parsed.ok && parsed.document).toEqual(doc);
    const v2Level: Record<string, unknown> = { ...level(newHouse()) };
    delete v2Level.furniture;
    const loaded = loadPlanDocument({ ...newHouse(), schemaVersion: 2, levels: [v2Level] });
    expect(loaded.ok && level(loaded.document).furniture).toEqual({});
  });
});

describe("furnishing a room", () => {
  it.each<[RoomType, string[]]>([
    ["bedroom", ["bed_double", "wardrobe"]],
    ["primary_bedroom", ["bed_king", "wardrobe"]],
    ["living", ["sofa_3", "coffee_table", "tv_unit"]],
    ["kitchen", ["kitchen_run", "fridge"]],
    ["kitchen_dining", ["kitchen_run", "dining_set_6"]],
    ["dining", ["dining_set_6"]],
    ["office", ["desk"]],
    ["utility", ["washing_machine"]],
  ])("lays out a %s with its main pieces, all clear of walls, doors and each other", (type, expected) => {
    const doc = furnished(singleRoom(type));
    const items = Object.values(level(doc).furniture);
    for (const kind of expected) expect(kinds(items)).toContain(kind);
    expect([...furnitureIssues(level(doc))]).toEqual([]);
    expect(validateDocument(doc)).toEqual([]);
  });

  it("fits a bathroom with a bath, toilet and basin, and an ensuite with a shower", () => {
    const bath = Object.values(level(furnished(singleRoom("bathroom", 2.9, 2.6))).furniture);
    expect(kinds(bath)).toEqual(expect.arrayContaining(["bath", "basin", "toilet"]));
    const ensuite = Object.values(level(furnished(singleRoom("ensuite", 2.8, 2.6))).furniture);
    expect(kinds(ensuite)).toEqual(expect.arrayContaining(["basin", "shower", "toilet"]));
  });

  it("puts the bed against a wall without the door, with bedside tables either side", () => {
    const doc = furnished(singleRoom("bedroom"));
    const items = Object.values(level(doc).furniture);
    const bed = items.find((f) => f.kind === "bed_double")!;
    // The door is in the south wall, so the bed's back isn't to the south.
    expect(backDirection(bed.rotation)).not.toEqual({ x: 0, y: -1 });
    expect(items.filter((f) => f.kind === "bedside_table")).toHaveLength(2);
  });

  it("reports what doesn't fit instead of overlapping", () => {
    const doc = singleRoom("bedroom", 2.2, 2);
    const result = furnishRoom(level(doc), Object.keys(level(doc).rooms)[0], "t")!;
    expect(result.missing).toContain("bed_single");
    expect(result.items.filter((f) => f.kind.startsWith("bed_"))).toEqual([]);
  });

  it("replaces what was in the room and leaves rooms of other types alone", () => {
    const once = furnished(singleRoom("living"));
    const twice = furnished(once);
    expect(Object.keys(level(twice).furniture)).toHaveLength(Object.keys(level(once).furniture).length);
    expect(canFurnish("hall")).toBe(false);
  });

  it("furnishes every generated layout without problems", () => {
    const source = apply(newHouse(10, 12), { type: "setRearWall", wallId: level(newHouse(10, 12)).envelope.wallIds[2] });
    const result = planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3 }, source, brief: DEFAULT_BRIEF, idPrefix: "t" });
    for (const candidate of result.candidates) {
      const doc = furnishPlan(candidate.document, "f");
      const lvl = level(doc);
      expect(Object.keys(lvl.furniture).length).toBeGreaterThan(10);
      expect([...furnitureIssues(lvl)]).toEqual([]);
      for (const room of Object.values(lvl.rooms)) {
        if (room.type === "primary_bedroom" || room.type === "bedroom") {
          expect(Object.values(lvl.furniture).some((f) => f.kind.startsWith("bed_") && roomAtPoint(lvl, f.position) === room.id)).toBe(true);
        }
      }
    }
  });
});
