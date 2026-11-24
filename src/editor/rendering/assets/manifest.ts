import { DEFAULT_INTERIOR_STYLE } from "@/domain/design/renderRequest";
import type { Furniture, FurnitureKind } from "@/domain/plan/types";
import { INTERIOR_STYLE_LABEL, type InteriorStyle } from "@/domain/project/schema";
import data from "./furnitureAssets.json";

/**
 * The furniture asset library (ADR 0012): for each kind and interior style, a
 * 3D model and the picture of it seen from above, made by `npm run
 * assets:build` and listed here by `npm run assets:publish`. Pure lookups;
 * the 3D and plan renderers load the files.
 */

export interface FurnitureAsset {
  kind: FurnitureKind;
  /** An interior style, or "any" for pieces that look the same in every style. */
  style: InteriorStyle | "any";
  glb: string;
  /** Seen from straight above, back at the top, with `marginM` of shadow round the piece at `pxPerM`. */
  sprite: { url: string; width: number; height: number; pxPerM: number; marginM: number };
  /** The model's size, m: width (X), depth (Z), height (Y). A bed is taller than the catalog says: its headboard. */
  dims: [number, number, number];
  /** The catalog size the model was made for, m: width, depth, height. Items are scaled from this. */
  catalog: [number, number, number];
  tris: number;
  bytes: number;
  vendor: string;
  licence: string;
  sourceHash: string;
}

export interface FurnitureAssetManifest {
  version: 1;
  entries: FurnitureAsset[];
}

const manifest = data as FurnitureAssetManifest;
const byKey = new Map(manifest.entries.map((e) => [`${e.style}/${e.kind}`, e]));

/** Says so when a style has no pieces of its own and is shown with the default style's; null when it has them. */
export function borrowedStyleNote(style: InteriorStyle): string | null {
  if (style === DEFAULT_INTERIOR_STYLE || manifest.entries.some((e) => e.style === style)) return null;
  return `Uses ${INTERIOR_STYLE_LABEL[DEFAULT_INTERIOR_STYLE]} pieces`;
}

/** How far an item may be resized from the catalog before the model would look stretched; past that it's drawn in code. */
export const STRETCH_RANGE = [0.7, 1.4] as const;

/** The asset for a kind in a style: that style's, else one for any style, else the default style's while others are made. */
export function assetFor(kind: FurnitureKind, style: InteriorStyle | undefined): FurnitureAsset | null {
  return byKey.get(`${style ?? DEFAULT_INTERIOR_STYLE}/${kind}`) ?? byKey.get(`any/${kind}`) ?? byKey.get(`${DEFAULT_INTERIOR_STYLE}/${kind}`) ?? null;
}

/** How much an item is scaled from the model along its width, height and depth. */
export function assetScale(item: Pick<Furniture, "width" | "depth" | "height">, asset: FurnitureAsset): [number, number, number] {
  const [w, d, h] = asset.catalog;
  return [item.width / w, item.height / h, item.depth / d];
}

/** The asset to draw an item with, or null when there's none or the item is resized too far for it. */
export function assetForItem(item: Furniture, style: InteriorStyle | undefined): FurnitureAsset | null {
  const asset = assetFor(item.kind, style);
  if (!asset) return null;
  const [lo, hi] = STRETCH_RANGE;
  return assetScale(item, asset).every((s) => s >= lo && s <= hi) ? asset : null;
}

export const furnitureAssets = manifest.entries;
