import type { Point2 } from "../plan/types";
import { LIMITS } from "../plan/defaults";
import { EPS, roundToPrecision } from "./numeric";
import { ringSignedArea, type Ring } from "./polygons";
import { pointsEqual, rectFromPoints, roundPoint, type Rect } from "./vector";

/**
 * Pure helpers for right-angle house outlines: closed rings whose edges are
 * horizontal or vertical, alternating, counterclockwise. Used by the
 * envelope analysis, the outline commands, the planners, rendering and the
 * draw tool, so all of them agree on what a valid outline is.
 */

/** Which way an outline edge faces (its outward normal). */
export type EnvelopeSide = "south" | "east" | "north" | "west";

export type OutlineFamily = "rectangle" | "L" | "T" | "U" | "Z" | "custom";

export const FAMILY_WORD: Record<OutlineFamily, string> = {
  rectangle: "rectangular",
  L: "L-shaped",
  T: "T-shaped",
  U: "U-shaped",
  Z: "Z-shaped",
  custom: "stepped",
};

export interface OutlineEdge {
  index: number;
  start: Point2;
  end: Point2;
  horizontal: boolean;
  facing: EnvelopeSide;
  length: number;
  /** Constant coordinate: y for horizontal edges, x for vertical ones. */
  line: number;
  /** Range of the varying coordinate. */
  min: number;
  max: number;
}

/** The outward normal of a direction on a counterclockwise ring is to its right. */
function facingOf(dx: number, dy: number): EnvelopeSide {
  if (Math.abs(dy) <= EPS) return dx > 0 ? "south" : "north";
  return dy > 0 ? "east" : "west";
}

export const SIDE_NORMAL: Record<EnvelopeSide, Point2> = {
  south: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  north: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export const OPPOSITE_SIDE: Record<EnvelopeSide, EnvelopeSide> = { north: "south", south: "north", east: "west", west: "east" };

export function outlineEdges(ring: Ring): OutlineEdge[] {
  return ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length];
    const horizontal = Math.abs(end.y - start.y) <= EPS;
    return {
      index,
      start,
      end,
      horizontal,
      facing: facingOf(end.x - start.x, end.y - start.y),
      length: Math.hypot(end.x - start.x, end.y - start.y),
      line: horizontal ? start.y : start.x,
      min: horizontal ? Math.min(start.x, end.x) : Math.min(start.y, end.y),
      max: horizontal ? Math.max(start.x, end.x) : Math.max(start.y, end.y),
    };
  });
}

const collinear = (a: Point2, b: Point2, c: Point2) =>
  (Math.abs(a.x - b.x) <= EPS && Math.abs(b.x - c.x) <= EPS) || (Math.abs(a.y - b.y) <= EPS && Math.abs(b.y - c.y) <= EPS);

/**
 * Rounds to the edit precision, drops repeated points and points in the
 * middle of a straight wall (a spike doubling back is kept, so it fails the
 * outline checks rather than vanishing), turns
 * the ring counterclockwise and starts it at the canonical corner: the
 * start of the lowest south-facing edge, westmost first.
 */
export function normalizeRing(points: readonly Point2[]): Ring {
  let ring = points.map(roundPoint);
  for (let changed = true; changed && ring.length >= 3; ) {
    changed = false;
    for (let i = 0; i < ring.length && ring.length >= 3; i++) {
      const n = ring.length;
      const prev = ring[(i - 1 + n) % n];
      const cur = ring[i];
      const next = ring[(i + 1) % n];
      // A point in the middle of a straight wall goes; a spike doubling back stays, for the checks to refuse.
      const between = (cur.x - prev.x) * (next.x - cur.x) + (cur.y - prev.y) * (next.y - cur.y) > 0;
      if (pointsEqual(cur, next) || (collinear(prev, cur, next) && between)) {
        ring = ring.filter((_, j) => j !== i);
        changed = true;
        i--;
      }
    }
  }
  if (ring.length < 3) return ring;
  if (ringSignedArea(ring) < 0) ring = [...ring].reverse();
  let best = -1;
  for (const edge of outlineEdges(ring)) {
    if (!edge.horizontal || edge.facing !== "south") continue;
    const b = best < 0 ? null : ring[best];
    if (!b || edge.start.y < b.y - EPS || (Math.abs(edge.start.y - b.y) <= EPS && edge.start.x < b.x - EPS)) best = edge.index;
  }
  return best > 0 ? [...ring.slice(best), ...ring.slice(0, best)] : ring;
}

