import { furnitureRect } from "../../furniture/geometry";
import { EPS, roundToPrecision } from "../../geometry/numeric";
import type { Level } from "../../plan/types";

/**
 * Furniture going with the walls it stands against. When a wall moves, a
 * piece backed onto it (or standing beside it, either side) moves with it,
 * so the bed stays against its wall as the room grows; a piece the wall
 * would run into is pushed ahead of it, just clear of its new face.
 * Everything else stays where it is. Furniture never blocks an edit.
 */

/** A straight stretch of wall moving square to itself. */
export interface WallMove {
  /** Runs along x (moving in y), or along y (moving in x). */
  horizontal: boolean;
  /** Where its centreline lies before the move. */
  line: number;
  /** The stretch it covers along its length. */
  min: number;
  max: number;
  thickness: number;
  /** How far it moves, signed. */
  delta: number;
}

/** A piece this close to a wall's face (or into it) stands against it, m. */
const AGAINST = 0.15;
/** It must share this much of the wall's length, m. */
const ALONG = 0.05;

/** Where each piece of furniture goes when these walls move; the level's own furniture record if none moves. */
export function furnitureFollowing(level: Level, moves: readonly WallMove[]): Level["furniture"] {
  if (!moves.length) return level.furniture;
  let furniture: Level["furniture"] | null = null;
  for (const item of Object.values(level.furniture)) {
    const r = furnitureRect(item);
    let shift = 0;
    let horizontal = true;
    for (const m of moves) {
      horizontal = m.horizontal;
      const [a0, a1] = m.horizontal ? [r.minX, r.maxX] : [r.minY, r.maxY];
      if (Math.min(a1, m.max) - Math.max(a0, m.min) < ALONG) continue;
      const [lo, hi] = m.horizontal ? [r.minY, r.maxY] : [r.minX, r.maxX];
      const below = m.line - m.thickness / 2 - hi;
      const above = lo - (m.line + m.thickness / 2);
      if ((below > -m.thickness && below <= AGAINST) || (above > -m.thickness && above <= AGAINST)) {
        shift = m.delta;
        break;
      }
      // Not against it, but in its way once it has moved: pushed just clear.
      const [n0, n1] = [m.line + m.delta - m.thickness / 2, m.line + m.delta + m.thickness / 2];
      if (Math.min(hi, n1) - Math.max(lo, n0) > EPS) {
        shift = (lo + hi) / 2 < m.line ? n0 - hi : n1 - lo;
        break;
      }
    }
    if (Math.abs(shift) <= EPS) continue;
    furniture ??= { ...level.furniture };
    const p = item.position;
    furniture[item.id] = { ...item, position: horizontal ? { x: p.x, y: roundToPrecision(p.y + shift) } : { x: roundToPrecision(p.x + shift), y: p.y } };
  }
  return furniture ?? level.furniture;
}
