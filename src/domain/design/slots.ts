import { roundToPrecision } from "../geometry/numeric";
import type { SpaceSpec } from "./program";

/**
 * Cutting a band into rooms side by side: the one sizing rule every planner
 * shares, kept on its own so planners can use each other's band builders
 * without importing each other.
 */

const GRID = 0.05;
const snap = (v: number) => roundToPrecision(Math.round(v / GRID) * GRID);

/** Widths along a band in proportion to target areas, never below the minimums, snapped to the grid. */
export function distributeWidths(length: number, spaces: SpaceSpec[], mins: number[]): number[] | null {
  if (mins.reduce((a, b) => a + b, 0) > length + 1e-9) return null;
  const widths = spaces.map(() => 0);
  const fixed = new Set<number>();
  for (;;) {
    const free = spaces.map((_, i) => i).filter((i) => !fixed.has(i));
    const remaining = length - [...fixed].reduce((sum, i) => sum + mins[i], 0);
    const total = free.reduce((sum, i) => sum + spaces[i].target, 0);
    free.forEach((i) => (widths[i] = (remaining * spaces[i].target) / total));
    const short = free.filter((i) => widths[i] < mins[i] - 1e-9);
    if (!short.length) break;
    short.forEach((i) => {
      fixed.add(i);
      widths[i] = mins[i];
    });
  }
  const cuts = [0];
  let acc = 0;
  for (let i = 0; i < spaces.length - 1; i++) {
    acc += widths[i];
    const lo = cuts[i] + mins[i];
    const hi = length - mins.slice(i + 1).reduce((a, b) => a + b, 0);
    cuts.push(roundToPrecision(Math.min(Math.max(snap(acc), Math.ceil((lo - 1e-9) / GRID) * GRID), Math.floor((hi + 1e-9) / GRID) * GRID)));
    if (cuts[i + 1] - cuts[i] < mins[i] - 1e-6) return null;
  }
  cuts.push(roundToPrecision(length));
  if (length - cuts[cuts.length - 2] < mins[mins.length - 1] - 1e-6) return null;
  return cuts;
}
