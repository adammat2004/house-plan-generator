import type { z } from "zod";
import type {
  doorSchema,
  furnitureSchema,
  levelSchema,
  openingSchema,
  planDocumentSchema,
  point2Schema,
  roomSchema,
  staircaseSchema,
  wallSchema,
  windowSchema,
  CIRCULATION_KINDS,
  EXTERNAL_WALL_PREFERENCES,
  FURNITURE_KINDS,
  FURNITURE_ROTATIONS,
  FLOOR_MATERIALS,
  INTERIOR_STYLES,
  ROOM_TYPES,
  STAIR_SHAPES,
  WALL_COLOURS,
} from "./schema";

export type Id = string;
export type Point2 = z.infer<typeof point2Schema>;
export type Wall = z.infer<typeof wallSchema>;
export type WallRole = Wall["role"];
export type Door = z.infer<typeof doorSchema>;
export type Window = z.infer<typeof windowSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type OpeningKind = Opening["kind"];
export type Room = z.infer<typeof roomSchema>;
export type RoomType = (typeof ROOM_TYPES)[number];
export type FloorMaterial = (typeof FLOOR_MATERIALS)[number];
export type WallColour = (typeof WALL_COLOURS)[number];
export type RoomInteriorStyle = (typeof INTERIOR_STYLES)[number];
export type ExternalWallPreference = (typeof EXTERNAL_WALL_PREFERENCES)[number];
export type Circulation = (typeof CIRCULATION_KINDS)[number];
export type Level = z.infer<typeof levelSchema>;
export type PlanDocument = z.infer<typeof planDocumentSchema>;
export type Furniture = z.infer<typeof furnitureSchema>;
export type FurnitureKind = (typeof FURNITURE_KINDS)[number];
export type FurnitureRotation = (typeof FURNITURE_ROTATIONS)[number];
export type Staircase = z.infer<typeof staircaseSchema>;
export type StairShape = (typeof STAIR_SHAPES)[number];
