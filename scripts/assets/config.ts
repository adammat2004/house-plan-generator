import { join } from "node:path";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import type { FurnitureKind } from "@/domain/plan/types";
import { INTERIOR_STYLES, type InteriorStyle } from "@/domain/project/schema";

/**
 * Settings for `npm run assets:build`, which makes the furniture asset
 * library: a reference picture from Gemini, a 3D model from an image-to-3D
 * service, the model squared up to the catalog's size, and a top-down
 * picture of it for the plan (see docs/adr/0011-ai-furniture-asset-library.md).
 */

/** Working files, kept between runs so nothing paid is made twice. Not committed. */
export const CACHE = ".assets-cache";
/** The contact sheet for reviewing a run. */
export const SHEET = process.env.ASSETS_OUT ?? "test-results/assets";

export const cacheDir = (style: InteriorStyle | "any", kind: FurnitureKind) => join(CACHE, style, kind);

/** Kinds drawn from a 3D model. The rest stay drawn in code: they're built in and come in any length. */
export const MODELLED: FurnitureKind[] = [
  "sofa_3",
  "sofa_2",
  "armchair",
  "coffee_table",
  "tv_unit",
  "bookcase",
  "dining_set_4",
  "dining_set_6",
  "sideboard",
  "fridge",
  "bed_single",
  "bed_double",
  "bedside_table",
  "chest_of_drawers",
  "desk",
  "bath",
  "toilet",
  "basin",
  "washing_machine",
  "car",
  "plant",
];

/** Kinds that look the same whatever the interior style. */
export const ANY_STYLE: FurnitureKind[] = ["fridge", "toilet", "washing_machine", "car"];

/** The kinds the first spike compares the 3D services on. */
export const SPIKE_KINDS: FurnitureKind[] = ["sofa_3", "armchair", "bed_double", "coffee_table", "chest_of_drawers"];

/** Triangle budget after simplifying, by how much floor a piece covers. */
export function triangleBudget(kind: FurnitureKind): number {
  const { width, depth } = FURNITURE_CATALOG[kind];
  const area = width * depth;
  return area >= 1.2 ? 25_000 : area >= 0.4 ? 12_000 : 6_000;
}

/** Texture size after compressing, px. */
export const textureSize = (kind: FurnitureKind) => (triangleBudget(kind) >= 12_000 ? 1024 : 512);

/** How far a model may be stretched on any axis to reach the catalog size before it's flagged for another go. */
export const STRETCH_LIMIT = 0.2;

/** Top-down pictures: pixels per metre and the margin kept round the piece for its shadow, m. */
export const SPRITE = { pxPerM: 256, marginM: 0.15 } as const;

const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** What this run makes, from ASSETS_* environment variables (vitest doesn't pass script flags through). */
export function runOptions() {
  const styles = (list(process.env.ASSETS_STYLES) ?? ["warm_minimal"]) as InteriorStyle[];
  for (const s of styles) if (!INTERIOR_STYLES.includes(s)) throw new Error(`Unknown style ${s}`);
  const kinds = (list(process.env.ASSETS_KINDS) ?? SPIKE_KINDS) as FurnitureKind[];
  for (const k of kinds) if (!(k in FURNITURE_CATALOG)) throw new Error(`Unknown kind ${k}`);
  return {
    styles,
    kinds,
    vendors: list(process.env.ASSETS_VENDOR) ?? ["trellis", "trellis2", "tripo", "meshy", "rodin"],
    /** Stages to make again even though they're cached. */
    force: new Set(list(process.env.ASSETS_FORCE) ?? []),
    /** Print what would be made, and make nothing paid. */
    dry: process.env.ASSETS_DRY === "1",
  };
}
