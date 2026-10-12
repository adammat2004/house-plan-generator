import { COLOR, FALLBACK_SANS } from "@/design/tokens";
import type { FloorMaterial, RoomType } from "@/domain/plan/types";

let fontStack: string | null = null;

/**
 * The UI typeface for canvas text. next/font gives Inter a generated family
 * name, so read the real stack from the --font-sans token once it's on the page.
 */
function planFont(): string {
  if (fontStack) return fontStack;
  if (typeof document === "undefined") return FALLBACK_SANS;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  if (!value) return FALLBACK_SANS;
  fontStack = value;
  return fontStack;
}

/**
 * Plan colours. Geometry stays neutral; the single accent marks what is
 * selected or being edited. UI colours come from the design tokens
 * (src/design/tokens.ts, mirroring tokens.css).
 */
export const PLAN_THEME = {
  paper: COLOR.canvas,
  roomFill: "#efece6",
  gridMinor: "rgba(60, 64, 60, 0.045)",
  gridMajor: "rgba(60, 64, 60, 0.1)",
  wallFill: "#25282a",
  wallStroke: "#1b1d1f",
  /** The soft shadow walls cast on the floor beside them. */
  wallShadow: "rgba(24, 22, 18, 0.32)",
  /** Window frames, sills and door leaves. */
  frame: "#fbfaf7",
  /** A door's swing, quieter than the door. */
  swing: "#8e918d",
  openingStroke: "#2a2e31",
  glazing: "#8fa9bc",
  roomLabel: "#1f2326",
  roomArea: "#555b57",
  dimension: "#3f4441",
  dimensionSelection: COLOR.accent,
  accent: COLOR.accent,
  accentSoft: "rgba(47, 111, 94, 0.12)",
  hover: "rgba(47, 111, 94, 0.45)",
  error: COLOR.danger,
  errorSoft: "rgba(184, 67, 47, 0.14)",
  valid: COLOR.accent,
  validSoft: "rgba(47, 111, 94, 0.2)",
  /** Drawing annotations such as GARDEN and STREET. */
  annotation: COLOR["ink-3"],
  glass: "#e6eff6",
  houseShadow: "rgba(40, 38, 30, 0.16)",
  furnitureStroke: "#5f6461",
  /** Furniture's shadow on the floor, offset to the south-east; no blur. */
  furnitureShadow: "rgba(40, 34, 26, 0.16)",
  rugStroke: "rgba(95, 100, 97, 0.35)",
  /** The floor below, faded under the one being drawn. */
  underlay: "rgba(31, 35, 38, 0.18)",
  /** The walls as they are, dashed, under an option on show. */
  ghost: "rgba(47, 111, 94, 0.75)",
  /** The outline of the floor above, dashed. */
  floorAbove: "rgba(31, 35, 38, 0.55)",
  stairFill: "#f8f6f1",
  stairStroke: "#4a4f4c",
  labelHalo: "rgba(255, 255, 255, 0.8)",
  /** Behind room names on the plan. */
  labelPill: "rgba(255, 255, 255, 0.84)",
  get fontFamily(): string {
    return planFont();
  },
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
  canopy: ["#7f9467", "#8a9d70", "#93a57a", "#778c5f"],
  canopyLight: "rgba(189, 208, 154, 0.45)",
  canopyEdge: "rgba(62, 76, 46, 0.35)",
  treeShadow: "rgba(46, 52, 32, 0.16)",
  lawn: "#b9c79b",
  hedge: "#7c9163",
  hedgeEdge: "#6a7f53",
  hedgeShadow: "rgba(46, 52, 32, 0.16)",
  gravel: "#e3dccd",
  paving: "#ebe5da",
  pavingJoint: "#cfc7b8",
} as const;

/** Floor finishes as drawn on the plan in Designs (light enough for labels). */
export const MATERIAL_FILL: Record<FloorMaterial, string> = {
  timber: "#e6d2b5",
  boards: "#e8d6bb",
  tile: "#ebe8e1",
  stone: "#ddd6c8",
  carpet: "#e4dfd5",
  concrete: "#dfddd8",
  vinyl: "#ece4d4",
};

/** Swatches for choosing a finish: the material's own colour. */
export const MATERIAL_SWATCH: Record<FloorMaterial, string> = {
  timber: "#c1915f",
  boards: "#c99d6c",
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

