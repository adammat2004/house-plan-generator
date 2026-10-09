import type { FurnitureKind, RoomType } from "../plan/types";

/**
 * The furniture and fittings a plan can hold, with typical sizes. Sizes are
 * conveniences for placing things, not regulatory or product dimensions.
 */

export const FURNITURE_CATEGORIES = ["living", "dining", "kitchen", "bedroom", "bathroom", "utility", "office", "other"] as const;
export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number];

export const FURNITURE_CATEGORY_LABEL: Record<FurnitureCategory, string> = {
  living: "Living",
  dining: "Dining",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  utility: "Utility & storage",
  office: "Office",
  other: "Other",
};

export interface FurnitureSpec {
  kind: FurnitureKind;
  label: string;
  category: FurnitureCategory;
  /** Across the front, m. */
  width: number;
  /** Front to back, m. */
  depth: number;
  height: number;
  /** "wall" pieces stand with their back to a wall; "free" ones can stand anywhere. */
  placement: "wall" | "free";
  /** Space kept clear in front of it to use it, m. */
  clearance: number;
}

const spec = (
  kind: FurnitureKind,
  label: string,
  category: FurnitureCategory,
  [width, depth, height]: [number, number, number],
  placement: FurnitureSpec["placement"],
  clearance: number,
): FurnitureSpec => ({ kind, label, category, width, depth, height, placement, clearance });

export const FURNITURE_CATALOG: Record<FurnitureKind, FurnitureSpec> = {
  sofa_3: spec("sofa_3", "Three-seat sofa", "living", [2.1, 0.9, 0.85], "wall", 0.35),
  sofa_2: spec("sofa_2", "Two-seat sofa", "living", [1.6, 0.9, 0.85], "wall", 0.35),
  armchair: spec("armchair", "Armchair", "living", [0.85, 0.85, 0.9], "free", 0.3),
  coffee_table: spec("coffee_table", "Coffee table", "living", [1.1, 0.6, 0.42], "free", 0.3),
  tv_unit: spec("tv_unit", "TV unit", "living", [1.6, 0.45, 0.5], "wall", 0.6),
  bookcase: spec("bookcase", "Bookcase", "living", [0.9, 0.35, 1.9], "wall", 0.6),
  dining_set_4: spec("dining_set_4", "Dining table for 4", "dining", [1.4, 1.7, 0.75], "free", 0.5),
  dining_set_6: spec("dining_set_6", "Dining table for 6", "dining", [1.9, 1.8, 0.75], "free", 0.5),
  sideboard: spec("sideboard", "Sideboard", "dining", [1.6, 0.45, 0.8], "wall", 0.6),
  kitchen_run: spec("kitchen_run", "Kitchen units", "kitchen", [2.4, 0.6, 0.9], "wall", 1),
  kitchen_island: spec("kitchen_island", "Kitchen island", "kitchen", [1.8, 0.9, 0.9], "free", 0.9),
  fridge: spec("fridge", "Fridge freezer", "kitchen", [0.7, 0.65, 1.85], "wall", 0.9),
  bed_single: spec("bed_single", "Single bed", "bedroom", [0.95, 2, 0.5], "wall", 0.6),
  bed_double: spec("bed_double", "Double bed", "bedroom", [1.45, 2.05, 0.5], "wall", 0.6),
  bed_king: spec("bed_king", "King bed", "bedroom", [1.65, 2.1, 0.5], "wall", 0.6),
  bedside_table: spec("bedside_table", "Bedside table", "bedroom", [0.45, 0.4, 0.55], "wall", 0),
  wardrobe: spec("wardrobe", "Wardrobe", "bedroom", [1.2, 0.6, 2.1], "wall", 0.8),
  chest_of_drawers: spec("chest_of_drawers", "Chest of drawers", "bedroom", [0.9, 0.45, 0.85], "wall", 0.7),
  desk: spec("desk", "Desk and chair", "office", [1.2, 1.1, 0.75], "wall", 0.3),
  bath: spec("bath", "Bath", "bathroom", [1.7, 0.75, 0.55], "wall", 0.6),
  shower: spec("shower", "Shower", "bathroom", [0.9, 0.9, 2], "wall", 0.6),
  toilet: spec("toilet", "Toilet", "bathroom", [0.4, 0.7, 0.8], "wall", 0.6),
  basin: spec("basin", "Basin", "bathroom", [0.6, 0.45, 0.85], "wall", 0.6),
  washing_machine: spec("washing_machine", "Washing machine", "utility", [0.6, 0.6, 0.85], "wall", 0.7),
  worktop: spec("worktop", "Worktop", "utility", [1.2, 0.6, 0.9], "wall", 0.8),
  shelving: spec("shelving", "Shelving", "utility", [1, 0.4, 1.9], "wall", 0.6),
  car: spec("car", "Car", "other", [1.85, 4.5, 1.5], "free", 0.6),
  plant: spec("plant", "Plant", "other", [0.45, 0.45, 1.1], "free", 0),
};

/** Catalog order, grouped by category, for pickers. */
export const FURNITURE_BY_CATEGORY: ReadonlyArray<{ category: FurnitureCategory; kinds: FurnitureKind[] }> = FURNITURE_CATEGORIES.map((category) => ({
  category,
  kinds: Object.values(FURNITURE_CATALOG)
    .filter((s) => s.category === category)
    .map((s) => s.kind),
}));

/** What a room of each type usually holds, most useful first. */
export const ROOM_FURNITURE: Partial<Record<RoomType, FurnitureKind[]>> = {
  living: ["sofa_3", "sofa_2", "armchair", "coffee_table", "tv_unit", "bookcase", "plant"],
  kitchen: ["kitchen_run", "fridge", "kitchen_island", "dining_set_4"],
  kitchen_dining: ["kitchen_run", "fridge", "dining_set_6", "dining_set_4", "kitchen_island", "sideboard"],
  dining: ["dining_set_6", "dining_set_4", "sideboard", "plant"],
  bedroom: ["bed_double", "bed_single", "bedside_table", "wardrobe", "chest_of_drawers", "desk"],
  primary_bedroom: ["bed_king", "bed_double", "bedside_table", "wardrobe", "chest_of_drawers", "armchair"],
  bathroom: ["bath", "shower", "toilet", "basin"],
  ensuite: ["shower", "toilet", "basin"],
  wc: ["toilet", "basin"],
  utility: ["washing_machine", "worktop", "shelving"],
  office: ["desk", "bookcase", "armchair", "shelving"],
  storage: ["shelving"],
  garage: ["car", "shelving", "worktop"],
  hall: ["shelving", "plant"],
};

/** Size limits for any piece, m. */
export const FURNITURE_LIMITS = { minSize: 0.1, maxSize: 8, minHeight: 0.02, maxHeight: 3 } as const;
