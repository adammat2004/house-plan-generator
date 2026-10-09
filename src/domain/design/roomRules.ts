import type { RoomType } from "../plan/types";

/**
 * What makes a room of each type work, in one place. The program sizes
 * rooms from it, the planners shape them by it, and the plan-sense checker
 * judges finished plans against it, so the three can't disagree about what a
 * sensible bathroom is.
 */

export type WindowSize = "large" | "standard" | "small" | "none";

export interface RoomRule {
  zone: "day" | "night";
  window: WindowSize;
  /** Lived in, so it needs daylight: a window in an outside wall. */
  habitable: boolean;
  /** Narrowest clear width that works, wall face to wall face, m. */
  minWidth: number;
  /** Long side over short side beyond which the room reads as a corridor. */
  maxProportion: number;
  /** Smallest clear floor area that works, m². */
  minArea: number;
}

export const ROOM_RULES: Record<RoomType, RoomRule> = {
  living: { zone: "day", window: "large", habitable: true, minWidth: 2.9, maxProportion: 2.2, minArea: 11 },
  kitchen_dining: { zone: "day", window: "large", habitable: true, minWidth: 2.7, maxProportion: 2.6, minArea: 13 },
  kitchen: { zone: "day", window: "standard", habitable: true, minWidth: 2.3, maxProportion: 2.6, minArea: 6.5 },
  dining: { zone: "day", window: "standard", habitable: true, minWidth: 2.3, maxProportion: 2.2, minArea: 7.5 },
  office: { zone: "day", window: "standard", habitable: true, minWidth: 2.0, maxProportion: 2.4, minArea: 5.5 },
  utility: { zone: "day", window: "small", habitable: false, minWidth: 1.5, maxProportion: 3.2, minArea: 2.8 },
  garage: { zone: "day", window: "none", habitable: false, minWidth: 2.8, maxProportion: 2.8, minArea: 14 },
  storage: { zone: "day", window: "none", habitable: false, minWidth: 0.8, maxProportion: 4.5, minArea: 0.8 },
  hall: { zone: "day", window: "none", habitable: false, minWidth: 0.9, maxProportion: Infinity, minArea: 0 },
  primary_bedroom: { zone: "night", window: "standard", habitable: true, minWidth: 2.7, maxProportion: 1.9, minArea: 11 },
  bedroom: { zone: "night", window: "standard", habitable: true, minWidth: 2.1, maxProportion: 2.1, minArea: 7 },
  ensuite: { zone: "night", window: "none", habitable: false, minWidth: 1.2, maxProportion: 2.6, minArea: 2.8 },
  bathroom: { zone: "night", window: "small", habitable: false, minWidth: 1.5, maxProportion: 2.6, minArea: 3.8 },
  wc: { zone: "night", window: "small", habitable: false, minWidth: 0.8, maxProportion: 2.8, minArea: 1.2 },
  other: { zone: "day", window: "standard", habitable: false, minWidth: 0, maxProportion: Infinity, minArea: 0 },
  unspecified: { zone: "day", window: "standard", habitable: false, minWidth: 0, maxProportion: Infinity, minArea: 0 },
};

/** Internal wall allowance between a clear width and a slot measured wall centre to wall centre, m. */
export const SLOT_WALL = 0.1;

/**
 * The rooms the program can ask for: the type, the target clear area at
 * standard size (m²), and the narrowest slot along a band, wall centre to
 * wall centre (m). Slots are at least the type's clear minimum plus a wall.
 */
export const ROOM_KINDS = {
  kitchen_dining: { type: "kitchen_dining", target: 18, minSlot: 2.8 },
  kitchen: { type: "kitchen", target: 11, minSlot: 2.4 },
  dining: { type: "dining", target: 10, minSlot: 2.4 },
  living: { type: "living", target: 18, minSlot: 3 },
  snug: { type: "living", target: 12, minSlot: 3 },
  utility: { type: "utility", target: 4.5, minSlot: 1.8 },
  office: { type: "office", target: 8, minSlot: 2.4 },
  garage: { type: "garage", target: 18, minSlot: 3 },
  master: { type: "primary_bedroom", target: 14, minSlot: 2.9 },
  master_with_ensuite: { type: "primary_bedroom", target: 14, minSlot: 3.3 },
  double: { type: "bedroom", target: 11, minSlot: 2.6 },
  single: { type: "bedroom", target: 8, minSlot: 2.3 },
  bathroom: { type: "bathroom", target: 5.5, minSlot: 1.8 },
  extra_bathroom: { type: "bathroom", target: 4.5, minSlot: 1.8 },
  wc: { type: "wc", target: 2, minSlot: 1.2 },
} as const satisfies Record<string, { type: RoomType; target: number; minSlot: number }>;

export type RoomKind = keyof typeof ROOM_KINDS;

/** An open plan's target is its living, kitchen and dining targets together, times this: one space needs less than three. */
export const OPEN_PLAN_SHARE = 0.9;

/** Narrowest slot for an open-plan kitchen, living and dining space, m. */
export const OPEN_PLAN_MIN_SLOT = 3.6;

/** Target area of a generated ensuite, m². */
export const ENSUITE_TARGET = 3.5;
