import { presetOutline, presetProblem, type ShapeParams } from "../geometry/outlinePresets";
import { LIMITS } from "../plan/defaults";
import type { Point2 } from "../plan/types";
import type { Program, SpaceSpec } from "./program";
import { MAX_BAND, minBandDepth, zoneProgram, type Arrangement } from "./zoning";

/**
 * Chooses house sizes for a program when nobody has drawn the house: a few
 * outside width × depth options that fit the rooms at sensible proportions,
 * each a different shape (compact, wide or deep). The strip planner then lays
 * the rooms out inside each one.
 */

/** The largest house the site allows, outside dimensions in metres. */
export interface PlotLimits {
  maxWidth?: number;
  maxDepth?: number;
}

export type FootprintShape = "compact" | "wide" | "deep";

/** Outside dimensions, m. Width runs across the house (east–west), depth front to back. */
export interface Footprint {
  width: number;
  depth: number;
  shape: FootprintShape;
}

export interface FootprintOptions {
  externalThickness: number;
  hallWidth: number;
  plot?: PlotLimits;
}

/** Walls, door swings and the odd awkward corner: clear area needs this much more band area. */
const WALL_ALLOWANCE = 1.12;
const ENSUITE_AREA = 3.5;
const STEP = 0.5;
const MAX_ASPECT = 2.2;
/** Options more than this much bigger than the smallest workable house aren't offered. */
const AREA_SLACK = 1.18;

const roundUp = (v: number) => Math.ceil(v / STEP - 1e-9) * STEP;

/** Band area a set of rooms needs, wall centre to wall centre. */
function need(spaces: SpaceSpec[]): number {
  return spaces.reduce((sum, s) => sum + s.target + (s.ensuite ? ENSUITE_AREA : 0), 0) * WALL_ALLOWANCE;
}

export const shapeOf = (width: number, depth: number): FootprintShape => (width / depth > 1.25 ? "wide" : width / depth < 0.8 ? "deep" : "compact");

interface Option {
  width: number;
  depth: number;
  area: number;
  aspect: number;
}

/** Every workable size for one arrangement, sampled along the band length. */
function options(program: Program, arrangement: Arrangement, { externalThickness: ext, hallWidth, plot }: FootprintOptions): Option[] {
  const out: Option[] = [];
  const total = need(program.spaces);
  const longest = Math.min(LIMITS.maxHouseSize, Math.max(30, total / 3));
  for (let outsideL = 4; outsideL <= longest; outsideL += STEP) {
    const L = outsideL - ext;
    const zoning = zoneProgram(program, arrangement, L);
    if (!zoning) continue;
    const depthOf = (spaces: SpaceSpec[]) => Math.max(minBandDepth(spaces), need(spaces) / L);
    const d1 = depthOf(zoning.first);
    const d2 = depthOf(zoning.second);
    if (d1 > MAX_BAND || d2 > MAX_BAND) continue;
    const outsideT = roundUp(d1 + d2 + hallWidth + ext);
    // The band length runs across the house for a depth split, front to back for a width split.
    const [width, depth] = arrangement.split === "depth" ? [outsideL, outsideT] : [outsideT, outsideL];
    if (plot?.maxWidth && width > plot.maxWidth + 1e-9) continue;
    if (plot?.maxDepth && depth > plot.maxDepth + 1e-9) continue;
    if (width > LIMITS.maxHouseSize || depth > LIMITS.maxHouseSize) continue;
    const aspect = Math.max(width, depth) / Math.min(width, depth);
    if (aspect > MAX_ASPECT) continue;
    out.push({ width, depth, area: width * depth, aspect });
  }
  return out;
}

/**
 * Up to three outside sizes for an arrangement, smallest-proportioned first:
 * the most nearly square, the longest band, and the shortest band, all
 * within a little of the smallest workable area and inside the plot.
 */