/**
 * Moves every edge along its outward normal (negative distances move it
 * inward). On a right-angle ring each corner is where the moved horizontal
 * and vertical edges meet, for convex and reflex corners alike. Not rounded:
 * callers that store the result round it to the edit precision.
 */
export function offsetRing(ring: Ring, distance: number | readonly number[]): Ring {
  const n = ring.length;
  const edges = outlineEdges(ring);
  const d = (i: number) => (typeof distance === "number" ? distance : distance[(i + n) % n]);
  return ring.map((p, i) => {
    const prev = edges[(i - 1 + n) % n];
    const cur = edges[i];
    const h = cur.horizontal ? cur : prev;
    const v = cur.horizontal ? prev : cur;
    if (h.horizontal === v.horizontal) {
      const nrm = SIDE_NORMAL[cur.facing];
      return { x: p.x + nrm.x * d(cur.index), y: p.y + nrm.y * d(cur.index) };
    }
    return { x: p.x + SIDE_NORMAL[v.facing].x * d(v.index), y: p.y + SIDE_NORMAL[h.facing].y * d(h.index) };
  });
}

/** Wall centrelines for an outline drawn on the outside faces. */
export const outsideToAxis = (outside: Ring, thickness: number | readonly number[]) =>
  offsetRing(outside, typeof thickness === "number" ? -thickness / 2 : thickness.map((t) => -t / 2));

/** Outside faces for an outline of wall centrelines. */
export const axisToOutside = (axis: Ring, thickness: number | readonly number[]) =>
  offsetRing(axis, typeof thickness === "number" ? thickness / 2 : thickness.map((t) => t / 2));

/** Indices of the corners where the outline turns inward (to the right on a counterclockwise ring). */
export function reflexVertices(ring: Ring): number[] {
  const n = ring.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross < -EPS) out.push(i);
  }
  return out;
}

/**
 * The outline's family from where its inward corners fall: none is a
 * rectangle, one an L. Two side by side make a U, two separated by two
 * outward corners a T (a bay or a wing off one side), by three a Z.
 */
export function classifyOutline(ring: Ring): OutlineFamily {
  const reflex = reflexVertices(ring);
  if (reflex.length === 0) return "rectangle";
  if (reflex.length === 1) return "L";
  if (reflex.length === 2 && ring.length === 8) {
    const gap = Math.min(reflex[1] - reflex[0], ring.length - (reflex[1] - reflex[0]));
    if (gap === 1) return "U";
    if (gap === 3) return "T";
    if (gap === 4) return "Z";
  }
  return "custom";
}

/** "near the north-east corner", "along the south side", "in the middle". */
export function whereIn(bounds: Rect, p: Point2): string {
  const third = (v: number, lo: number, hi: number) => (hi - lo <= EPS ? 1 : Math.min(2, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * 3))));
  const col = third(p.x, bounds.minX, bounds.maxX);
  const row = third(p.y, bounds.minY, bounds.maxY);
  const ns = row === 2 ? "north" : row === 0 ? "south" : "";
  const ew = col === 2 ? "east" : col === 0 ? "west" : "";
  if (ns && ew) return `near the ${ns}-${ew} corner`;
  if (ns || ew) return `along the ${ns || ew} side`;
  return "in the middle";
}

export interface OutlineProblem {
  message: string;
  /** Indices of the edges at fault. */
  edges: number[];
}

