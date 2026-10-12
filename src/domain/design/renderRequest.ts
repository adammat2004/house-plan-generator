import { z } from "zod";
import { FURNITURE_CATALOG } from "../furniture/catalog";
import { furnitureInRoom } from "../furniture/layout";
import { deriveLevelGeometry } from "../geometry/derive";
import { analyzeEnvelope } from "../geometry/envelope";
import { FAMILY_WORD } from "../geometry/outline";
import { describeOutline } from "../geometry/outlineDescription";
import { ROOM_TYPE_LABEL } from "../plan/rooms";
import { FLOOR_MATERIALS, FURNITURE_KINDS, ROOM_TYPES } from "../plan/schema";
import { storeysWord } from "../plan/levels";
import type { Id, Level, PlanDocument } from "../plan/types";
import { EXTERIOR_FINISHES, FRAME_FINISHES, INTERIOR_STYLES, ROOF_FINISHES, type Appearance, type InteriorStyle } from "../project/schema";
import { roomConnections, roomRegion } from "./analysis";

/**
 * A request to turn a 3D render of a room (or the house) into a realistic
 * photo. Only structured facts about the view travel with the image, so the
 * server writes the prompt itself and the image route can't be used as a
 * general-purpose image generator.
 */

/** Base64 of a JPEG of at most about 1.2 MB. */
export const MAX_IMAGE_BYTES = 1_200_000;
const MAX_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

export const DEFAULT_INTERIOR_STYLE: InteriorStyle = "warm_minimal";

const roomViewSchema = z.object({
  kind: z.literal("room"),
  roomType: z.enum(ROOM_TYPES),
  area: z.number().min(0).max(1000),
  furniture: z.array(z.enum(FURNITURE_KINDS)).max(60),
  windows: z.number().int().min(0).max(30),
  gardenDoors: z.boolean(),
  floor: z.enum(FLOOR_MATERIALS).nullable(),
});

const storeysSchema = z.number().int().min(1).max(3);

const aerialViewSchema = z.object({
  kind: z.literal("aerial"),
  rooms: z.array(z.enum(ROOM_TYPES)).max(40),
  area: z.number().min(0).max(5000),
  /** Absent for a single storey. */
  storeys: storeysSchema.optional(),
});

const exteriorViewSchema = z.object({
  kind: z.literal("exterior"),
  exterior: z.enum(EXTERIOR_FINISHES),
  frames: z.enum(FRAME_FINISHES),
  roof: z.enum(ROOF_FINISHES),
  storeys: storeysSchema,
  /** The outline's family when the house isn't a rectangle. */
  shape: z.enum(["L", "T", "U", "Z", "custom"]).optional(),
});

export const renderRequestSchema = z.object({
  view: z.discriminatedUnion("kind", [roomViewSchema, exteriorViewSchema, aerialViewSchema]),
  style: z.enum(INTERIOR_STYLES),
  /** The 3D render, base64 JPEG without a data: prefix. */
  image: z.string().min(100).max(MAX_BASE64).regex(/^[A-Za-z0-9+/]+=*$/),
});

export type RenderRequest = z.infer<typeof renderRequestSchema>;
export type RenderView = RenderRequest["view"];
export type StillTarget = { kind: "exterior" } | { kind: "aerial" } | { kind: "room"; roomId: Id };

/** A plan's floors, or the one floor given. Photos of a house of one floor work exactly as they did for a Level. */
const floorsOf = (source: Level | PlanDocument): Level[] => ("levels" in source ? source.levels : [source]);
const floorOfRoom = (source: Level | PlanDocument, roomId: Id): Level | undefined => floorsOf(source).find((l) => roomId in l.rooms);

const SKIP: ReadonlySet<string> = new Set(["hall", "storage", "garage", "unspecified", "other"]);
const ORDER: Record<string, number> = { living: 0, kitchen_dining: 1, kitchen: 2, dining: 3, primary_bedroom: 4, office: 5, bedroom: 6, bathroom: 7, ensuite: 8, utility: 9, wc: 10 };

/**
 * The views worth a photo, in the order they're rendered: the house from the
 * garden, then living spaces, bedrooms and bathrooms. Halls, storage and
 * tiny rooms are left out.
 */
export function photoTargets(source: Level | PlanDocument, limit = 10): StillTarget[] {
  const rooms = floorsOf(source)
    .flatMap((level) => Object.values(level.rooms).map((room) => ({ room, area: roomRegion(level, room.id)?.clearArea ?? 0 })))
    .filter(({ room, area }) => !SKIP.has(room.type) && area >= 3)
    .sort((a, b) => (ORDER[a.room.type] ?? 20) - (ORDER[b.room.type] ?? 20) || b.area - a.area || a.room.name.localeCompare(b.room.name, undefined, { numeric: true }));
  return [{ kind: "exterior" as const }, ...rooms.map(({ room }) => ({ kind: "room" as const, roomId: room.id }))].slice(0, limit);
}

