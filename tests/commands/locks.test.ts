import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { parsePlanDocumentJson, pinnedRoomChanges, serializePlanDocument, type PlanCommand } from "@/domain/commands";
import { roomAtPoint } from "@/domain/design/analysis";
import type { RoomGoal } from "@/domain/design/intent";
import { planLayouts } from "@/domain/design/stripPlanner";
import type { Furniture, Opening, PlanDocument } from "@/domain/plan/types";
import { AXIS, addWall, apply, level, newHouse, reject } from "../helpers";

const door = (id: string, wallId: string, offset: number): Opening => ({
  id,
  wallId,
  kind: "door",
  offset,
  width: 0.9,
  height: 2.1,
  hinge: "start",
  swingSide: "left",
});

const sofa: Furniture = { id: "sofa", kind: "sofa_3", position: { x: 1.5, y: 3.5 }, rotation: 0, width: 2, depth: 0.9, height: 0.8 };

/**
 * Four rooms: south-west (with a stub wall and a door to the north-west
 * room), north-west, and the east side split in two.
 */
function house(): PlanDocument {
  let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
  doc = addWall(doc, "h", [AXIS.west, 5], [4, 5]);
  doc = addWall(doc, "e", [4, 6], [AXIS.east, 6]);
  doc = addWall(doc, "s", [2, AXIS.south], [2, 2]);
  return apply(doc, { type: "addOpening", opening: door("d1", "h", 1) });
}

const roomAt = (doc: PlanDocument, x: number, y: number) => roomAtPoint(level(doc), { x, y })!;
const pin = (doc: PlanDocument, roomId: string, name?: string) =>
  apply(doc, { type: "updateRoom", roomId, changes: name ? { locked: true, name } : { locked: true } });

/** The house with its south-west room named "Bedroom 2" and pinned. */
function pinned() {
  const doc = house();
  const id = roomAt(doc, 1, 1);
  return { doc: pin(doc, id, "Bedroom 2"), id };
}