const metres = (v: number) => `${Number(roundToPrecision(v).toFixed(2))} m`;

/**
 * Checks a ring of wall centrelines (counterclockwise, as stored) against
 * every outline rule except wall existence. Null when it is a valid house
 * outline. Shared by the envelope analysis and the draw tool's live check.
 */
export function checkOutlineRing(ring: Ring, thickness: number | readonly number[]): OutlineProblem | null {
  const n = ring.length;
  const t = (i: number) => (typeof thickness === "number" ? thickness : thickness[i]);
  if (n < 4) return { message: "The house outline needs at least four corners.", edges: [] };
  if (n > LIMITS.maxOutlineEdges) return { message: `The house outline can have at most ${LIMITS.maxOutlineEdges} walls.`, edges: [] };
  const edges = outlineEdges(ring);
  for (const e of edges) {
    const dx = Math.abs(e.end.x - e.start.x);
    const dy = Math.abs(e.end.y - e.start.y);
    if (dx <= EPS && dy <= EPS) return { message: "The house outline has a wall of zero length.", edges: [e.index] };
    if (dx > EPS && dy > EPS) return { message: "House outline walls must be horizontal or vertical.", edges: [e.index] };
  }
  for (const e of edges) {
    const next = edges[(e.index + 1) % n];
    if (e.horizontal === next.horizontal) return { message: "Outline walls must alternate horizontal and vertical.", edges: [e.index, next.index] };
  }
  if (n % 2 !== 0) return { message: "The house outline must have an even number of walls.", edges: [] };
  if (ringSignedArea(ring) <= EPS) return { message: "Outline walls must run counterclockwise.", edges: edges.map((e) => e.index) };
  const bounds = rectFromPoints(ring);

  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = edges[i];
      const b = edges[j];
      let touch: Point2 | null = null;
      if (a.horizontal !== b.horizontal) {
        const h = a.horizontal ? a : b;
        const v = a.horizontal ? b : a;
        if (v.line >= h.min - EPS && v.line <= h.max + EPS && h.line >= v.min - EPS && h.line <= v.max + EPS) touch = { x: v.line, y: h.line };
      } else if (Math.abs(a.line - b.line) <= EPS && Math.min(a.max, b.max) - Math.max(a.min, b.min) >= -EPS) {
        const at = Math.max(a.min, b.min);
        touch = a.horizontal ? { x: at, y: a.line } : { x: a.line, y: at };
      }
      if (touch) return { message: `The house outline touches itself ${whereIn(bounds, touch)}.`, edges: [i, j] };
    }
  }

  // A step must at least clear the walls either side of it, or they collide.
  for (const e of edges) {
    const need = Math.max(LIMITS.minOutlineStep, (t((e.index - 1 + n) % n) + t((e.index + 1) % n)) / 2);
    if (e.length < need - EPS) {
      return {
        message: `A step in the house outline ${whereIn(bounds, e.start)} is ${metres(e.length)}; steps must be at least ${Math.round(need * 1000)} mm.`,
        edges: [e.index],
      };
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = edges[i];
      const b = edges[j];
      if (a.horizontal !== b.horizontal) continue;
      const nrm = SIDE_NORMAL[a.facing];
      const nb = SIDE_NORMAL[b.facing];
      if (nrm.x + nb.x !== 0 || nrm.y + nb.y !== 0) continue;
      const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
      if (overlap <= EPS) continue;
      const gap = Math.abs(a.line - b.line);
      const need = (t(i) + t(j)) / 2 + LIMITS.minHouseClearSpan;
      if (gap >= need - EPS) continue;
      const mid = (Math.max(a.min, b.min) + Math.min(a.max, b.max)) / 2;
      const at = a.horizontal ? { x: mid, y: (a.line + b.line) / 2 } : { x: (a.line + b.line) / 2, y: mid };
      // b on a's outside: the gap between them is garden, not house.
      const outside = (a.horizontal ? nrm.y * (b.line - a.line) : nrm.x * (b.line - a.line)) > 0;
      const clear = gap - (t(i) + t(j)) / 2;
      return {
        message: outside
          ? `Two parts of the house ${whereIn(bounds, at)} are only ${metres(Math.max(0, clear))} apart; leave at least ${metres(LIMITS.minHouseClearSpan)} between them.`
          : `The house is only ${metres(Math.max(0, clear))} wide inside ${whereIn(bounds, at)}; it needs at least ${metres(LIMITS.minHouseClearSpan)}.`,
        edges: [i, j],
      };
    }
  }

  // Any two walls that aren't neighbours, or neighbours of one step, keep
  // clear of each other, corner to corner included.
  const box = (e: OutlineEdge) =>
    e.horizontal ? { minX: e.min, maxX: e.max, minY: e.line, maxY: e.line } : { minX: e.line, maxX: e.line, minY: e.min, maxY: e.max };
  for (let i = 0; i < n; i++) {
    for (let j = i + 3; j < n; j++) {
      if (n - (j - i) < 3) continue;
      const a = box(edges[i]);
      const b = box(edges[j]);
      const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
      const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
      const clear = Math.max(dx, dy) - (t(i) + t(j)) / 2;
      if (clear >= LIMITS.minHouseClearSpan - EPS) continue;
      const at = { x: (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2, y: (Math.max(a.minY, b.minY) + Math.min(a.maxY, b.maxY)) / 2 };
      return {
        message: `The house outline comes within ${metres(Math.max(0, clear))} of itself ${whereIn(bounds, at)}; keep its parts at least ${metres(LIMITS.minHouseClearSpan)} apart.`,
        edges: [i, j],
      };
    }
  }
  return null;
}

