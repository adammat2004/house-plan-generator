import { finishTile, type FinishId, type OutdoorId } from "../scene/finishes";
import { finishCanvas, tilePixels } from "../scene/paintFinish";

/**
 * Floor finishes as Konva fill patterns. Each is painted once per density
 * and kept; the density follows the zoom in powers of two, so a floor stays
 * sharp close up without repainting on every zoom step.
 */
const MIN_DENSITY = 32;
const MAX_DENSITY = 512;

/** Pixels per metre to paint finishes at for a zoom (screen px per metre) and screen density. */
export function patternDensity(scale: number, pixelRatio = 1): number {
  const wanted = Math.max(1, scale * pixelRatio);
  return Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, 2 ** Math.ceil(Math.log2(wanted))));
}

const painted = new Map<string, HTMLCanvasElement | null>();

export interface FinishPattern {
  image: HTMLCanvasElement;
  /** Metres per pattern pixel on each axis, for fillPatternScale in world units. */
  scale: { x: number; y: number };
}

/** A finish's pattern at a density, or null where canvases can't be made. */
export function finishPattern(id: FinishId | OutdoorId, density: number): FinishPattern | null {
  const key = `${id}@${density}`;
  if (!painted.has(key)) painted.set(key, finishCanvas(finishTile(id), density));
  const image = painted.get(key);
  if (!image) return null;
  const tile = finishTile(id);
  const px = tilePixels(tile, density);
  return { image, scale: { x: tile.width / px.width, y: tile.height / px.height } };
}
