import type { z } from "zod";
import type {
  doorSchema,
  levelSchema,
  openingSchema,
  planDocumentSchema,
  point2Schema,
  roomSchema,
  wallSchema,
  windowSchema,
  EXTERNAL_WALL_PREFERENCES,
  FLOOR_MATERIALS,
  ROOM_TYPES,
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
export type ExternalWallPreference = (typeof EXTERNAL_WALL_PREFERENCES)[number];
export type Level = z.infer<typeof levelSchema>;
export type PlanDocument = z.infer<typeof planDocumentSchema>;
