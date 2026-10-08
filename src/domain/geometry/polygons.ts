import * as polygonClippingNs from "polygon-clipping";
import type { MultiPolygon as PcMultiPolygon, Polygon as PcPolygon, Ring as PcRing } from "polygon-clipping";
import type { Point2 } from "../plan/types";
import { EPS } from "./numeric";
import { rectFromPoints, type Rect } from "./vector";

/**
 * Small adapter around polygon-clipping. The rest of the domain works with
 * Point2 rings; only this module knows the library's pair format.
 */

// polygon-clipping ships a default export in its ESM build but declares named exports.
const pc: typeof polygonClippingNs =
  (polygonClippingNs as unknown as { default?: typeof polygonClippingNs }).default ?? polygonClippingNs;

export type Ring = Point2[];

export interface PolygonWithHoles {
  outer: Ring;
  holes: Ring[];
}

export type MultiPolygon = PolygonWithHoles[];

function ringToPc(ring: Ring): PcRing {
  return ring.map((p) => [p.x, p.y] as [number, number]);
}

function polygonToPc(polygon: PolygonWithHoles): PcPolygon {
  return [ringToPc(polygon.outer), ...polygon.holes.map(ringToPc)];
}

function ringFromPc(ring: PcRing): Ring {
  const points = ring.map(([x, y]) => ({ x, y }));
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) <= EPS && Math.abs(first.y - last.y) <= EPS) points.pop();
  }
  return points;
}

function multiFromPc(mp: PcMultiPolygon): MultiPolygon {
  return mp.map((poly) => ({
    outer: ringFromPc(poly[0]),
    holes: poly.slice(1).map(ringFromPc),
  }));
}

export function union(polygons: readonly PolygonWithHoles[]): MultiPolygon {
  if (polygons.length === 0) return [];
  const [first, ...rest] = polygons.map(polygonToPc);
  return multiFromPc(pc.union(first, ...rest));
}

export function difference(subject: PolygonWithHoles, clips: readonly PolygonWithHoles[]): MultiPolygon {
  if (clips.length === 0) return [subject];
  return multiFromPc(pc.difference(polygonToPc(subject), ...clips.map(polygonToPc)));
}

export function intersection(a: PolygonWithHoles, b: PolygonWithHoles): MultiPolygon {
  return multiFromPc(pc.intersection(polygonToPc(a), polygonToPc(b)));
}

/** Signed area: positive for counterclockwise rings. */
export function ringSignedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(polygon: PolygonWithHoles): number {
  let area = Math.abs(ringSignedArea(polygon.outer));
  for (const hole of polygon.holes) area -= Math.abs(ringSignedArea(hole));
  return area;
}

export function multiPolygonArea(mp: MultiPolygon): number {
  return mp.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
}

export function pointInRing(ring: Ring, p: Point2): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(polygon: PolygonWithHoles, p: Point2): boolean {
  if (!pointInRing(polygon.outer, p)) return false;
  return !polygon.holes.some((hole) => pointInRing(hole, p));
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToRing(ring: Ring, p: Point2): number {
  let best = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    best = Math.min(best, distanceToSegment(p, ring[i], ring[(i + 1) % n]));
  }
  return best;
}

export function distanceToPolygonBoundary(polygon: PolygonWithHoles, p: Point2): number {
  let best = distanceToRing(polygon.outer, p);
  for (const hole of polygon.holes) best = Math.min(best, distanceToRing(hole, p));
  return best;
}

export function polygonBounds(polygon: PolygonWithHoles): Rect {
  return rectFromPoints(polygon.outer);
}

export function rectToPolygon(r: Rect): PolygonWithHoles {
  return {
    outer: [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ],
    holes: [],
  };
}

/** Returns the rectangle when the polygon is an axis-aligned rectangle without holes. */
export function asAxisRect(polygon: PolygonWithHoles): Rect | null {
  if (polygon.holes.length > 0 || polygon.outer.length !== 4) return null;
  const r = rectFromPoints(polygon.outer);
  for (const p of polygon.outer) {
    const onX = Math.abs(p.x - r.minX) <= EPS || Math.abs(p.x - r.maxX) <= EPS;
    const onY = Math.abs(p.y - r.minY) <= EPS || Math.abs(p.y - r.maxY) <= EPS;
    if (!onX || !onY) return null;
  }
  return r;
}

/** Overlap area of two polygons, with a fast path for axis-aligned rectangles. */
export function overlapArea(a: PolygonWithHoles, b: PolygonWithHoles): number {
  const ba = polygonBounds(a);
  const bb = polygonBounds(b);
  const w = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
  const h = Math.min(ba.maxY, bb.maxY) - Math.max(ba.minY, bb.minY);
  if (w <= EPS || h <= EPS) return 0;
  const ra = asAxisRect(a);
  const rb = asAxisRect(b);
  if (ra && rb) return w * h;
  return multiPolygonArea(intersection(a, b));
}

/** Removes vertices lying on the straight line between their neighbours. */
export function simplifyRing(ring: Ring): Ring {
  if (ring.length <= 3) return ring;
  const out: Ring = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (Math.abs(cross) > EPS * EPS) out.push(cur);
  }
  return out.length >= 3 ? out : ring;
}

/**
 * A point well inside the polygon, suitable for labels and room seeds.
 * Samples centroid and scanline candidates and keeps the one furthest from
 * the boundary.
 */
export function interiorPoint(polygon: PolygonWithHoles): Point2 {
  const bounds = polygonBounds(polygon);
  const candidates: Point2[] = [
    { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    ringCentroid(polygon.outer),
  ];
  const lines = 15;
  for (let i = 1; i <= lines; i++) {
    const y = bounds.minY + ((bounds.maxY - bounds.minY) * i) / (lines + 1);
    const xs = scanlineCrossings(polygon, y);
    for (let k = 0; k + 1 < xs.length; k += 2) candidates.push({ x: (xs[k] + xs[k + 1]) / 2, y });
  }
  let best: Point2 | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (!pointInPolygon(polygon, c)) continue;
    const score = distanceToPolygonBoundary(polygon, c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ?? candidates[0];
}

function ringCentroid(ring: Ring): Point2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) <= EPS * EPS) return ring[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function scanlineCrossings(polygon: PolygonWithHoles, y: number): number[] {
  const xs: number[] = [];
  for (const ring of [polygon.outer, ...polygon.holes]) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  return xs.sort((p, q) => p - q);
}