export function footprintsFor(program: Program, arrangement: Arrangement, opts: FootprintOptions): Footprint[] {
  const all = options(program, arrangement, opts);
  if (!all.length) return [];
  const smallest = Math.min(...all.map((o) => o.area));
  const near = all.filter((o) => o.area <= smallest * AREA_SLACK);
  const byLength = [...near].sort((a, b) => (arrangement.split === "depth" ? a.width - b.width : a.depth - b.depth));
  const picks = [
    [...near].sort((a, b) => a.aspect - b.aspect || a.area - b.area)[0],
    byLength[byLength.length - 1],
    byLength[0],
  ];
  const seen = new Set<string>();
  const result: Footprint[] = [];
  for (const o of picks) {
    const key = `${o.width}x${o.depth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ width: o.width, depth: o.depth, shape: shapeOf(o.width, o.depth) });
  }
  return result;
}

/** The smallest workable house for the program over the given arrangements, ignoring the plot; null if none works. */
export function minimumFootprint(program: Program, arrangements: readonly Arrangement[], opts: FootprintOptions): Footprint | null {
  let best: Option | null = null;
  for (const arrangement of arrangements) {
    for (const o of options(program, arrangement, { ...opts, plot: undefined })) {
      if (!best || o.area < best.area - 1e-9 || (Math.abs(o.area - best.area) < 1e-9 && o.aspect < best.aspect)) best = o;
    }
  }
  return best ? { width: best.width, depth: best.depth, shape: shapeOf(best.width, best.depth) } : null;
}

export type ShapeFamily = "L" | "T" | "U";

/** An outline other than a rectangle, sized for a program; width and depth are its bounding box. */
export interface ShapeFootprint extends Footprint {
  family: ShapeFamily;
  params: ShapeParams;
  /** Outside faces, counterclockwise from the south-west corner, street to the south. */
  outline: Point2[];
  /** Identifies the outline across requests, e.g. "L:12x11:5.5:5.5". */
  key: string;
}

/** Rooms take about this share of a wing house's floor; halls and walls the rest. */
const ROOM_SHARE = 0.8;

/**
 * A few L, T or U outlines that fit a program: wings 5.5 or 6 m deep, sized
 * so the floor is about what the rooms need (and a little more), within the
 * plot. The wing planner lays the rooms out in each.
 */
export function shapeFootprintsFor(program: Program, family: ShapeFamily, opts: FootprintOptions): ShapeFootprint[] {
  const gross = need(program.spaces) / ROOM_SHARE;
  const out: ShapeFootprint[] = [];
  const seen = new Set<string>();
  // Wings one room deep either side of a hall suit big houses better than long single rows.
  const depths = gross >= 120 ? [5.5, 8.5, 6] : [5.5, 6];
  for (const scale of [1, 1.1, 1.22]) {
    const G = gross * scale;
    for (const D of depths) {
      let params: ShapeParams | null = null;
      if (family === "L") {
        const A = roundUp((0.55 * G) / D);
        const B = roundUp((G - A * D) / D);
        if (A >= D + 4 && B >= 4) params = { width: A, depth: D + B, front: D, wing: D };
      } else if (family === "T") {
        const stem = Math.min(D - 0.5, 6);
        const A = roundUp((0.65 * G) / D);
        const B = roundUp((0.35 * G) / stem);
        if (A >= stem + 6 && B >= 4) params = { width: A, depth: D + B, front: D, wing: stem };
      } else {
        const arm = Math.min(D - 1, 5);
        const A = roundUp((0.6 * G) / D);
        const B = roundUp((0.2 * G) / arm);
        if (A >= 2 * arm + 4 && B >= 4) params = { width: A, depth: D + B, front: D, wing: arm };
      }
      if (!params) continue;
      const { width, depth } = params;
      if (opts.plot?.maxWidth && width > opts.plot.maxWidth + 1e-9) continue;
      if (opts.plot?.maxDepth && depth > opts.plot.maxDepth + 1e-9) continue;
      if (width > LIMITS.maxHouseSize || depth > LIMITS.maxHouseSize || Math.max(width, depth) / Math.min(width, depth) > MAX_ASPECT + 0.3) continue;
      if (presetProblem(family, params, opts.externalThickness)) continue;
      const key = `${family}:${width}x${depth}:${params.front}:${params.wing}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ width, depth, shape: shapeOf(width, depth), family, params, outline: presetOutline(family, params), key });
    }
  }
  return out.slice(0, 4);
}
