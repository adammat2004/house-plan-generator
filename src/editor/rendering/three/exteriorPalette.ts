import type { Appearance, DoorColour, WallColour } from "@/domain/project/schema";

/** The exterior palette, shared by the 3D scene and the style cards, so a swatch is the colour you get. */
export const EXTERIOR: Record<Appearance["exterior"], string> = { white_render: "#f1eee7", brick: "#9d5b43", timber: "#8c6a49", dark_render: "#33373a", painted_brick: "#f1eee7", stone: "#b9b1a3" };
/** Curated wall colours for render and painted brick; the swatches in the panel read these too. */
export const WALL_COLOUR: Record<WallColour, string> = { white: "#f1eee7", cream: "#eadfc4", sage: "#a9b79c", sky: "#b9cfdc", stone_grey: "#b3b0a8", sand: "#dcc7a1", terracotta: "#c98a67", charcoal: "#33373a" };
export const DOOR_COLOUR: Record<DoorColour, string> = { white: "#eee8de", black: "#24282b", navy: "#27384f", green: "#3f5a46", red: "#8e2f2a", yellow: "#d9ad3c", oak: "#a97c50" };
export const FRAMES: Record<Appearance["frames"], string> = { black: "#24282b", white: "#f4f4f1", oak: "#b4885a", grey: "#6b7378", bronze: "#5b4a3b" };
export const ROOF: Record<Appearance["roof"], string> = { membrane: "#3b3f42", zinc: "#8d949a", slate: "#4b5157", tile: "#9b5a45" };
