import { z } from "zod";

/**
 * Runtime schema for the native PlanDocument format.
 *
 * All lengths and coordinates are metres; the plan uses a right-handed
 * coordinate system (X right, Y up). The schema checks structure only;
 * geometric validity is checked by the command layer.
 */

export const CURRENT_SCHEMA_VERSION = 6 as const;

const idSchema = z.string().min(1).max(200);
const lengthSchema = z.number().positive();

export const point2Schema = z.object({
  x: z.number(),
  y: z.number(),
});

export const wallSchema = z.object({
  id: idSchema,
  startVertexId: idSchema,
  endVertexId: idSchema,
  role: z.enum(["external", "internal"]),
  thickness: lengthSchema,
  height: lengthSchema,
});

const openingBaseShape = {
  id: idSchema,
  wallId: idSchema,
  /** Distance from the wall start vertex to the opening start, along the wall axis. */
  offset: z.number().nonnegative(),
  width: lengthSchema,
  height: lengthSchema,
};

export const doorSchema = z.object({
  ...openingBaseShape,
  kind: z.literal("door"),
  hinge: z.enum(["start", "end"]),
  /** Relative to the directed wall axis (start → end). */
  swingSide: z.enum(["left", "right"]),
});

export const windowSchema = z.object({
  ...openingBaseShape,
  kind: z.literal("window"),
  sillHeight: z.number().nonnegative(),
});

export const openingSchema = z.discriminatedUnion("kind", [doorSchema, windowSchema]);

/** What a room is for. Drives naming, design-mode tints and layout planning. */
export const ROOM_TYPES = [
  "unspecified",
  "living",
  "kitchen",
  "kitchen_dining",
  "dining",
  "bedroom",
  "primary_bedroom",
  "bathroom",
  "ensuite",
  "wc",
  "utility",
  "hall",
  "office",
  "storage",
  "garage",
  "other",
] as const;

export const FLOOR_MATERIALS = ["timber", "boards", "tile", "stone", "carpet", "concrete", "vinyl"] as const;

/** Whether a room should touch an external wall (daylight, garden access). */
export const EXTERNAL_WALL_PREFERENCES = ["required", "preferred", "avoid"] as const;

const areaSchema = z.number().positive().max(10_000);

/**
 * A room's identity, purpose and design program. Its polygon, area and
 * actual connections are derived from walls and doors, never stored.
 * Program fields are optional and absent when unset.
 */
/** What a hall is for: the way in, a passage, the top of the stairs, or a space many rooms open off. */
export const CIRCULATION_KINDS = ["entry", "corridor", "landing", "hub"] as const;

/** The interior styles (furniture, floors and photo renders); the project picks one and a room may choose its own. */
export const INTERIOR_STYLES = ["modern", "scandinavian", "warm_minimal", "industrial", "farmhouse", "coastal"] as const;

/** The curated paint colours a room's walls can take (their shades live in src/domain/interior/paint.ts). */
export const PAINT_COLOURS = ["chalk", "linen", "stone", "sage", "sky", "blush", "clay", "ochre", "navy", "charcoal"] as const;

export const roomSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  type: z.enum(ROOM_TYPES),
  /** Interior point associating this metadata with an enclosed region. */
  seed: point2Schema,
  /** Desired clear floor area, m². */
  targetArea: areaSchema.optional(),
  minArea: areaSchema.optional(),
  maxArea: areaSchema.optional(),
  floorMaterial: z.enum(FLOOR_MATERIALS).optional(),
  /** Paint on the room's inside walls; absent means the house's usual off-white. */
  wallColour: z.enum(PAINT_COLOURS).optional(),
  /** This room's own interior style; absent means the project's. */
  interiorStyle: z.enum(INTERIOR_STYLES).optional(),
  externalWall: z.enum(EXTERNAL_WALL_PREFERENCES).optional(),
  /** Pinned: edits and proposals that would change its shape, doors or windows are refused. */
  locked: z.boolean().optional(),
  /** Optional: for a hall, what it's for (generated plans say; absent elsewhere). */
  circulation: z.enum(CIRCULATION_KINDS).optional(),
});

