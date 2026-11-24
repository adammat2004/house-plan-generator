import { describe, expect, it } from "vitest";
import { createToolRegistry } from "@/domain/agent/registry";
import { builtinTools } from "@/domain/agent/tools";
import type { ToolOutcome } from "@/domain/agent/types";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { roomBounds, roomConnections } from "@/domain/design/analysis";
import type { PlanDocument } from "@/domain/plan/types";
import { addWall, level, newHouse, rooms } from "../helpers";

/** An 8 × 10 m house: a south room, and the north half split into west and east rooms. */
function house(): PlanDocument {
  let doc = newHouse(8, 10);
  doc = addWall(doc, "mid", [0.15, 5], [7.85, 5]);
  doc = addWall(doc, "split", [4, 5], [4, 9.85]);
  return doc;
}

const registry = createToolRegistry(builtinTools);
let n = 0;
function call(document: PlanDocument, name: string, input: unknown): ToolOutcome {
  const tool = registry.get(name)!;
  return tool.run({ document, brief: DEFAULT_BRIEF, idPrefix: `t${++n}-` }, tool.input.parse(input));
}
function changed(document: PlanDocument, name: string, input: unknown) {
  const out = call(document, name, input);
  if (!out.ok || out.kind !== "change") throw new Error(`${name} failed: ${out.ok ? "not a change" : out.message}`);
  expect(validateDocument(out.document)).toEqual([]);
  return out;
}

describe("agent tools", () => {
  it("lists every tool as a JSON schema for the model", () => {
    const defs = registry.definitions();
    expect(defs.map((d) => d.name)).toContain("add_room");
    for (const d of defs) {
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.input_schema.type).toBe("object");
    }
  });

  it("refuses two tools of one name", () => {
    expect(() => createToolRegistry([...builtinTools, builtinTools[0]])).toThrow(/rename_room/);
  });

  it("renames and retypes a room, and swaps two", () => {
    const doc = house();
    const [south, west, east] = rooms(doc);
    expect(changed(doc, "rename_room", { roomId: south.id, name: "Studio" }).summary).toMatch(/Studio/);
    const typed = changed(doc, "set_room_type", { roomId: south.id, type: "bedroom" });
    expect(level(typed.document).rooms[south.id].type).toBe("bedroom");
    const swapped = changed(typed.document, "swap_rooms", { roomA: south.id, roomB: west.id });
    expect(level(swapped.document).rooms[west.id].type).toBe("bedroom");
    expect(level(swapped.document).rooms[south.id].name).toBe(west.name);
    expect(east.id).not.toBe(west.id);
  });

  it("explains an unknown room so the model can correct itself", () => {
    const out = call(house(), "rename_room", { roomId: "nope", name: "X" });
    expect(out).toMatchObject({ ok: false, code: "not-found" });
    expect(out.ok ? "" : out.message).toMatch(/plan summary/);
  });

  it("resizes a room by moving the wall it shares with a neighbour", () => {
    const doc = house();
    const south = rooms(doc)[0];
    const before = roomBounds(level(doc), south.id)!;
    const out = changed(doc, "resize_room", { roomId: south.id, depthM: before.maxY - before.minY + 1 });
    const after = roomBounds(level(out.document), south.id)!;
    expect(after.maxY - after.minY).toBeCloseTo(before.maxY - before.minY + 1, 2);
    expect(out.summary).toMatch(/was/);
  });

  it("says why a room can't be resized against an outside wall", () => {
    const doc = house();
    const south = rooms(doc)[0];
    const out = call(doc, "resize_room", { roomId: south.id, widthM: 6 });
    expect(out).toMatchObject({ ok: false });
  });

  it("partitions a corner off a room as a new room with a door", () => {
    const doc = house();
    const south = rooms(doc)[0];
    const before = Object.keys(level(doc).rooms).length;
    const out = changed(doc, "add_room", { fromRoomId: south.id, corner: "south_west", widthM: 1.1, depthM: 1.8, type: "wc" });
    expect(Object.keys(level(out.document).rooms)).toHaveLength(before + 1);
    const newId = out.data!.newRoomId as string;
    const wc = level(out.document).rooms[newId];
    expect(wc.type).toBe("wc");
    expect(roomConnections(level(out.document), newId).some((c) => c.kind === "door")).toBe(true);
    expect(level(out.document).rooms[south.id].type).toBe(level(doc).rooms[south.id].type);
  });

  it("won't take more of a room than it can spare", () => {
    const doc = house();
    const out = call(doc, "add_room", { fromRoomId: rooms(doc)[0].id, corner: "south_west", widthM: 6, depthM: 5, type: "office" });
    expect(out).toMatchObject({ ok: false });
  });

  it("adds a window to an outside wall and says no to an inside one", () => {
    const doc = house();
    const south = rooms(doc)[0];
    const out = changed(doc, "add_window", { roomId: south.id, side: "south" });
    expect(roomConnections(level(out.document), south.id).filter((c) => c.kind === "window")).toHaveLength(roomConnections(level(doc), south.id).filter((c) => c.kind === "window").length + 1);
    expect(call(doc, "add_window", { roomId: south.id, side: "north" })).toMatchObject({ ok: false, code: "no-outside-wall" });
  });

  it("adds a door between neighbours, and out of the house", () => {
    const doc = house();
    const [south, west, east] = rooms(doc);
    const between = changed(doc, "add_door", { roomId: west.id, toRoomId: east.id });
    expect(roomConnections(level(between.document), west.id).some((c) => c.kind === "door" && c.target.kind === "room" && c.target.roomId === east.id)).toBe(true);
    expect(call(doc, "add_door", { roomId: south.id, toRoomId: "nope" })).toMatchObject({ ok: false });
    const out = changed(doc, "add_door", { roomId: south.id, side: "south" });
    expect(roomConnections(level(out.document), south.id).some((c) => c.kind === "door" && c.target.kind !== "room")).toBe(true);
  });

  it("removes an opening and merges two rooms", () => {
    const doc = house();
    const [south, west, east] = rooms(doc);
    const windowed = changed(doc, "add_window", { roomId: south.id, side: "south" });
    const opening = roomConnections(level(windowed.document), south.id).find((c) => c.kind === "window")!;
    const removed = changed(windowed.document, "remove_opening", { openingId: opening.openingId });
    expect(Object.keys(level(removed.document).openings)).toHaveLength(Object.keys(level(doc).openings).length);
    const merged = changed(doc, "merge_rooms", { roomA: west.id, roomB: east.id });
    expect(Object.keys(level(merged.document).rooms)).toHaveLength(2);
  });

  it("adds a floor, and records what it can't do", () => {
    const doc = house();
    expect(changed(doc, "add_floor", {}).document.levels).toHaveLength(2);
    expect(call(doc, "report_unsupported", { request: "paint it blue", reason: "no colour tool" })).toMatchObject({ ok: true, kind: "unsupported" });
  });

  it("redesigns a room towards a goal through the room planner, or says why not", () => {
    const doc = house();
    const out = call(doc, "improve_room", { roomId: rooms(doc)[0].id, goal: "make_larger" });
    if (out.ok) {
      expect(out.kind).toBe("change");
      if (out.kind === "change") expect(validateDocument(out.document)).toEqual([]);
    } else expect(out.message.length).toBeGreaterThan(10);
  });
});
