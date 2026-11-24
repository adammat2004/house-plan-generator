import { describe, expect, it } from "vitest";
import { furnishInStyle } from "@/domain/interior/furnishInStyle";
import { setRoomFinishes } from "@/domain/interior/finishes";
import { itemRoomStyles, styleOfItem, styleResolver } from "@/domain/interior/itemStyles";
import type { PlanDocument, RoomType } from "@/domain/plan/types";
import { floorTinted } from "@/editor/rendering/scene/finishes";
import { buildHouseModel, type HouseModelOptions } from "@/editor/rendering/three/houseModel";
import { apply, level, newHouse } from "../helpers";

const OPTIONS: HouseModelOptions = { cutaway: false, roof: false, dimensions: false, landscape: false, furniture: true };

function furnishedRoom(type: RoomType): { doc: PlanDocument; id: string } {
  let doc = newHouse(7.3, 5.3);
  const id = Object.keys(level(doc).rooms)[0];
  doc = apply(doc, { type: "updateRoom", roomId: id, changes: { type } });
  const south = level(doc).envelope.wallIds[0];
  doc = apply(doc, { type: "addOpening", opening: { id: "door", wallId: south, kind: "door", offset: 0.6, width: 0.9, height: 2.1, hinge: "start", swingSide: "left" } });
  return { doc: furnishInStyle(doc, { style: "scandinavian", roomIds: [id], idPrefix: "t" })!.document, id };
}

describe("a room's own style on its furniture", () => {
  it("resolves each piece to its room's style, else the house's", () => {
    const { doc, id } = furnishedRoom("living");
    const [piece] = Object.values(level(doc).furniture);
    expect(itemRoomStyles(level(doc)).get(piece.id)).toBe("scandinavian");
    const plain = setRoomFinishes(doc, id, { interiorStyle: null })!;
    expect(itemRoomStyles(level(plain)).size).toBe(0);
    expect(styleResolver([level(plain)], "industrial")(piece)).toBe("industrial");
    expect(styleResolver([level(doc)], "industrial")(piece)).toBe("scandinavian");
    expect(styleOfItem("coastal", piece)).toBe("coastal");
    expect(styleOfItem(() => "farmhouse", piece)).toBe("farmhouse");
  });

  it("carries the room's style onto its 3D placements and boxes", () => {
    const { doc, id } = furnishedRoom("living");
    const own = buildHouseModel(level(doc), OPTIONS);
    expect(own.furniture!.length).toBeGreaterThan(0);
    expect(own.furniture!.every((p) => p.style === "scandinavian")).toBe(true);
    expect(own.boxes.filter((b) => b.kind === "furniture").every((b) => b.style === "scandinavian")).toBe(true);
    const plain = buildHouseModel(level(setRoomFinishes(doc, id, { interiorStyle: null })!), OPTIONS);
    expect(plain.furniture!.some((p) => p.style)).toBe(false);
  });
});

describe("floor tint on the plan", () => {
  it("leaves rooms without a chosen floor as they were, and nudges the rest toward it", () => {
    expect(floorTinted("#e8e0d0", null)).toBe("#e8e0d0");
    const tinted = floorTinted("#ffffff", "boards");
    expect(tinted).not.toBe("#ffffff");
    expect(floorTinted("#ffffff", "boards")).toBe(tinted);
    expect(floorTinted("#ffffff", "tile")).not.toBe(tinted);
    // Subtle: no channel moves far from the room's own colour.
    for (const i of [1, 3, 5]) expect(255 - parseInt(tinted.slice(i, i + 2), 16)).toBeLessThan(60);
  });
});