/** Furniture and fittings in the catalog (src/domain/furniture/catalog.ts). */
export const FURNITURE_KINDS = [
  "sofa_3",
  "sofa_2",
  "armchair",
  "coffee_table",
  "tv_unit",
  "bookcase",
  "dining_set_4",
  "dining_set_6",
  "sideboard",
  "kitchen_run",
  "kitchen_island",
  "fridge",
  "bed_single",
  "bed_double",
  "bed_king",
  "bedside_table",
  "wardrobe",
  "chest_of_drawers",
  "desk",
  "bath",
  "shower",
  "toilet",
  "basin",
  "washing_machine",
  "worktop",
  "shelving",
  "car",
  "plant",
] as const;

/** Quarter turns counterclockwise, in degrees. At 0 the item's back faces north (+y). */
export const FURNITURE_ROTATIONS = [0, 90, 180, 270] as const;

/**
 * A piece of furniture or a fitting. It stands on the floor in plan space and
 * belongs to whichever room contains its position (derived, never stored), so
 * wall edits never have to update it. Width runs across its front, depth from
 * front to back, before rotation.
 */
export const furnitureSchema = z.object({
  id: idSchema,
  kind: z.enum(FURNITURE_KINDS),
  /** Centre of the footprint. */
  position: point2Schema,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  width: lengthSchema,
  depth: lengthSchema,
  height: lengthSchema,
});

/**
 * One floor of the house. Floors are listed from the ground up; each stands
 * on the one below, and its outline stays inside that floor's outline.
 */
export const levelSchema = z.object({
  id: idSchema,
  name: z.string().max(200),
  /**
   * Height of this floor's finished floor above the ground floor's, m. Kept
   * equal to the floor below's elevation plus its ceiling height plus this
   * floor's thickness (`restack` in plan/levels.ts); validation refuses
   * anything else.
   */
  elevation: z.number(),
  /** The ceiling height: new walls take it, and the floor above stands on it. */
  defaultWallHeight: lengthSchema,
  /** Depth of the floor structure this floor stands on, m. Upper floors only; absent on the ground floor. */
  floorThickness: lengthSchema.optional(),
  vertices: z.record(idSchema, point2Schema),
  walls: z.record(idSchema, wallSchema),
  openings: z.record(idSchema, openingSchema),
  rooms: z.record(idSchema, roomSchema),
  furniture: z.record(idSchema, furnitureSchema),
  /**
   * The house outline: external walls in counterclockwise order, each
   * horizontal or vertical. Whether it is a rectangle, an L or anything else
   * is derived, never stored.
   */
  envelope: z.object({
    kind: z.literal("polygon"),
    wallIds: z.array(idSchema).min(4).max(64),
  }),
  rearWallId: idSchema.nullable(),
});

/** Straight; L, turning a quarter on a landing; U, turning back on a half landing. */
export const STAIR_SHAPES = ["straight", "l", "u"] as const;

/**
 * A staircase from one floor up to another, through any floors between.
 * Every storey's flight has the same plan, stacked directly over the one
 * below, so a staircase is one footprint on every floor it serves; the
 * opening it needs in the floors above is derived (geometry/stairs.ts).
 */
export const staircaseSchema = z.object({
  id: idSchema,
  fromLevelId: idSchema,
  toLevelId: idSchema,
  shape: z.enum(STAIR_SHAPES),
  /** Which way an L or U turns on the way up. */
  turn: z.enum(["left", "right"]).optional(),
  /** Middle of the bottom step's front edge. */
  foot: point2Schema,
  /** Quarter turns counterclockwise; at 0 the first flight climbs north (+y). */
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  width: lengthSchema,
  /** Depth of each tread, front to back. */
  going: lengthSchema,
});

export const planDocumentSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: idSchema,
  name: z.string().max(200),
  units: z.literal("m"),
  levels: z.array(levelSchema).min(1),
  /** Absent when the house has no stairs. */
  staircases: z.record(idSchema, staircaseSchema).optional(),
});
