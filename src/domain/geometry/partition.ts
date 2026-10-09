import type { Point2 } from "../plan/types";
import { EPS, roundToPrecision } from "./numeric";
import { outlineEdges, reflexVertices, type EnvelopeSide, type OutlineEdge } from "./outline";
import { pointInRing, type Ring } from "./polygons";
import type { Rect } from "./vector";

/**
 * Splits a right-angle outline into rectangles a layout planner can fill:
 * "cores" deep enough to hold rooms (the wings of an L, T or U) and thin
 * "fringe" pieces (a bay, the strip beside a notch) that join the core room
 * next to them.
 *
 * Every inward corner is cut along one of its two walls, into the house
 * until the cut meets the outline. Trying both choices at every corner
 * gives every way of cutting; pieces that share a whole side are merged,
 * and the ways are ranked: fewest cores, then the thickest, then the least
 * fringe.
 */

export interface FringePiece {
  rect: Rect;
  /** The core it hangs off. */
  core: number;
  /** Which side of the fringe piece faces its core. */
  toward: EnvelopeSide;
}

export interface OutlinePartition {
  cores: Rect[];
  fringe: FringePiece[];
  /** Which wall each inward corner was cut along: bit i set means the outgoing wall. */
  mask: number;
}

export interface PartitionOptions {
  /** Thinnest core, m. */
  minCore: number;
  /** Deepest fringe piece, m. */
  maxFringe: number;
  /** Most inward corners worth enumerating. */
  maxReflex: number;
  /** How many distinct partitions to return. */
  limit: number;
}

export const DEFAULT_PARTITION: PartitionOptions = { minCore: 3, maxFringe: 2.4, maxReflex: 10, limit: 3 };

interface Cut {
  horizontal: boolean;
  line: number;
  min: number;
  max: number;
}

/** Nearest point of the outline along a ray from corner i, ignoring the corner's own walls. */
function castRay(edges: OutlineEdge[], i: number, from: Point2, dir: Point2): Point2 | null {
  const n = edges.length;
  const skip = new Set([i, (i - 1 + n) % n]);
  let best = Infinity;
  for (const e of edges) {
    if (skip.has(e.index)) continue;
    const horizontalRay = Math.abs(dir.y) < EPS;
    const coord = horizontalRay ? from.x : from.y;
    const sign = horizontalRay ? dir.x : dir.y;
    const across = horizontalRay ? from.y : from.x;
    let t = Infinity;
    if (e.horizontal !== horizontalRay) {
      // The wall crosses the ray's line.
      if (across >= e.min - EPS && across <= e.max + EPS) t = (e.line - coord) * sign;
    } else if (Math.abs(e.line - across) < EPS) {
      // The wall continues along the ray's line: the ray stops at its near end.
      t = Math.min(...[e.min, e.max].map((v) => (v - coord) * sign).filter((v) => v > EPS));
    }
    if (t > EPS && t < best) best = t;
  }
  if (!Number.isFinite(best)) return null;
  return { x: roundToPrecision(from.x + dir.x * best), y: roundToPrecision(from.y + dir.y * best) };
}

const area = (r: Rect) => (r.maxX - r.minX) * (r.maxY - r.minY);
const minSide = (r: Rect) => Math.min(r.maxX - r.minX, r.maxY - r.minY);
const eq = (a: number, b: number) => Math.abs(a - b) < EPS;

/** Length of the boundary two rectangles share, and which side of `a` it is on. */
export function sharedSide(a: Rect, b: Rect): { side: EnvelopeSide; length: number } | null {
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (ox > EPS && eq(a.maxY, b.minY)) return { side: "north", length: ox };
  if (ox > EPS && eq(a.minY, b.maxY)) return { side: "south", length: ox };
  if (oy > EPS && eq(a.maxX, b.minX)) return { side: "east", length: oy };
  if (oy > EPS && eq(a.minX, b.maxX)) return { side: "west", length: oy };
  return null;
}

/** Rectangles from one way of cutting, or null if it doesn't give rectangles. */
function cutInto(ring: Ring, edges: OutlineEdge[], cuts: Cut[]): Rect[] | null {
  const xs = [...new Set([...ring.map((p) => p.x), ...cuts.flatMap((c) => (c.horizontal ? [c.min, c.max] : [c.line]))])].sort((a, b) => a - b);
  const ys = [...new Set([...ring.map((p) => p.y), ...cuts.flatMap((c) => (c.horizontal ? [c.line] : [c.min, c.max]))])].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const inside: boolean[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) inside.push(pointInRing(ring, { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 }));
  const walls = [...edges.map((e) => ({ horizontal: e.horizontal, line: e.line, min: e.min, max: e.max })), ...cuts];
  const blocked = (horizontal: boolean, line: number, lo: number, hi: number) =>
    walls.some((w) => w.horizontal === horizontal && eq(w.line, line) && w.min <= lo + EPS && w.max >= hi - EPS);
  const parent = inside.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!inside[k]) continue;
      if (i + 1 < nx && inside[k + 1] && !blocked(false, xs[i + 1], ys[j], ys[j + 1])) parent[find(k)] = find(k + 1);
      if (j + 1 < ny && inside[k + nx] && !blocked(true, ys[j + 1], xs[i], xs[i + 1])) parent[find(k)] = find(k + nx);
    }
  }
  const groups = new Map<number, { rect: Rect; cells: number }>();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!inside[k]) continue;
      const root = find(k);
      const g = groups.get(root);
      const cell = { minX: xs[i], maxX: xs[i + 1], minY: ys[j], maxY: ys[j + 1] };
      if (!g) groups.set(root, { rect: cell, cells: area(cell) });
      else {
        g.rect = { minX: Math.min(g.rect.minX, cell.minX), maxX: Math.max(g.rect.maxX, cell.maxX), minY: Math.min(g.rect.minY, cell.minY), maxY: Math.max(g.rect.maxY, cell.maxY) };
        g.cells += area(cell);
      }
    }
  }
  const rects: Rect[] = [];
  for (const g of groups.values()) {
    if (Math.abs(area(g.rect) - g.cells) > 1e-6) return null;
    rects.push(g.rect);
  }
  // Merge pieces that share a whole side.
  for (let merged = true; merged; ) {
    merged = false;
    rects.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
    for (let a = 0; a < rects.length && !merged; a++) {
      for (let b = a + 1; b < rects.length && !merged; b++) {
        const p = rects[a];
        const q = rects[b];
        const sameX = eq(p.minX, q.minX) && eq(p.maxX, q.maxX) && (eq(p.maxY, q.minY) || eq(q.maxY, p.minY));
        const sameY = eq(p.minY, q.minY) && eq(p.maxY, q.maxY) && (eq(p.maxX, q.minX) || eq(q.maxX, p.minX));
        if (sameX || sameY) {
          rects.splice(b, 1);
          rects[a] = { minX: Math.min(p.minX, q.minX), maxX: Math.max(p.maxX, q.maxX), minY: Math.min(p.minY, q.minY), maxY: Math.max(p.maxY, q.maxY) };
          merged = true;
        }
      }
    }
  }
  return rects;
}

