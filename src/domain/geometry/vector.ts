import type { Point2 } from "../plan/types";
import { EPS, roundToPrecision } from "./numeric";

export const add = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point2, k: number): Point2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
export const length = (a: Point2): number => Math.hypot(a.x, a.y);
export const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function pointsEqual(a: Point2, b: Point2, eps = EPS): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

export function roundPoint(p: Point2): Point2 {
  return { x: roundToPrecision(p.x), y: roundToPrecision(p.y) };
}

/** Stable map key for a point at sub-millimetre resolution. */
export function pointKey(p: Point2): string {
  return `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function rectFromPoints(points: readonly Point2[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function rectsOverlap(a: Rect, b: Rect, eps = EPS): boolean {
  return a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minY < b.maxY - eps && b.minY < a.maxY - eps;
}

export function rectContainsPoint(r: Rect, p: Point2, eps = EPS): boolean {
  return p.x >= r.minX - eps && p.x <= r.maxX + eps && p.y >= r.minY - eps && p.y <= r.maxY + eps;
}

export function rectUnion(a: Rect, b: Rect): Rect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
