import { describe, expect, it } from "vitest";
import { AXIS, addWall, apply, level, newHouse, rooms } from "../helpers";

describe("room reconciliation", () => {
  it("lets the largest-overlap child inherit metadata on a split", () => {
    let doc = newHouse();
    const original = Object.values(level(doc).rooms)[0];
    doc = apply(doc, { type: "updateRoom", roomId: original.id, changes: { name: "Open plan", type: "living" } });
    doc = addWall(doc, "split", [3, AXIS.south], [3, AXIS.north]);
    const [left, right] = rooms(doc);
    expect(right.id).toBe(original.id);
    expect(right).toMatchObject({ name: "Open plan", type: "living" });
    expect(left).toMatchObject({ name: "Room 1", type: "unspecified" });
    expect(left.id).not.toBe(original.id);
  });

  it("keeps the largest-overlap predecessor on a merge", () => {
    let doc = addWall(newHouse(), "split", [3, AXIS.south], [3, AXIS.north]);
    const [left, right] = rooms(doc);
    doc = apply(doc, { type: "updateRoom", roomId: left.id, changes: { name: "Kitchen", type: "kitchen" } });
    doc = apply(doc, { type: "updateRoom", roomId: right.id, changes: { name: "Living", type: "living" } });
    doc = apply(doc, { type: "deleteWall", wallId: "split" });
    const merged = rooms(doc);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: right.id, name: "Living", type: "living" });
  });

  it("preserves room names through ordinary wall edits", () => {
    let doc = addWall(newHouse(), "split", [3, AXIS.south], [3, AXIS.north]);
    const [left, right] = rooms(doc);
    doc = apply(doc, { type: "updateRoom", roomId: left.id, changes: { name: "Kitchen" } });
    doc = apply(doc, { type: "updateRoom", roomId: right.id, changes: { name: "Living" } });
    doc = apply(doc, { type: "moveWall", wallId: "split", delta: 1.5 });
    doc = apply(doc, { type: "resizeFootprint", width: 9.2, depth: 11 });
    doc = apply(doc, { type: "updateWall", wallId: "split", thickness: 0.15 });
    const after = rooms(doc);
    expect(after.map((r) => [r.id, r.name])).toEqual([
      [left.id, "Kitchen"],
      [right.id, "Living"],
    ]);
    // Seeds stay inside their regions.
    for (const room of Object.values(level(doc).rooms)) {
      expect(room.seed.x).toBeGreaterThan(0.15);
      expect(room.seed.x).toBeLessThan(9.05);
    }
  });

  it("moves a seed back inside its region when a wall sweeps past it", () => {
    let doc = addWall(newHouse(), "split", [3, AXIS.south], [3, AXIS.north]);
    const [, right] = rooms(doc);
    doc = apply(doc, { type: "updateRoom", roomId: right.id, changes: { name: "Living" } });
    const seedBefore = level(doc).rooms[right.id].seed;
    expect(seedBefore.x).toBeGreaterThan(3.75);
    doc = apply(doc, { type: "resizeFootprint", width: 3.9 });
    const after = rooms(doc);
    expect(after[1]).toMatchObject({ id: right.id, name: "Living" });
    const seedAfter = level(doc).rooms[right.id].seed;
    expect(seedAfter.x).toBeGreaterThan(3);
    expect(seedAfter.x).toBeLessThan(3.75);
  });

  it("assigns default names deterministically", () => {
    let doc = addWall(newHouse(), "a", [3, AXIS.south], [3, AXIS.north]);
    doc = addWall(doc, "b", [5, AXIS.south], [5, AXIS.north]);
    expect(rooms(doc).map((r) => r.name)).toEqual(["Room 2", "Room 3", "Room 1"]);
  });

  it("rejects empty room names and leaves the document unchanged", async () => {
    const doc = newHouse();
    const room = Object.values(level(doc).rooms)[0];
    const { applyCommand } = await import("@/domain/commands");
    const result = applyCommand(doc, { type: "updateRoom", roomId: room.id, changes: { name: "   " } });
    expect(result.ok).toBe(false);
    expect(level(doc).rooms[room.id].name).toBe("Room 1");
  });
});
