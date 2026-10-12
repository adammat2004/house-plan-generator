import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { backDirection, furnitureRect } from "@/domain/furniture/geometry";
import type { Furniture, FurnitureRotation } from "@/domain/plan/types";
import { INTERIOR_STYLES } from "@/domain/project/schema";
import { assetFor, assetForItem, assetScale, furnitureAssets, type FurnitureAsset } from "@/editor/rendering/assets/manifest";
import { spriteTransform } from "@/editor/rendering/konva/sprites";

/** Kinds whose model keeps its own height (a bed's headboard stands above the catalog's mattress height). */
const OWN_HEIGHT = new Set(["bed_single", "bed_double", "bed_king"]);
/** Kinds scaled evenly to fit inside the catalog size rather than stretched to it. */
const EVEN = new Set(["car", "plant", "toilet"]);

describe("the furniture asset manifest", () => {
  it.each(furnitureAssets.map((a) => [`${a.style}/${a.kind}`, a] as const))("%s points at files that are there, sized for the catalog", (_, asset) => {
    for (const url of [asset.glb, asset.sprite.url]) {
      const file = join("public", url);
      expect(existsSync(file), file).toBe(true);
      // Files are named by their content, so they can be cached for good.
      expect(url).toMatch(/\.[0-9a-f]{8}\.(glb|webp)$/);
    }
    expect(statSync(join("public", asset.glb)).size).toBe(asset.bytes);
    expect(asset.bytes).toBeLessThan(1_000_000);
    expect(asset.tris).toBeLessThanOrEqual(30_000);
    expect(asset.licence).not.toBe("");
    expect(["any", ...INTERIOR_STYLES]).toContain(asset.style);
    const spec = FURNITURE_CATALOG[asset.kind];
    expect(asset.catalog).toEqual([spec.width, spec.depth, spec.height]);
    // Inside the catalog footprint: filling it to the centimetre, or for pieces scaled evenly (cars, plants, toilets) touching it on one side.
    expect(asset.dims[0]).toBeLessThanOrEqual(spec.width + 0.01);
    expect(asset.dims[1]).toBeLessThanOrEqual(spec.depth + 0.01);
    const short = [spec.width - asset.dims[0], spec.depth - asset.dims[1]];
    if (EVEN.has(asset.kind)) expect(Math.min(...short)).toBeLessThan(0.01);
    else expect(Math.max(...short)).toBeLessThan(0.01);
    if (!OWN_HEIGHT.has(asset.kind)) expect(asset.dims[2]).toBeLessThanOrEqual(spec.height + 0.01);
  });
});

const ASSET: FurnitureAsset = {
  kind: "sofa_3",
  style: "warm_minimal",
  glb: "/x.glb",
  sprite: { url: "/x.webp", width: Math.round((2.1 + 0.3) * 256), height: Math.round((0.9 + 0.3) * 256), pxPerM: 256, marginM: 0.15 },
  dims: [2.1, 0.9, 0.85],
  catalog: [2.1, 0.9, 0.85],
  tris: 1,
  bytes: 1,
  vendor: "test",
  licence: "test",
  sourceHash: "x",
};

const sofa = (rotation: FurnitureRotation, scale = 1): Furniture => ({ id: "s", kind: "sofa_3", position: { x: 3, y: 4 }, rotation, width: 2.1 * scale, depth: 0.9, height: 0.85 });

/** Where a point of the picture lands on the plan, by Konva's transform: translate · rotate · scale · −offset. */
function place(t: ReturnType<typeof spriteTransform>, u: number, v: number) {
  const [x, y] = [u - t.offsetX, (v - t.offsetY) * t.scaleY];
  const a = (t.rotation * Math.PI) / 180;
  return { x: t.x + x * Math.cos(a) - y * Math.sin(a), y: t.y + x * Math.sin(a) + y * Math.cos(a) };
}

describe("placing a piece's picture on the plan", () => {
  it.each([0, 90, 180, 270] as FurnitureRotation[])("puts the picture's top, the piece's back, toward its back at %i°", (rotation) => {
    const item = sofa(rotation);
    const t = spriteTransform(item, ASSET);
    const centre = place(t, t.width / 2, t.height / 2);
    expect(centre.x).toBeCloseTo(3, 9);
    expect(centre.y).toBeCloseTo(4, 9);
    const top = place(t, t.width / 2, 0);
    const back = backDirection(rotation);
    const toward = { x: top.x - centre.x, y: top.y - centre.y };
    expect(toward.x * back.x + toward.y * back.y).toBeGreaterThan(0);
    // The piece, inside the margin, covers its footprint (to the pixel the picture's size was rounded to).
    const margin = ASSET.sprite.marginM;
    const corners = [place(t, margin, margin), place(t, t.width - margin, t.height - margin)];
    const r = furnitureRect(item);
    expect(Math.min(corners[0].x, corners[1].x)).toBeCloseTo(r.minX, 2);
    expect(Math.max(corners[0].x, corners[1].x)).toBeCloseTo(r.maxX, 2);
    expect(Math.min(corners[0].y, corners[1].y)).toBeCloseTo(r.minY, 2);
    expect(Math.max(corners[0].y, corners[1].y)).toBeCloseTo(r.maxY, 2);
  });

  it("stretches with a resized piece", () => {
    expect(assetScale(sofa(0, 1.2), ASSET)).toEqual([expect.closeTo(1.2, 9), 1, 1]);
    expect(spriteTransform(sofa(0, 1.2), ASSET).width).toBeCloseTo(spriteTransform(sofa(0), ASSET).width * 1.2, 9);
  });
});

describe("choosing an asset", () => {
  const listed = furnitureAssets[0];
  it.skipIf(!listed)("falls back to the default style, and skips a piece resized too far for its model", () => {
    const item: Furniture = { id: "x", kind: listed.kind, position: { x: 0, y: 0 }, rotation: 0, width: listed.catalog[0], depth: listed.catalog[1], height: listed.catalog[2] };
    expect(assetFor(listed.kind, "coastal")).not.toBeNull();
    expect(assetForItem(item, undefined)).toBe(assetFor(listed.kind, undefined));
    expect(assetForItem({ ...item, width: item.width * 2 }, undefined)).toBeNull();
  });
});