export const targetKey = (target: StillTarget) => (target.kind === "room" ? target.roomId : target.kind);

/** The facts about a view that the prompt is written from. Null if the room has gone. */
export function renderViewFor(source: Level | PlanDocument, target: StillTarget, appearance: Appearance): RenderView | null {
  const floors = floorsOf(source);
  if (target.kind === "exterior") {
    const env = analyzeEnvelope(floors[0]);
    // A rectangle with a bay is still a rectangle in a photo.
    const shape = env.ok ? (describeOutline(env.info).shape ?? undefined) : undefined;
    return { kind: "exterior", exterior: appearance.exterior, frames: appearance.frames, roof: appearance.roof, storeys: floors.length, ...(shape ? { shape } : {}) };
  }
  if (target.kind === "aerial") {
    const rooms = floors.flatMap((level) => Object.values(level.rooms).map((r) => r.type));
    const area = floors.reduce((total, level) => total + Object.keys(level.rooms).reduce((sum, id) => sum + (roomRegion(level, id)?.clearArea ?? 0), 0), 0);
    return { kind: "aerial", rooms: rooms.slice(0, 40), area: Math.round(area), ...(floors.length > 1 ? { storeys: floors.length } : {}) };
  }
  const level = floorOfRoom(source, target.roomId);
  const room = level?.rooms[target.roomId];
  const region = level && roomRegion(level, target.roomId);
  if (!level || !room || !region) return null;
  const connections = roomConnections(level, target.roomId);
  return {
    kind: "room",
    roomType: room.type,
    area: Math.round(region.clearArea * 10) / 10,
    furniture: furnitureInRoom(level, target.roomId).map((f) => f.kind),
    windows: connections.filter((c) => c.kind === "window").length,
    gardenDoors: connections.some((c) => c.kind === "door" && c.target.kind === "garden"),
    floor: room.floorMaterial ?? null,
  };
}

export const STYLE_WORDS: Record<InteriorStyle, string> = {
  modern: "clean modern interior, crisp white walls, matte black accents, contemporary furniture",
  scandinavian: "Scandinavian interior, pale oak, white walls, soft wool textiles, simple lines",
  warm_minimal: "warm minimalist interior, limewash walls, natural oak, linen, soft daylight",
  industrial: "industrial loft interior, exposed concrete, black steel, leather and dark timber",
  farmhouse: "modern farmhouse interior, painted panelling, rustic oak, warm brass, cosy textiles",
  coastal: "relaxed coastal interior, whitewashed timber, sand and sea-glass tones, rattan",
};

const FLOOR_WORDS: Record<NonNullable<Extract<RenderView, { kind: "room" }>["floor"]>, string> = {
  timber: "herringbone oak floor",
  boards: "wide oak floorboards",
  tile: "large porcelain floor tiles",
  stone: "natural stone floor",
  carpet: "soft carpet",
  concrete: "polished concrete floor",
  vinyl: "vinyl plank floor",
};

const EXTERIOR_WORDS: Record<Extract<RenderView, { kind: "exterior" }>["exterior"], string> = {
  white_render: "smooth white render walls",
  brick: "red-brown brick walls",
  timber: "vertical timber cladding",
  dark_render: "charcoal render walls",
};

