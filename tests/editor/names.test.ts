import { describe, expect, it } from "vitest";
import { friendlyName } from "@/editor/components/inspector/names";
import { apply, AXIS, level, newHouse } from "../helpers";

describe("what the inspector calls walls, doors and windows", () => {
  const house = () => {
    let doc = newHouse();
    doc = apply(doc, { type: "addWall", wallId: "v", start: { x: 3, y: AXIS.south }, end: { x: 3, y: AXIS.north }, thickness: 0.1, idPrefix: "v" });
    const [west, east] = Object.values(level(doc).rooms).sort((a, b) => a.seed.x - b.seed.x);
    doc = apply(doc, { type: "updateRoom", roomId: west.id, changes: { name: "Kitchen" } });
    doc = apply(doc, { type: "updateRoom", roomId: east.id, changes: { name: "Hall" } });
    const [south, , north] = level(doc).envelope.wallIds;
    doc = apply(doc, { type: "addOpening", opening: { id: "d1", wallId: "v", kind: "door", offset: 2, width: 0.9, height: 2.1, hinge: "start", swingSide: "left" } });
    doc = apply(doc, { type: "addOpening", opening: { id: "w1", wallId: north, kind: "window", offset: 1, width: 1.2, height: 1.2, sillHeight: 0.9 } });
    doc = apply(doc, { type: "setRearWall", wallId: south });
    doc = apply(doc, { type: "addOpening", opening: { id: "g1", wallId: south, kind: "door", offset: 4, width: 2.4, height: 2.1, hinge: "start", swingSide: "left" } });
    return { lvl: level(doc), north, south };
  };

  it("names an inside wall by the rooms either side, and its door by where it goes", () => {
    const { lvl } = house();
    expect(friendlyName(lvl, "v")).toMatch(/^Wall between (Kitchen and Hall|Hall and Kitchen)$/);
    expect(friendlyName(lvl, "d1")).toMatch(/^Door, (Kitchen to Hall|Hall to Kitchen)$/);
  });

  it("names outside walls by the way they face, and the garden side for what it is", () => {
    const { lvl, north, south } = house();
    expect(friendlyName(lvl, north)).toBe("Outside wall, north");
    expect(friendlyName(lvl, south)).toBe("Garden wall");
    expect(friendlyName(lvl, "g1")).toBe("Garden doors");
    expect(friendlyName(lvl, "w1")).toMatch(/^Window, (Kitchen|Hall)$/);
  });
});
