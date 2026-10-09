import type { Point2 } from "../plan/types";
import { roundToPrecision } from "./numeric";
import { checkOutlineRing, outsideToAxis } from "./outline";

/**
 * Ready-made house shapes. Each is an outline of outside faces from its
 * overall width and depth and two wing sizes, with the street (front) to
 * the south. They are starting points: every wall can be moved afterwards.
 */

export const SHAPE_PRESETS = ["rectangle", "L", "T", "U", "Z"] as const;
export type ShapePreset = (typeof SHAPE_PRESETS)[number];

/** Outside dimensions, m. */
export interface ShapeParams {
  width: number;
  depth: number;
  /** How deep the front wing is, street to back. */
  front: number;
  /** How wide the rear wing (or each rear wing) is; for a Z, how far the rear block is set over. */
  wing: number;
}

export interface ShapePresetInfo {
  label: string;
  description: string;
  /** Labels of the two wing sizes, for shapes that have them. */
  front?: string;
  wing?: string;
}

export const SHAPE_PRESET_INFO: Record<ShapePreset, ShapePresetInfo> = {
  rectangle: { label: "Rectangle", description: "A simple box." },
  L: { label: "L-shape", description: "A front wing with a wing running back along the west side.", front: "Front wing depth", wing: "Rear wing width" },
  T: { label: "T-shape", description: "A front wing with a wing running back from its middle.", front: "Front wing depth", wing: "Rear wing width" },
  U: { label: "U-shape", description: "A front wing with two wings running back around a courtyard.", front: "Front wing depth", wing: "Rear wings' width" },
  Z: { label: "Z-shape", description: "Two blocks, the rear one set over to the east.", front: "Front block depth", wing: "Rear block set over" },
};

const r = roundToPrecision;
const ring = (...xy: Array<[number, number]>): Point2[] => xy.map(([x, y]) => ({ x: r(x), y: r(y) }));

/** The outside-face outline of a preset, counterclockwise from the south-west corner. */
export function presetOutline(shape: ShapePreset, p: ShapeParams): Point2[] {
  const { width: W, depth: D, front: a, wing: b } = p;
  switch (shape) {
    case "rectangle":
      return ring([0, 0], [W, 0], [W, D], [0, D]);
    case "L":
      return ring([0, 0], [W, 0], [W, a], [b, a], [b, D], [0, D]);
    case "T": {
      const x0 = (W - b) / 2;
      return ring([0, 0], [W, 0], [W, a], [x0 + b, a], [x0 + b, D], [x0, D], [x0, a], [0, a]);
    }
    case "U":
      return ring([0, 0], [W, 0], [W, D], [W - b, D], [W - b, a], [b, a], [b, D], [0, D]);
    case "Z":
      return ring([0, 0], [W - b, 0], [W - b, a], [W, a], [W, D], [b, D], [b, a], [0, a]);
  }
}

const half = (v: number) => Math.round(v * 2) / 2;

/** Sensible wing sizes for a shape of the given overall size. */
export function defaultShapeParams(shape: ShapePreset, width: number, depth: number): ShapeParams {
  const front = half(depth / 2);
  const wing = shape === "L" ? half(width / 2) : shape === "T" ? half(width * 0.36) : shape === "U" ? half(width * 0.32) : shape === "Z" ? half(width * 0.36) : 0;
  return { width, depth, front, wing };
}

/** Typical overall sizes to start each shape from, outside dimensions in metres. */
export const SHAPE_DEFAULT_SIZE: Record<ShapePreset, { width: number; depth: number }> = {
  rectangle: { width: 8, depth: 10 },
  L: { width: 12, depth: 11 },
  T: { width: 14, depth: 11 },
  U: { width: 14, depth: 11 },
  Z: { width: 14, depth: 10.5 },
};

/**
 * Why these sizes don't make a house of this shape, or null when they do.
 * Checks the wings fit the overall size, then every outline rule.
 */
export function presetProblem(shape: ShapePreset, p: ShapeParams, externalThickness: number): string | null {
  for (const [key, value] of Object.entries(p)) {
    if (shape === "rectangle" && (key === "front" || key === "wing")) continue;
    if (!Number.isFinite(value) || value <= 0) return `${labelOf(shape, key)} must be a positive number.`;
  }
  if (shape !== "rectangle") {
    if (p.front >= p.depth) return `${labelOf(shape, "front")} must be less than the depth.`;
    // A U's two wings, or a Z's two blocks, share the width.
    const halves = shape === "U" || shape === "Z";
    if (p.wing >= (halves ? p.width / 2 : p.width)) return `${labelOf(shape, "wing")} must be less than ${halves ? "half the width" : "the width"}.`;
  }
  const axis = outsideToAxis(presetOutline(shape, p), externalThickness).map((q) => ({ x: r(q.x), y: r(q.y) }));
  return checkOutlineRing(axis, externalThickness)?.message ?? null;
}

function labelOf(shape: ShapePreset, key: string): string {
  const info = SHAPE_PRESET_INFO[shape];
  if (key === "front") return info.front ?? "Front wing depth";
  if (key === "wing") return info.wing ?? "Wing width";
  return key === "width" ? "Width" : "Depth";
}
