import type { Rect as WorldRect } from "@/domain/geometry/vector";
import { SITE_THEME as S } from "../konva/theme";

/**
 * Decorative planting around a house, in world metres: the same trees and
 * paving on the 2D canvas and in 3D. Deterministic, so it never jumps.
 */

export interface Tree {
  x: number;
  y: number;
  r: number;
  shade: string;
}

export interface Tile {
  x: number;
  y: number;
  size: number;
}

/** Small deterministic PRNG so the planting stays put between renders and sessions. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trees in loose columns either side of the house, clear of the dimension lines. */
export function plant(house: WorldRect): { trees: Tree[]; tiles: Tile[] } {
  const rand = random(7);
  const trees: Tree[] = [];
  const column = (x0: number, x1: number, count: number) => {
    const span = house.maxY - house.minY + 3;
    for (let i = 0; i < count; i++) {
      const r = 0.55 + rand() * 0.55;
      trees.push({
        x: x0 + rand() * (x1 - x0),
        y: house.minY - 1.5 + ((i + 0.3 + rand() * 0.4) / count) * span,
        r,
        shade: S.canopy[Math.floor(rand() * S.canopy.length)],
      });
    }
  };
  column(house.minX - 6.5, house.minX - 3.2, 9);
  column(house.maxX + 3, house.maxX + 6.5, 6);

  // A stepping-stone path along the east side.
  const tiles: Tile[] = [];
  const size = 0.9;
  for (let y = house.minY + 0.6; y < house.maxY - 1; y += size + 0.08) {
    tiles.push({ x: house.maxX + 1.4, y, size });
    if (rand() > 0.45) tiles.push({ x: house.maxX + 1.4 + size + 0.08, y, size });
  }
  return { trees, tiles };
}

