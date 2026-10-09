import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { roomAtPoint, roomConnections } from "@/domain/design/analysis";
import { planRegion } from "@/domain/design/regionPlanner";
import { assessSense, findingsFor } from "@/domain/design/sense";
import { planLayouts } from "@/domain/design/stripPlanner";
import { deriveLevelGeometry, openingPlacement } from "@/domain/geometry/derive";
import { axialParam, distanceToAxis } from "@/domain/geometry/walls";
import type { Opening, PlanDocument, Point2, RoomType } from "@/domain/plan/types";
import { addWall, apply, envelope, level, newHouse } from "../helpers";

/**
 * A 10 × 8 m house, garden to the north:
 *
 *   ┌──────────┬───────┬──────────────┐ y 7.85 (garden)
 *   │ Bedroom A│ Bath  │  Bedroom B   │  ← the selection
 *   ├──door────┴─door──┴────door──────┤ y 4.3
 *   front ─►            Hall          │ y 3.1
 *   ├─────────────door────────────────┤
 *   │              Living             │
 *   └─────────────────────────────────┘ y 0.15 (street)
 */
const AX = { west: 0.15, east: 9.85, south: 0.15, north: 7.85 };

function at(doc: PlanDocument, p: Point2, kind: "door" | "window", width = 0.9): Opening {
  const geometry = deriveLevelGeometry(level(doc));
  const axis = [...geometry.axes.values()].find((a) => distanceToAxis(a, p) < 1e-6 && axialParam(a, p) > 0 && axialParam(a, p) < a.length)!;
  const offset = axialParam(axis, p) - width / 2;
  const id = `${kind}-${p.x}-${p.y}`;
  return kind === "door" ? { id, wallId: axis.wallId, kind, offset, width, height: 2.1, hinge: "start", swingSide: "left" } : { id, wallId: axis.wallId, kind, offset, width, height: 1.2, sillHeight: 0.9 };
}
const add = (doc: PlanDocument, p: Point2, kind: "door" | "window", width?: number) => apply(doc, { type: "addOpening", opening: at(doc, p, kind, width) });
const name = (doc: PlanDocument, p: Point2, roomName: string, type: RoomType) => apply(doc, { type: "updateRoom", roomId: roomAtPoint(level(doc), p)!, changes: { name: roomName, type } });

function house(): PlanDocument {
  let doc = newHouse(10, 8);
  doc = apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
  doc = addWall(doc, "h1", [AX.west, 3.1], [AX.east, 3.1]);
  doc = addWall(doc, "h2", [AX.west, 4.3], [AX.east, 4.3]);
  doc = addWall(doc, "s1", [3.4, 4.3], [3.4, AX.north]);
  doc = addWall(doc, "s2", [5.4, 4.3], [5.4, AX.north]);
  doc = name(doc, { x: 5, y: 3.7 }, "Hall", "hall");
  doc = name(doc, { x: 5, y: 1.5 }, "Living Room", "living");
  doc = name(doc, { x: 1.7, y: 6 }, "Bedroom A", "bedroom");
  doc = name(doc, { x: 4.4, y: 6 }, "Bathroom", "bathroom");
  doc = name(doc, { x: 7.6, y: 6 }, "Bedroom B", "bedroom");
  for (const p of [{ x: AX.west, y: 3.7 }, { x: 5, y: 3.1 }, { x: 1.2, y: 4.3 }, { x: 4.4, y: 4.3 }, { x: 6.2, y: 4.3 }]) doc = add(doc, p, "door");
  for (const p of [{ x: 1.7, y: AX.north }, { x: 4.4, y: AX.north }, { x: 7.6, y: AX.north }, { x: 5, y: AX.south }]) doc = add(doc, p, "window", 0.8);
  return doc;
}

const idAt = (doc: PlanDocument, p: Point2) => roomAtPoint(level(doc), p)!;
const SELECTION = [{ x: 1.7, y: 6 }, { x: 4.4, y: 6 }, { x: 7.6, y: 6 }];
const opts = { idPrefix: "r", count: 3, doorWidth: 0.9 };
/** Rooms along the row from west to east. */
const row = (doc: PlanDocument) =>
  Object.values(level(doc).rooms)
    .filter((r) => r.seed.y > 4.3)
    .sort((a, b) => a.seed.x - b.seed.x)
    .map((r) => r.name);

