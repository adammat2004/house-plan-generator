import { z } from "zod";

/**
 * Runtime schema for the native PlanDocument format.
 *
 * All lengths and coordinates are metres; the plan uses a right-handed
 * coordinate system (X right, Y up). The schema checks structure only;
 * geometric validity is checked by the command layer.
 */

export const CURRENT_SCHEMA_VERSION = 2 as const;

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

export const FLOOR_MATERIALS = ["timber", "tile", "stone", "carpet", "concrete", "vinyl"] as const;

/** Whether a room should touch an external wall (daylight, garden access). */
export const EXTERNAL_WALL_PREFERENCES = ["required", "preferred", "avoid"] as const;

const areaSchema = z.number().positive().max(10_000);

/**
 * A room's identity, purpose and design program. Its polygon, area and
 * actual connections are derived from walls and doors, never stored.
 * Program fields are optional and absent when unset.
 */
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
  externalWall: z.enum(EXTERNAL_WALL_PREFERENCES).optional(),
});

export const levelSchema = z.object({
  id: idSchema,
  name: z.string().max(200),
  elevation: z.number(),
  defaultWallHeight: lengthSchema,
  vertices: z.record(idSchema, point2Schema),
  walls: z.record(idSchema, wallSchema),
  openings: z.record(idSchema, openingSchema),
  rooms: z.record(idSchema, roomSchema),
  envelope: z.object({
    kind: z.literal("rectangle"),
    /** Ordered counterclockwise: four exterior wall identities. */
    wallIds: z.tuple([idSchema, idSchema, idSchema, idSchema]),
  }),
  rearWallId: idSchema.nullable(),
});

export const planDocumentSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: idSchema,
  name: z.string().max(200),
  units: z.literal("m"),
  levels: z.array(levelSchema).min(1),
});