describe("pinned rooms", () => {
  it("refuses every edit that would change a pinned room's shape", () => {
    const { doc, id } = pinned();
    const west = level(doc).envelope.wallIds.find((w) => {
      const wall = level(doc).walls[w];
      return level(doc).vertices[wall.startVertexId].x < 0.2 && level(doc).vertices[wall.endVertexId].x < 0.2;
    })!;
    const commands: PlanCommand[] = [
      { type: "moveWall", wallId: "h", delta: 0.5 },
      { type: "moveWall", wallId: "v", delta: 0.3 },
      { type: "moveWallEndpoint", wallId: "s", end: "end", position: 3 },
      { type: "addWall", start: { x: AXIS.west, y: 3 }, end: { x: 4, y: 3 }, thickness: 0.1 },
      { type: "deleteWall", wallId: "h" },
      { type: "moveOutlineEdge", wallId: west, outward: 0.5 },
      { type: "updateWall", wallId: "h", thickness: 0.2 },
    ];
    for (const command of commands) {
      const issues = reject(doc, command);
      expect(issues[0], command.type).toMatchObject({ code: "room-pinned", message: "Bedroom 2 is pinned. Unpin it to change it.", entityIds: [id] });
    }
  });

  it("refuses a resize that moves a pinned room's wall, and allows one that doesn't", () => {
    const { doc } = pinned();
    expect(apply(doc, { type: "resizeFootprint", depth: 11 })).toBeTruthy();
    const east = pin(doc, roomAt(doc, 6, 3));
    expect(reject(east, { type: "resizeFootprint", width: 9 })[0].code).toBe("room-pinned");
  });

  it("refuses adding, moving, turning or removing doors and windows on a pinned room's walls", () => {
    const { doc } = pinned();
    const south = level(doc).envelope.wallIds[0];
    const window: Opening = { id: "w1", wallId: south, kind: "window", offset: 0.4, width: 1.2, height: 1.2, sillHeight: 0.9 };
    const commands: PlanCommand[] = [
      { type: "addOpening", opening: window },
      { type: "updateOpening", openingId: "d1", changes: { offset: 1.5 } },
      { type: "updateOpening", openingId: "d1", changes: { swingSide: "right" } },
      { type: "deleteOpening", openingId: "d1" },
    ];
    for (const command of commands) expect(reject(doc, command)[0].code, command.type).toBe("room-pinned");
  });

  it("lets furniture move freely in a pinned room", () => {
    let { doc } = pinned();
    doc = apply(doc, { type: "addFurniture", item: sofa });
    doc = apply(doc, { type: "updateFurniture", furnitureId: "sofa", changes: { position: { x: 1.6, y: 3.6 }, rotation: 90 } });
    doc = apply(doc, { type: "replaceFurniture", remove: ["sofa"], add: [{ ...sofa, id: "sofa-2" }] });
    doc = apply(doc, { type: "deleteFurniture", furnitureId: "sofa-2" });
    expect(level(doc).furniture).toEqual({});
  });

  it("allows edits elsewhere and keeps the pin through them", () => {
    const { doc, id } = pinned();
    const south = level(doc).envelope.wallIds[0];
    let next = apply(doc, { type: "moveWall", wallId: "e", delta: 0.5 });
    next = apply(next, { type: "addOpening", opening: door("d2", south, 5) });
    next = apply(next, { type: "resizeFootprint", width: 9 });
    next = apply(next, { type: "addWall", start: { x: 4, y: 8 }, end: { x: 9 - 0.15, y: 8 }, thickness: 0.1 });
    expect(level(next).rooms[id]).toMatchObject({ name: "Bedroom 2", locked: true });
  });

  it("can be unpinned, and then edited", () => {
    const { doc, id } = pinned();
    const unpinned = apply(doc, { type: "updateRoom", roomId: id, changes: { locked: false } });
    expect("locked" in level(unpinned).rooms[id]).toBe(false);
    expect(apply(unpinned, { type: "moveWall", wallId: "h", delta: 0.5 })).toBeTruthy();
    const cleared = apply(doc, { type: "updateRoom", roomId: id, changes: { locked: null } });
    expect("locked" in level(cleared).rooms[id]).toBe(false);
  });

  it("survives a JSON round trip, and files without pins still load", () => {
    const { doc, id } = pinned();
    const loaded = parsePlanDocumentJson(serializePlanDocument(doc));
    expect(loaded.ok && level(loaded.document).rooms[id].locked).toBe(true);

    const old = JSON.parse(serializePlanDocument(house()));
    for (const room of Object.values(old.levels[0].rooms) as Array<Record<string, unknown>>) expect("locked" in room).toBe(false);
    const reloaded = parsePlanDocumentJson(JSON.stringify(old));
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(apply(reloaded.document, { type: "moveWall", wallId: "h", delta: 0.5 })).toBeTruthy();
  });

  it("reports furniture changes only when asked", () => {
    const { doc } = pinned();
    const furnished = apply(doc, { type: "addFurniture", item: sofa });
    expect(pinnedRoomChanges(level(doc), level(furnished), { furniture: false })).toEqual([]);
    expect(pinnedRoomChanges(level(doc), level(furnished), { furniture: true })).toMatchObject([{ name: "Bedroom 2", what: "furniture" }]);
  });
});

describe("pinned rooms and the room planner", () => {
  const withRear = (doc = newHouse()) => apply(doc, { type: "setRearWall", wallId: level(doc).envelope.wallIds[2] });
  const layout = () => planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 1 }, source: withRear(), brief: DEFAULT_BRIEF, idPrefix: "t" }).candidates[0].document;
  const redesign = (doc: PlanDocument, roomId: string, goals: RoomGoal[]) =>
    planLayouts({ intent: { action: "redesign_room", roomId, goals }, source: doc, brief: DEFAULT_BRIEF, idPrefix: "r" });

  it("never offers an option that changes a pinned room", () => {
    const doc = layout();
    const primary = Object.values(level(doc).rooms).find((r) => r.type === "primary_bedroom")!;
    const free = redesign(doc, primary.id, ["make_larger", "make_smaller"]).candidates;
    const neighbour = free.flatMap((c) => c.changedRoomIds ?? []).find((rid) => rid !== primary.id)!;
    expect(neighbour).toBeTruthy();

    const held = pin(doc, neighbour);
    const result = redesign(held, primary.id, ["make_larger", "make_smaller"]);
    for (const c of result.candidates) {
      expect(pinnedRoomChanges(level(held), level(c.document), { furniture: true })).toEqual([]);
      expect(c.changedRoomIds).not.toContain(neighbour);
    }
  });

  it("asks for a pinned room to be unpinned before redesigning it", () => {
    const doc = layout();
    const primary = Object.values(level(doc).rooms).find((r) => r.type === "primary_bedroom")!;
    const result = redesign(pin(doc, primary.id), primary.id, ["make_larger"]);
    expect(result.candidates).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: "room-pinned", message: `Unpin ${primary.name} to redesign it.` });
  });
});