const OPPOSITE: Record<EnvelopeSide, EnvelopeSide> = { north: "south", south: "north", east: "west", west: "east" };

/** Cores and fringe from rectangles; null if a fringe piece is too deep or hangs off nothing. */
function classify(rects: Rect[], opts: PartitionOptions): Pick<OutlinePartition, "cores" | "fringe"> | null {
  const cores = rects.filter((r) => minSide(r) >= opts.minCore - EPS).sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  if (!cores.length) return null;
  const thin = rects.filter((r) => minSide(r) < opts.minCore - EPS);
  const fringe: FringePiece[] = [];
  const attached: Rect[] = [];
  let pending = thin;
  // Fringe hangs off the core it shares most boundary with, or off fringe already attached.
  while (pending.length) {
    const next: Rect[] = [];
    for (const f of pending) {
      let best: { core: number; toward: EnvelopeSide; length: number } | null = null;
      for (let index = 0; index < cores.length; index++) {
        const s = sharedSide(f, cores[index]);
        if (s && (!best || s.length > best.length + EPS)) best = { core: index, toward: s.side, length: s.length };
      }
      for (let index = 0; !best && index < attached.length; index++) {
        const s = sharedSide(f, attached[index]);
        if (s) best = { core: fringe[index].core, toward: s.side, length: s.length };
      }
      if (!best) {
        next.push(f);
        continue;
      }
      const { core, toward } = best;
      const depth = toward === "north" || toward === "south" ? f.maxY - f.minY : f.maxX - f.minX;
      if (depth > opts.maxFringe + EPS) return null;
      fringe.push({ rect: f, core, toward });
      attached.push(f);
    }
    if (next.length === pending.length) return null;
    pending = next;
  }
  return { cores, fringe };
}

/** Up to `limit` distinct ways to split the outline, best first; empty when it can't be split into wings. */
export function partitionOutline(ring: Ring, options: Partial<PartitionOptions> = {}): OutlinePartition[] {
  const opts = { ...DEFAULT_PARTITION, ...options };
  const edges = outlineEdges(ring);
  const reflex = reflexVertices(ring);
  if (reflex.length > opts.maxReflex) return [];
  const n = ring.length;
  const found: Array<OutlinePartition & { key: string; score: number[] }> = [];
  const seen = new Set<string>();
  for (let mask = 0; mask < 1 << reflex.length; mask++) {
    const cuts: Cut[] = [];
    let ok = true;
    reflex.forEach((v, bit) => {
      const p = ring[v];
      const incoming = edges[(v - 1 + n) % n];
      const outgoing = edges[v];
      // Continue the incoming wall past the corner, or the outgoing wall back past it.
      const base = mask & (1 << bit) ? outgoing : incoming;
      const sign = mask & (1 << bit) ? -1 : 1;
      const d = { x: Math.sign(base.end.x - base.start.x) * sign, y: Math.sign(base.end.y - base.start.y) * sign };
      const hit = castRay(edges, v, p, d);
      if (!hit) {
        ok = false;
        return;
      }
      const horizontal = Math.abs(d.y) < EPS;
      cuts.push(
        horizontal
          ? { horizontal, line: p.y, min: Math.min(p.x, hit.x), max: Math.max(p.x, hit.x) }
          : { horizontal, line: p.x, min: Math.min(p.y, hit.y), max: Math.max(p.y, hit.y) },
      );
    });
    if (!ok) continue;
    const rects = cutInto(ring, edges, cuts);
    if (!rects) continue;
    const parts = classify(rects, opts);
    if (!parts) continue;
    const key = JSON.stringify([parts.cores, parts.fringe.map((f) => f.rect).sort((a, b) => a.minY - b.minY || a.minX - b.minX)]);
    if (seen.has(key)) continue;
    seen.add(key);
    const fringeArea = parts.fringe.reduce((sum, f) => sum + area(f.rect), 0);
    const score = [parts.cores.length, -Math.round(Math.min(...parts.cores.map(minSide)) * 100), Math.round(fringeArea * 100), -Math.round(Math.max(...parts.cores.map(area)) * 100), mask];
    found.push({ ...parts, mask, key, score });
  }
  found.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    return 0;
  });
  return found.slice(0, opts.limit).map(({ cores, fringe, mask }) => ({ cores, fringe, mask }));
}

export { OPPOSITE };