describe("regenerate selection", () => {
  it("lays the selected rooms out again in another order, leaving the rest alone", () => {
    const source = house();
    const result = planRegion(source, SELECTION.map((p) => idAt(source, p)), opts);
    expect(result.issues).toEqual([]);
    expect(result.candidates.length).toBeGreaterThan(0);
    const before = level(source);
    for (const c of result.candidates) {
      const after = level(c.document);
      expect(validateDocument(c.document)).toEqual([]);
      expect(row(c.document).sort()).toEqual(["Bathroom", "Bedroom A", "Bedroom B"]);
      expect(row(c.document)).not.toEqual(["Bedroom A", "Bathroom", "Bedroom B"]);
      // Outside the selection, walls and openings are exactly as they were.
      for (const id of ["h1", "h2"]) expect(after.walls[id]).toEqual(before.walls[id]);
      const hall = idAt(source, { x: 5, y: 3.7 });
      expect(after.rooms[hall]).toEqual(before.rooms[hall]);
      // The front door, the living room's window and its door to the hall: everything south of the selection.
      const geometry = deriveLevelGeometry(before);
      const elsewhere = Object.values(before.openings).filter((o) => openingPlacement(geometry, o)!.centre.y < 4.3 - 0.01);
      expect(elsewhere.length).toBe(3);
      for (const o of elsewhere) expect(after.openings[o.id]).toEqual(o);
      // Every selected room is reached, lit and in proportion.
      const selected = new Set(Object.values(after.rooms).filter((r) => r.seed.y > 4.3).map((r) => r.id));
      const findings = findingsFor(assessSense(after), ["reachable", "daylight", "wet_room_privacy", "room_shape"]);
      expect(findings.filter((f) => f.roomIds.some((id) => selected.has(id)))).toEqual([]);
      for (const r of Object.values(after.rooms).filter((r) => r.seed.y > 4.3)) {
        expect(roomConnections(after, r.id).some((x) => x.kind === "door" && x.target.kind === "room" && x.target.name === "Hall"), r.name).toBe(true);
      }
    }
  });

  it("offers different options each time it's asked for more", () => {
    const source = house();
    const ids = SELECTION.map((p) => idAt(source, p));
    const first = planRegion(source, ids, opts).candidates;
    const more = planRegion(source, ids, { ...opts, exclude: new Set(first.map((c) => c.variant!)) }).candidates;
    for (const c of more) expect(first.map((f) => f.variant)).not.toContain(c.variant);
  });

  it("needs rooms that together make a rectangle", () => {
    const source = house();
    const result = planRegion(source, [idAt(source, { x: 1.7, y: 6 }), idAt(source, { x: 7.6, y: 6 })], opts);
    expect(result.candidates).toEqual([]);
    expect(result.issues[0].message).toMatch(/rectangle/);
  });

  it("refuses pinned rooms and the hall", () => {
    let source = house();
    source = apply(source, { type: "updateRoom", roomId: idAt(source, { x: 4.4, y: 6 }), changes: { locked: true } });
    const pinned = planRegion(source, SELECTION.map((p) => idAt(source, p)), opts);
    expect(pinned.issues[0]).toMatchObject({ code: "room-pinned", message: "Unpin Bathroom to lay it out again." });
    const hall = planRegion(house(), [idAt(house(), { x: 5, y: 3.7 }), idAt(house(), { x: 1.7, y: 6 })], opts);
    expect(hall.issues[0].message).toMatch(/hall/);
  });

  it("is what room variations of several rooms ask for", () => {
    const source = house();
    const roomIds = SELECTION.map((p) => idAt(source, p));
    const result = planLayouts({ intent: { action: "room_variations", roomIds, goals: [], count: 2 }, source, brief: DEFAULT_BRIEF, idPrefix: "v" });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].variant).toMatch(/^region:/);
  });
});
