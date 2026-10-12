import { DEFAULT_INTERIOR_STYLE } from "@/domain/design/renderRequest";
import type { InteriorStyle } from "@/domain/project/schema";

/**
 * Furniture colours by interior style. The style sets the woods, fabrics,
 * bedding and rugs; whites, worktops, metal, water and plants stay the same.
 * The plan uses light versions so the floors and labels still read; 3D uses
 * the colours as they'd look in the room.
 */

/** What a part of a piece is made of. */
export type FurnitureMaterial = "wood" | "fabric" | "cushion" | "linen" | "duvet" | "white" | "worktop" | "metal" | "dark" | "water" | "leaf" | "rug";

type Styled = "wood" | "fabric" | "cushion" | "duvet" | "rug";

const PLAN: Record<InteriorStyle, Record<Styled, string>> = {
  warm_minimal: { wood: "#c4a07a", fabric: "#d9d3c7", cushion: "#e8e3d9", duvet: "#e6e0d4", rug: "#e9e1d2" },
  modern: { wood: "#a99583", fabric: "#c5c8ca", cushion: "#d9dcde", duvet: "#e3e6e9", rug: "#d8d6d2" },
  scandinavian: { wood: "#e0cba9", fabric: "#d9d9d3", cushion: "#eaeae5", duvet: "#e3eaee", rug: "#eeede8" },
  industrial: { wood: "#9c7a5a", fabric: "#a7a6a1", cushion: "#bfbdb7", duvet: "#d0cec9", rug: "#c9bfb1" },
  farmhouse: { wood: "#bb956a", fabric: "#d4c8b2", cushion: "#e2dacb", duvet: "#d7dfe6", rug: "#d9c6ab" },
  coastal: { wood: "#dccbb0", fabric: "#cfdae1", cushion: "#e1e8ec", duvet: "#d6e3ec", rug: "#e8e4d9" },
};

const PLAN_FIXED: Record<Exclude<FurnitureMaterial, Styled>, string> = {
  linen: "#f7f4ee",
  white: "#fdfcf9",
  worktop: "#e9e6e0",
  metal: "#dfe1e2",
  dark: "#4a4f4d",
  water: "#e3ecef",
  leaf: "#b7c99a",
};

const MODEL: Record<InteriorStyle, Record<Exclude<Styled, "rug">, string>> = {
  warm_minimal: { wood: "#a9825a", fabric: "#b9b2a6", cushion: "#cec7ba", duvet: "#b9c6cf" },
  modern: { wood: "#7d6a5a", fabric: "#8f9498", cushion: "#aeb2b5", duvet: "#c3c8cc" },
  scandinavian: { wood: "#c9a97f", fabric: "#c4c3bc", cushion: "#d8d7d0", duvet: "#c8d3da" },
  industrial: { wood: "#6f5238", fabric: "#6d6c68", cushion: "#8d8b85", duvet: "#a3a19b" },
  farmhouse: { wood: "#94704b", fabric: "#c2b49c", cushion: "#d6ccb8", duvet: "#aebfcc" },
  coastal: { wood: "#c2aa86", fabric: "#a9bac4", cushion: "#cbd6dc", duvet: "#a9c1d3" },
};

const planFills = new Map<InteriorStyle, Record<FurnitureMaterial, string>>();

/** Plan fills for every furniture material in a style. */
export function planFurnitureFill(style: InteriorStyle = DEFAULT_INTERIOR_STYLE): Record<FurnitureMaterial, string> {
  let fills = planFills.get(style);
  if (!fills) {
    fills = { ...PLAN_FIXED, ...(PLAN[style] ?? PLAN[DEFAULT_INTERIOR_STYLE]) };
    planFills.set(style, fills);
  }
  return fills;
}

/** The 3D colour a style gives wood, fabric, cushions and bedding, or undefined for the materials that don't change. */
export function modelFurnitureColour(style: InteriorStyle | undefined, material: string): string | undefined {
  const palette = MODEL[style ?? DEFAULT_INTERIOR_STYLE] ?? MODEL[DEFAULT_INTERIOR_STYLE];
  return material in palette ? palette[material as keyof typeof palette] : undefined;
}
