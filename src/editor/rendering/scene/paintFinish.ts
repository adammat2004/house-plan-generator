import type { FinishTile } from "./finishes";

/** The parts of a 2D canvas context painting a finish needs (a real one, or a recording one in tests). */
export type FinishContext = Pick<
  CanvasRenderingContext2D,
  "save" | "restore" | "scale" | "beginPath" | "moveTo" | "lineTo" | "closePath" | "arc" | "fill" | "stroke" | "fillRect" | "createRadialGradient"
> & { fillStyle: CanvasRenderingContext2D["fillStyle"]; strokeStyle: CanvasRenderingContext2D["strokeStyle"]; lineWidth: number; lineJoin: CanvasLineJoin };

/** Pixel size of one tile at a density: whole pixels, so the tile repeats without a seam. */
export function tilePixels(tile: Pick<FinishTile, "width" | "height">, pxPerMetre: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(tile.width * pxPerMetre)), height: Math.max(1, Math.round(tile.height * pxPerMetre)) };
}

/**
 * Paints one tile of a finish onto a canvas sized by tilePixels. Both axes
 * are scaled to the whole-pixel size, so a tile 1.2 m across drawn at 32 px/m
 * is exactly 38 px and still meets itself at the edge.
 */
export function paintTile(ctx: FinishContext, tile: FinishTile, pxPerMetre: number) {
  const px = tilePixels(tile, pxPerMetre);
  ctx.save();
  ctx.scale(px.width / tile.width, px.height / tile.height);
  ctx.fillStyle = tile.base;
  ctx.fillRect(0, 0, tile.width, tile.height);
  ctx.lineJoin = "miter";
  for (const part of tile.parts) {
    if (part.spot) {
      const { x, y, r } = part.spot;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, part.fill ?? "rgba(0, 0, 0, 0.1)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (!part.ring) continue;
    ctx.beginPath();
    part.ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    if (part.fill) {
      ctx.fillStyle = part.fill;
      ctx.fill();
    }
    if (part.stroke && part.width) {
      ctx.strokeStyle = part.stroke;
      // At least a hairline, so joints don't vanish when zoomed out.
      ctx.lineWidth = Math.max(part.width, 0.6 / pxPerMetre);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A finish tile on a canvas of its own, or null where there's no DOM (server, tests). */
export function finishCanvas(tile: FinishTile, pxPerMetre: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const px = tilePixels(tile, pxPerMetre);
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintTile(ctx, tile, pxPerMetre);
  return canvas;
}
