import type { RoomPaint } from "../plan/types";

/**
 * The curated wall paints a room can take: a name for the swatch and the
 * shade used wherever walls are drawn (the 3D view, room stills). The plan
 * stores only the id, so shades can be tuned here without touching saved files.
 */
export interface Paint {
  label: string;
  /** The wall's colour in 3D. */
  shade: string;
  /** What the photo prompt calls it. */
  words: string;
}

export const PAINT_SWATCH: Record<RoomPaint, Paint> = {
  chalk: { label: "Chalk white", shade: "#f1eee7", words: "chalk white" },
  linen: { label: "Warm linen", shade: "#e6dccb", words: "warm linen beige" },
  stone: { label: "Stone grey", shade: "#c9c6bf", words: "soft stone grey" },
  sage: { label: "Sage", shade: "#b8c4ad", words: "muted sage green" },
  sky: { label: "Soft sky", shade: "#c5d4dc", words: "pale dusty blue" },
  blush: { label: "Blush", shade: "#e7cfc6", words: "soft blush pink" },
  clay: { label: "Clay", shade: "#c98f74", words: "warm terracotta clay" },
  ochre: { label: "Ochre", shade: "#d3a94f", words: "warm ochre yellow" },
  navy: { label: "Deep navy", shade: "#34455e", words: "deep navy blue" },
  charcoal: { label: "Charcoal", shade: "#4a4c4f", words: "dark charcoal grey" },
};
