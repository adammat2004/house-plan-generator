import { ringSignedArea, simplifyRing, union, type Ring } from "@/domain/geometry/polygons";
import type { Point2 } from "@/domain/plan/types";

/**
 * House outlines for tests: outside faces in metres, counterclockwise, with
 * the bounding box at the origin.
 */

const ring = (...points: Array<[number, number]>): Ring => points.map(([x, y]) => ({ x, y }));

export const rectRing = (width: number, depth: number): Ring => ring([0, 0], [width, 0], [width, depth], [0, depth]);

export const OUTLINES = {
  /** A 12 m front wing with a 5.5 m wide rear wing on the west. */
  L: ring([0, 0], [12, 0], [12, 5.5], [5.5, 5.5], [5.5, 11], [0, 11]),
  /** A 14 m front bar with a 5 m stem running back from its middle. */
  T: ring([0, 0], [14, 0], [14, 5.5], [9.5, 5.5], [9.5, 11], [4.5, 11], [4.5, 5.5], [0, 5.5]),
  /** A 14 m front bar with two 4.5 m arms running back. */
  U: ring([0, 0], [14, 0], [14, 11], [9.5, 11], [9.5, 5.5], [4.5, 5.5], [4.5, 11], [0, 11]),
  /** Two offset blocks overlapping by 4 m. */
  Z: ring([0, 0], [9, 0], [9, 5], [14, 5], [14, 10.5], [5, 10.5], [5, 5.5], [0, 5.5]),
  /** A 12 × 9 m house with a 3.5 × 1 m bay on the rear. */
  bay: ring([0, 0], [12, 0], [12, 9], [7.5, 9], [7.5, 10], [4, 10], [4, 9], [0, 9]),
  /** A 12 × 9 m house with a 3 × 2 m notch out of the north-east corner. */
  notch: ring([0, 0], [12, 0], [12, 7], [9, 7], [9, 9], [0, 9]),
  plus: ring([4, 0], [8, 0], [8, 4], [12, 4], [12, 8], [8, 8], [8, 12], [4, 12], [4, 8], [0, 8], [0, 4], [4, 4]),
  stairs: ring([0, 0], [12, 0], [12, 4], [9, 4], [9, 8], [5, 8], [5, 12], [0, 12]),
} as const satisfies Record<string, Ring>;

export type OutlineName = keyof typeof OUTLINES;

/** Mulberry32: small, fast and reproducible. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRID = 0.5;

/**
 * A random right-angle outline: the union of two to four rectangles on a
 * 0.5 m grid, kept only when it is one simple polygon without holes. Some
 * have thin arms or short jogs on purpose, so commands and planners meet
 * outlines they must refuse.
 */
export function randomOutline(seed: number): Ring {
  const random = seeded(seed);
  const pick = (lo: number, hi: number) => lo + Math.floor(random() * ((hi - lo) / GRID + 1)) * GRID;
  for (let attempt = 0; attempt < 200; attempt++) {
    const count = 2 + Math.floor(random() * 3);
    const rects = Array.from({ length: count }, () => {
      const x = pick(0, 14);
      const y = pick(0, 14);
      return { x, y, w: pick(3, 14), h: pick(3, 14) };
    });
    const merged = union(rects.map((r) => ({ outer: rectRing(r.w, r.h).map((p) => ({ x: p.x + r.x, y: p.y + r.y })), holes: [] })));
    if (merged.length !== 1 || merged[0].holes.length) continue;
    let outer: Point2[] = simplifyRing(merged[0].outer);
    if (ringSignedArea(outer) < 0) outer = [...outer].reverse();
    const minX = Math.min(...outer.map((p) => p.x));
    const minY = Math.min(...outer.map((p) => p.y));
    return outer.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  }
  throw new Error(`No outline for seed ${seed}`);
}
