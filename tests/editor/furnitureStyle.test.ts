import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { intersection, multiPolygonArea } from "@/domain/geometry/polygons";
import type { Furniture, FurnitureKind } from "@/domain/plan/types";
import { INTERIOR_STYLES } from "@/domain/project/schema";
import { furnitureSymbolLocal } from "@/editor/rendering/scene/furnitureSymbols";
import { buildPlanScene } from "@/editor/rendering/scene/planScene";
import { modelFurnitureColour, planFurnitureFill } from "@/editor/rendering/scene/style";
import { apply, AXIS, level, newHouse } from "../helpers";

const bed = (over: Partial<Furniture> = {}): Furniture => ({ id: "bed", kind: "bed_double", position: { x: 4, y: 5 }, rotation: 0, width: 1.5, depth: 2.1, height: 0.5, ...over });

describe("furniture colours and rugs", () => {
  it("colours every part of every piece in every interior style", () => {
    for (const style of INTERIOR_STYLES) {
      const fills = planFurnitureFill(style);
      for (const kind of Object.keys(FURNITURE_CATALOG) as FurnitureKind[]) {
        const spec = FURNITURE_CATALOG[kind];
        for (const part of furnitureSymbolLocal(kind, spec.width, spec.depth)) {
          if (part.closed && part.tone !== "none") expect(fills[part.tone], `${style} ${kind} ${part.tone}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it("changes the woods and fabrics with the style, and leaves whites and water alone", () => {
    expect(planFurnitureFill("industrial").wood).not.toBe(planFurnitureFill("scandinavian").wood);
    expect(planFurnitureFill("industrial").water).toBe(planFurnitureFill("scandinavian").water);
    expect(modelFurnitureColour("modern", "fabric")).not.toBe(modelFurnitureColour("coastal", "fabric"));
    expect(modelFurnitureColour("modern", "water")).toBeUndefined();
    // No style yet means the default one.
    expect(planFurnitureFill(undefined)).toBe(planFurnitureFill("warm_minimal"));
  });

  it("lays a rug under the foot of a bed, kept inside the room", () => {
    const doc = apply(newHouse(), { type: "addFurniture", item: bed() });
    const scene = buildPlanScene(level(doc));
    expect(scene.rugs.length).toBe(1);
    const area = multiPolygonArea(scene.rugs);
    // Wider than the bed by 0.55 m a side, from 0.5 m past its foot to under the pillows.
    expect(area).toBeCloseTo((1.5 + 1.1) * (2.1 + 0.5 - 0.65), 3);

    // Pushed against the west wall, the rug stops at the wall.
    const tight = apply(newHouse(), { type: "addFurniture", item: bed({ position: { x: AXIS.west + 0.05 + 0.75 + 0.1, y: 5 } }) });
    const room = buildPlanScene(level(tight)).rooms[0];
    const rugs = buildPlanScene(level(tight)).rugs;
    const inside = rugs.reduce((sum, rug) => sum + room.clear.reduce((s, floor) => s + multiPolygonArea(intersection(rug, floor)), 0), 0);
    expect(multiPolygonArea(rugs)).toBeLessThan(area);
    expect(inside).toBeCloseTo(multiPolygonArea(rugs), 6);
  });

  it("has no rug under pieces that don't have one", () => {
    const doc = apply(newHouse(), { type: "addFurniture", item: bed({ kind: "wardrobe", width: 1.2, depth: 0.6, height: 2 }) });
    expect(buildPlanScene(level(doc)).rugs).toEqual([]);
  });
});
