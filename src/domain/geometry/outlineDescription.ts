import type { EnvelopeInfo } from "./envelope";
import { FAMILY_WORD, type OutlineFamily } from "./outline";
import { partitionOutline } from "./partition";
import { ringSignedArea } from "./polygons";

/**
 * How to describe a house's outline in words. A rectangle with a shallow
 * bay has the corners of a T, but nobody would call it T-shaped; nor is a
 * house with one corner cut away much of an L.
 */
export interface OutlineDescription {
  /** "L-shaped", "rectangular with a bay", … */
  words: string;
  /** The family for image prompts, or null when the house reads as a rectangle. */
  shape: Exclude<OutlineFamily, "rectangle"> | null;
}

const cache = new WeakMap<EnvelopeInfo, OutlineDescription>();

export function describeOutline(info: EnvelopeInfo): OutlineDescription {
  const hit = cache.get(info);
  if (hit) return hit;
  const result = describe(info);
  cache.set(info, result);
  return result;
}

function describe(info: EnvelopeInfo): OutlineDescription {
  if (info.isRectangle) return { words: FAMILY_WORD.rectangle, shape: null };
  const [best] = partitionOutline(info.axisRing, { limit: 1 });
  if (best && best.cores.length === 1) {
    // One room-deep core: the rest is bays sticking out, or a corner cut away.
    const fringe = best.fringe.reduce((sum, f) => sum + (f.rect.maxX - f.rect.minX) * (f.rect.maxY - f.rect.minY), 0);
    const r = info.axisRect;
    const cutAway = (r.maxX - r.minX) * (r.maxY - r.minY) - ringSignedArea(info.axisRing);
    if (fringe <= cutAway + 1e-9) return { words: best.fringe.length > 1 ? "rectangular with bays" : "rectangular with a bay", shape: null };
    return { words: info.reflexCount > 1 ? "rectangular with cut-away corners" : "rectangular with a cut-away corner", shape: null };
  }
  return { words: FAMILY_WORD[info.family], shape: info.family === "rectangle" ? null : info.family };
}
