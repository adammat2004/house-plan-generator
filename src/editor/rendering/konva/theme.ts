import type { FloorMaterial, RoomType } from "@/domain/plan/types";

/**
 * Plan colours. Geometry stays neutral; the single accent marks what is
 * selected or being edited. Keep in step with the CSS tokens in globals.css.
 */
export const PLAN_THEME = {
  paper: "#f3f1ec",
  roomFill: "#efece6",
  gridMinor: "rgba(60, 64, 60, 0.045)",
  gridMajor: "rgba(60, 64, 60, 0.1)",
  wallFill: "#1f2326",
  wallStroke: "#16191b",
  openingStroke: "#2a2e31",
  glazing: "#6f8ea6",
  roomLabel: "#1f2326",
  roomArea: "#555b57",
  dimension: "#3f4441",
  dimensionSelection: "#2f6f5e",
  accent: "#2f6f5e",
  accentSoft: "rgba(47, 111, 94, 0.12)",
  hover: "rgba(47, 111, 94, 0.45)",
  error: "#b8432f",
  errorSoft: "rgba(184, 67, 47, 0.14)",
  valid: "#2f6f5e",
  validSoft: "rgba(47, 111, 94, 0.2)",
  rear: "#a8642e",
  glass: "#e6eff6",
  houseShadow: "rgba(40, 38, 30, 0.16)",
  furnitureStroke: "#5f6461",
  labelHalo: "rgba(255, 255, 255, 0.8)",
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;

/** Room tints by type, shown in the Design workspace only. Related spaces share a hue family. */
export const ROOM_FILL: Record<RoomType, string> = {
  unspecified: "#f6f4ef",
  living: "#f1e8d8",
  kitchen: "#e6eedf",
  kitchen_dining: "#e9eedc",
  dining: "#efecd9",
  bedroom: "#e4eaf0",
  primary_bedroom: "#dfe6f0",
  bathroom: "#dfecec",
  ensuite: "#dcebeb",
  wc: "#e2eded",
  utility: "#ebe6ec",
  hall: "#eeebe4",
  office: "#ece5dc",
  storage: "#ebe8e2",
  garage: "#e7e6e3",
  other: "#f0ece3",
};

/** Decorative site planting around the house. Not part of the plan. */
export const SITE_THEME = {
  canopy: ["#6b8a4f", "#7a9659", "#86a063", "#62804a"],
  canopyLight: "#bdd09a",
  treeShadow: "rgba(46, 52, 32, 0.12)",
  paving: "#ebe5da",
  pavingJoint: "#ddd5c7",
} as const;

/** Floor finishes as drawn on the plan in Designs (light enough for labels). */
export const MATERIAL_FILL: Record<FloorMaterial, string> = {
  timber: "#e6d2b5",
  tile: "#ebe8e1",
  stone: "#ddd6c8",
  carpet: "#e4dfd5",
  concrete: "#dfddd8",
  vinyl: "#ece4d4",
};

/** Swatches for choosing a finish: the material's own colour. */
export const MATERIAL_SWATCH: Record<FloorMaterial, string> = {
  timber: "#c1915f",
  tile: "#d8d4cb",
  stone: "#b9b09f",
  carpet: "#a9a397",
  concrete: "#bdbbb5",
  vinyl: "#d4c7ad",
};

/** Day, night and service zones, for comparing how concepts organise a house. */
export const ZONE_FILL: Record<RoomType, string> = {
  unspecified: "#efece6",
  living: "#f3dfb3",
  kitchen: "#f3dfb3",
  kitchen_dining: "#f3dfb3",
  dining: "#f3dfb3",
  office: "#f3dfb3",
  bedroom: "#cfdcec",
  primary_bedroom: "#cfdcec",
  bathroom: "#cfe6e2",
  ensuite: "#cfe6e2",
  wc: "#cfe6e2",
  utility: "#cfe6e2",
  hall: "#e9e5dd",
  storage: "#e9e5dd",
  garage: "#e2e0db",
  other: "#efece6",
};

/** Furniture symbol fills, light so room tints and labels still read through. */
export const FURNITURE_FILL: Record<"body" | "soft" | "dark" | "water" | "leaf", string> = {
  body: "#fdfcf9",
  soft: "#efebe3",
  dark: "#4a4f4d",
  water: "#e3ecef",
  leaf: "#b7c99a",
};