/** The prompt sent with the render. Written on the server from structured fields only. */
export function renderPrompt(view: RenderView, style: InteriorStyle): string {
  const keep =
    "Keep the camera position, perspective and framing exactly as in the image. Keep every wall, window, door and opening where it is, and keep every piece of furniture in the same place, size and orientation. Only replace the flat placeholder materials with realistic finishes, lighting, textures and a few tasteful decorations. No people, no text, no watermarks, no extra rooms, windows or doors.";
  if (view.kind === "aerial") {
    const counts = new Map<string, number>();
    for (const type of view.rooms) if (type !== "hall" && type !== "unspecified") counts.set(ROOM_TYPE_LABEL[type].toLowerCase(), (counts.get(ROOM_TYPE_LABEL[type].toLowerCase()) ?? 0) + 1);
    const list = [...counts].map(([name, c]) => (c > 1 ? `${c} ${name}s` : `a ${name}`)).join(", ");
    return `Turn this 3D render into a photorealistic aerial photograph of a furnished ${storeysWord(view.storeys ?? 1)} home of about ${view.area} square metres, seen from above at an angle with the roof removed, like an architectural dollhouse cutaway. It has ${list}. Interiors in a ${STYLE_WORDS[style]} style, dark wall tops, a garden, paving and planting around the house, soft daylight. Keep the camera position, perspective and framing exactly as in the image. Keep every wall, room, door, window and piece of furniture where it is; only replace the flat placeholder materials with realistic finishes, textures and lighting. No people, no text, no labels, no watermarks.`;
  }
  if (view.kind === "exterior") {
    const shape = view.shape ? `${view.shape === "L" ? "an" : "a"} ${FAMILY_WORD[view.shape]} ` : "a ";
    return `Turn this 3D massing render into a photorealistic architectural photograph of ${shape}${storeysWord(view.storeys)} house seen from its garden: ${EXTERIOR_WORDS[view.exterior]}, ${view.frames} window frames, a ${view.roof === "zinc" ? "zinc" : "dark flat"} roof, a neat lawn, planting and soft daylight. ${keep}`;
  }
  const items = [...new Set(view.furniture.map((k) => FURNITURE_CATALOG[k].label.toLowerCase()))];
  const room = ROOM_TYPE_LABEL[view.roomType].toLowerCase();
  const parts = [
    `Turn this 3D render into a photorealistic interior photograph of a ${room} of about ${Math.round(view.area)} square metres in a ${STYLE_WORDS[style]} style`,
    items.length ? `with ${items.join(", ")}` : "",
    view.floor ? `on a ${FLOOR_WORDS[view.floor]}` : "",
    view.windows || view.gardenDoors ? `with natural light from ${view.windows ? `${view.windows} window${view.windows === 1 ? "" : "s"}` : ""}${view.windows && view.gardenDoors ? " and " : ""}${view.gardenDoors ? "garden doors" : ""}` : "",
  ].filter(Boolean);
  return `${parts.join(" ")}. ${keep}`;
}

/** FNV-1a, enough to tell whether what a view shows has changed. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A key for what an image of the view shows: the room's outline, its
 * openings, the furniture in it, its finish, and the style. Editing one room
 * doesn't change another room's key; the house from outside and above
 * changes with every floor.
 */
export function renderKey(source: Level | PlanDocument, target: StillTarget, appearance: Appearance, style: InteriorStyle): string {
  const floors = floorsOf(source);
  if (target.kind === "room") {
    const level = floorOfRoom(source, target.roomId);
    return level ? floorKey(level, target, appearance, style) : "gone";
  }
  if (floors.length === 1) return floorKey(floors[0], target, appearance, style);
  return hash(JSON.stringify([target.kind, floors.length, ...floors.map((l) => floorKey(l, target, appearance, style))]));
}

function floorKey(level: Level, target: StillTarget, appearance: Appearance, style: InteriorStyle): string {
  if (target.kind === "aerial") {
    const walls = Object.values(level.walls).map((w) => [w.id, level.vertices[w.startVertexId], level.vertices[w.endVertexId]]);
    const openings = Object.values(level.openings).map((o) => [o.wallId, o.kind, r2(o.offset), r2(o.width)]);
    const furniture = Object.values(level.furniture).map((f) => [f.kind, r2(f.position.x), r2(f.position.y), f.rotation]);
    return hash(JSON.stringify(["aerial", walls, openings, furniture, Object.values(level.rooms).map((r) => [r.type, r.floorMaterial ?? null]), style]));
  }
  if (target.kind === "exterior") {
    const env = analyzeEnvelope(level);
    // Rectangles keep their old key, so photos taken before outlines existed stay current.
    const outline = !env.ok ? [] : env.info.isRectangle ? [env.info.width, env.info.depth].map(r2) : env.info.outsideRing.map((p) => [r2(p.x), r2(p.y)]);
    const openings = Object.values(level.openings)
      .filter((o) => level.envelope.wallIds.includes(o.wallId))
      .map((o) => [o.wallId, o.kind, r2(o.offset), r2(o.width), r2(o.height)])
      .sort();
    return hash(JSON.stringify(["exterior", outline, openings, level.rearWallId, appearance.exterior, appearance.frames, appearance.roof]));
  }
  const room = level.rooms[target.roomId];
  const region = roomRegion(level, target.roomId);
  if (!room || !region) return "gone";
  const outline = region.clear.map((p) => p.outer.map((pt) => [r2(pt.x), r2(pt.y)]));
  const geometry = deriveLevelGeometry(level);
  const openings = roomConnections(level, target.roomId)
    .map((c) => {
      const o = level.openings[c.openingId];
      const axis = geometry.axes.get(o.wallId);
      return [o.kind, r2(o.width), r2(o.height), axis ? r2(axis.line) : 0, r2(o.offset)];
    })
    .sort();
  const furniture = furnitureInRoom(level, target.roomId)
    .map((f) => [f.kind, r2(f.position.x), r2(f.position.y), f.rotation, r2(f.width), r2(f.depth)])
    .sort();
  return hash(JSON.stringify(["room", room.type, room.floorMaterial ?? null, outline, openings, furniture, style]));
}
