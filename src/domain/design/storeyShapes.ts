import { roundToPrecision } from "../geometry/numeric";
import { presetOutline, presetProblem, type ShapeParams } from "../geometry/outlinePresets";
import type { Rect } from "../geometry/vector";
import { LIMITS } from "../plan/defaults";
import type { Point2, RoomType } from "../plan/types";
import { LIVING } from "./bands";
import { shapeOf, type Footprint, type PlotLimits, type ShapeFamily } from "./footprint";
import type { Program } from "./program";
import { storeyFootprints } from "./storeyPlanner";

/**
 * Two-storey houses that aren't rectangles, sized from the rooms: a
 * two-storey main part as `storeyFootprints` sizes it, with single-storey
 * wings behind, one (an L or a T) or two (a U). A wing holds the garage,
 * utility or office if the brief has them, or else extends a living space:
 *
 *        L                 T                   U
 *   ┌──┐             ┌───┐            ┌──┐       ┌──┐
 *   │w │             │ w │            │w │       │w │     garden
 *   ├──┴──────┐  ┌───┴───┴───┐  ┌─────┴──┴───────┴──┴┐
 *   │  main   │  │   main    │  │       main         │
 *   └─────────┘  └───────────┘  └────────────────────┘    street
 */

export interface StoreyShapeFootprint extends Footprint {
  family: ShapeFamily;
  params: ShapeParams;
  /** Outside faces, counterclockwise from the south-west corner, street to the south. */
  outline: Point2[];
  /** Identifies the outline across requests, e.g. "L:9x13:9:4.5". */
  key: string;
  /** The main part, on the wall centrelines: the part to stack. */
  core: Rect;
}

/** Rooms that can leave the main part for a wing of their own. */
const WING_ROOMS: ReadonlySet<RoomType> = new Set(["garage", "utility", "office"]);
/** Wing widths tried, outside, m. */
const WING_WIDTHS = [4, 4.5, 5];
/** Shallowest and deepest a wing runs back, outside, m. */
const MIN_WING = 3.5;
const MAX_WING = 7;
/** A wing extending a living space adds at most about this share of its target area. */
const EXTEND = 1.1;
/** Most outlines per family. */
const MAX_SHAPES = 4;

const STEP = 0.5;
const roundUp = (v: number) => Math.ceil(v / STEP - 1e-9) * STEP;

/** L, T or U two-storey outlines for the rooms, smallest first, within the plot. */
export function storeyShapeFootprints(ground: Program, upper: Program, family: ShapeFamily, opts: { externalThickness: number; doorWidth: number; risers: number; plot?: PlotLimits }): StoreyShapeFootprint[] {
  const t = opts.externalThickness;
  const wings = family === "U" ? 2 : 1;
  // What a wing holds: the rooms that can go there, shared between the wings, or a living space it extends.
  const service = ground.spaces.filter((s) => WING_ROOMS.has(s.type)).reduce((sum, s) => sum + s.target, 0) * 1.15;
  const living = Math.max(0, ...ground.spaces.filter((s) => LIVING.has(s.type)).map((s) => s.target)) * EXTEND;
  const areas = [...new Set([service / wings, living].filter((a) => a >= 8).map((a) => roundToPrecision(a)))];
  // The main part keeps the plot's width, and leaves room behind it for the wings.
  const cores = storeyFootprints(ground, upper, { ...opts, plot: opts.plot && { ...opts.plot, maxDepth: opts.plot.maxDepth && opts.plot.maxDepth - MIN_WING } });
  const out: StoreyShapeFootprint[] = [];
  const seen = new Set<string>();
  for (const core of cores) {
    for (const wingArea of areas) {
      for (const b of WING_WIDTHS) {
        const run = Math.min(MAX_WING, Math.max(MIN_WING, roundUp(wingArea / (b - t) + t / 2)));
        // Each wing leaves the main part a stretch beside it as deep as a room, so the house reads as its shape.
        if (core.width < wings * b + (family === "T" ? 6.5 : 3.5)) continue;
        const params: ShapeParams = { width: core.width, depth: roundToPrecision(core.depth + run), front: core.depth, wing: b };
        const { width, depth } = params;
        if (opts.plot?.maxWidth && width > opts.plot.maxWidth + 1e-9) continue;
        if (opts.plot?.maxDepth && depth > opts.plot.maxDepth + 1e-9) continue;
        if (width > LIMITS.maxHouseSize || depth > LIMITS.maxHouseSize || Math.max(width, depth) / Math.min(width, depth) > 2.5) continue;
        if (presetProblem(family, params, t)) continue;
        const key = `${family}:${width}x${depth}:${params.front}:${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const outline = presetOutline(family, params);
        const coreRect: Rect = { minX: t / 2, maxX: roundToPrecision(width - t / 2), minY: t / 2, maxY: roundToPrecision(core.depth - t / 2) };
        out.push({ width, depth, shape: shapeOf(width, depth), family, params, outline, key, core: coreRect });
      }
    }
  }
  // Smallest first: the main part and its wings.
  const floor = (fp: StoreyShapeFootprint) => fp.width * fp.params.front + wings * fp.params.wing * (fp.depth - fp.params.front);
  return out.sort((a, b) => floor(a) - floor(b) || a.key.localeCompare(b.key)).slice(0, MAX_SHAPES);
}
