import type { Point2 } from "@/domain/plan/types";
import type { Rect } from "@/domain/geometry/vector";

/**
 * Screen mapping for the plan. The document uses metres with Y up; the
 * viewport alone converts to CSS pixels with Y down. Changing the viewport
 * never changes document coordinates.
 */
export interface Viewport {
  /** CSS pixels per metre. */
  scale: number;
  /** Screen position of the world origin, in CSS pixels. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export const MIN_SCALE = 8;
export const MAX_SCALE = 1500;

export const DEFAULT_VIEWPORT: Viewport = { scale: 60, offsetX: 80, offsetY: 700, width: 1000, height: 760 };

export function worldToScreen(v: Viewport, p: Point2): Point2 {
  return { x: p.x * v.scale + v.offsetX, y: -p.y * v.scale + v.offsetY };
}

export function screenToWorld(v: Viewport, s: Point2): Point2 {
  return { x: (s.x - v.offsetX) / v.scale, y: -(s.y - v.offsetY) / v.scale };
}

export function pixelsToMetres(v: Viewport, px: number): number {
  return px / v.scale;
}

/** Zooms by `factor` keeping the world point under `anchor` (screen) fixed. */
export function zoomAt(v: Viewport, anchor: Point2, factor: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  if (scale === v.scale) return v;
  const world = screenToWorld(v, anchor);
  return {
    ...v,
    scale,
    offsetX: anchor.x - world.x * scale,
    offsetY: anchor.y + world.y * scale,
  };
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy };
}

/** Screen-space margins in CSS pixels, e.g. to keep a fit clear of floating chrome. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Fits a world rectangle into the viewport, inside a uniform or per-side pixel margin. */
export function fitRect(v: Viewport, rect: Rect, margin: number | Insets = 72): Viewport {
  const m = typeof margin === "number" ? { top: margin, right: margin, bottom: margin, left: margin } : margin;
  const w = Math.max(rect.maxX - rect.minX, 0.5);
  const h = Math.max(rect.maxY - rect.minY, 0.5);
  const availableW = Math.max(v.width - m.left - m.right, 50);
  const availableH = Math.max(v.height - m.top - m.bottom, 50);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availableW / w, availableH / h)));
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  const sx = m.left + availableW / 2;
  const sy = m.top + availableH / 2;
  return { ...v, scale, offsetX: sx - cx * scale, offsetY: sy + cy * scale };
}

export function resizeViewport(v: Viewport, width: number, height: number): Viewport {
  if (v.width === width && v.height === height) return v;
  // Keep the world point at the centre of the view stable.
  const centre = screenToWorld(v, { x: v.width / 2, y: v.height / 2 });
  return {
    ...v,
    width,
    height,
    offsetX: width / 2 - centre.x * v.scale,
    offsetY: height / 2 + centre.y * v.scale,
  };
}