/** True when p lies on the ring's boundary. */
export function pointOnRing(ring: Ring, p: Point2, eps = EPS): boolean {
  return outlineEdges(ring).some((e) =>
    e.horizontal
      ? Math.abs(p.y - e.line) <= eps && p.x >= e.min - eps && p.x <= e.max + eps
      : Math.abs(p.x - e.line) <= eps && p.y >= e.min - eps && p.y <= e.max + eps,
  );
}

/**
 * Splits a right-angle polygon into rectangles by horizontal slabs, merging
 * slabs that continue straight up. Used for roofs and ceilings.
 */
export function slabPartition(ring: Ring): Rect[] {
  const ys = [...new Set(ring.map((p) => p.y))].sort((a, b) => a - b);
  const verticals = outlineEdges(ring).filter((e) => !e.horizontal);
  const open: Rect[] = [];
  const done: Rect[] = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const y0 = ys[k];
    const y1 = ys[k + 1];
    const mid = (y0 + y1) / 2;
    const xs = verticals
      .filter((e) => e.min < mid && e.max > mid)
      .map((e) => e.line)
      .sort((a, b) => a - b);
    const slab: Array<[number, number]> = [];
    for (let i = 0; i + 1 < xs.length; i += 2) slab.push([xs[i], xs[i + 1]]);
    const still: Rect[] = [];
    for (const r of open) {
      const match = slab.findIndex(([a, b]) => Math.abs(a - r.minX) <= EPS && Math.abs(b - r.maxX) <= EPS);
      if (match >= 0) {
        still.push({ ...r, maxY: y1 });
        slab.splice(match, 1);
      } else done.push(r);
    }
    for (const [a, b] of slab) still.push({ minX: a, maxX: b, minY: y0, maxY: y1 });
    open.splice(0, open.length, ...still);
  }
  return [...done, ...open].sort((a, b) => a.minY - b.minY || a.minX - b.minX);
}

/** Outside-face ring of a width × depth rectangle with its lower-left corner at the origin. */
export const rectangleRing = (width: number, depth: number): Ring => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: depth },
  { x: 0, y: depth },
];
