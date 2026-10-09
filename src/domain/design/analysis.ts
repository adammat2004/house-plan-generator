import type { HouseBrief } from "../brief/schema";
import type { PlanCommand } from "../commands/types";
import { deriveLevelGeometry, deriveRoomRegions, roomFaceIndices, type RoomRegion } from "../geometry/derive";
import { analyzeEnvelope } from "../geometry/envelope";
import { findFaceIndexContaining } from "../geometry/faces";
import type { Rect } from "../geometry/vector";
import { pointAtParam } from "../geometry/walls";
import type { Id, Level, Point2, RoomType } from "../plan/types";

/**
 * Read-only facts about a plan for presenting and comparing designs: which
 * walls bound a room, what its doors lead to, and a whole-plan summary.
 * Nothing here changes a plan.
 */

export type Side = "north" | "south" | "east" | "west";

/** Outward unit vector of each side of a room. */
export const SIDE_NORMAL: Record<Side, Point2> = { north: { x: 0, y: 1 }, south: { x: 0, y: -1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 } };

const TOL = 0.02;
const MIN_OVERLAP = 0.05;

export function roomRegion(level: Level, roomId: Id): RoomRegion | null {
  return deriveRoomRegions(level)[roomFaceIndices(level).get(roomId) ?? -1] ?? null;
}

/** Clear (wall face to wall face) bounds of a room. */
export function roomBounds(level: Level, roomId: Id): Rect | null {
  const points = roomRegion(level, roomId)?.clear.flatMap((p) => p.outer) ?? [];
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

export function roomAtPoint(level: Level, p: Point2): Id | null {
  const face = findFaceIndexContaining(deriveLevelGeometry(level).faces, p);
  if (face < 0) return null;
  for (const [roomId, index] of roomFaceIndices(level)) if (index === face) return roomId;
  return null;
}

export interface RoomWall {
  wallId: Id;
  side: Side;
  external: boolean;
  /** The stretch of the side this wall covers, along x (north/south) or y (east/west). */
  from: number;
  to: number;
}

/**
 * Walls whose faces bound a room, with the side of the room each is on.
 * Follows the room's outline, so L-shaped rooms (a bedroom around its
 * ensuite) report their inner walls too.
 */
export function roomWalls(level: Level, roomId: Id): RoomWall[] {
  const region = roomRegion(level, roomId);
  if (!region) return [];
  const axes = [...deriveLevelGeometry(level).axes.values()];
  const found = new Map<string, RoomWall>();
  const add = (wall: RoomWall) => {
    const key = `${wall.wallId}:${wall.side}`;
    const seen = found.get(key);
    found.set(key, seen ? { ...seen, from: Math.min(seen.from, wall.from), to: Math.max(seen.to, wall.to) } : wall);
  };
  for (const ring of region.clear.flatMap((p) => [p.outer, ...p.holes])) {
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      const horizontal = Math.abs(p.y - q.y) < 1e-6;
      const vertical = Math.abs(p.x - q.x) < 1e-6;
      if (!horizontal && !vertical) return;
      const at = horizontal ? p.y : p.x;
      const lo = horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
      const hi = horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
      for (const axis of axes) {
        if (axis.orientation !== (horizontal ? "horizontal" : "vertical")) continue;
        const from = Math.max(axis.min, lo);
        const to = Math.min(axis.max, hi);
        if (to - from < MIN_OVERLAP) continue;
        const half = axis.wall.thickness / 2;
        const external = axis.wall.role === "external";
        if (Math.abs(axis.line - half - at) < TOL) add({ wallId: axis.wallId, side: horizontal ? "north" : "east", external, from, to });
        else if (Math.abs(axis.line + half - at) < TOL) add({ wallId: axis.wallId, side: horizontal ? "south" : "west", external, from, to });
      }
    });
  }
  return [...found.values()];
}

/**
 * The outline walls on the garden side: every external wall facing the same
 * way as the rear wall. A rectangle has one; an L or U can have several.
 */
export function gardenWallIds(level: Level): ReadonlySet<Id> {
  if (!level.rearWallId) return new Set();
  const env = analyzeEnvelope(level);
  const side = env.ok ? env.info.sideOfWall[level.rearWallId] : undefined;
  return new Set(env.ok && side ? env.info.wallsFacing[side] : [level.rearWallId]);
}

/** Whether the room has a face on the rear (garden) side. */
export function touchesRear(level: Level, roomId: Id): boolean {
  const garden = gardenWallIds(level);
  return garden.size > 0 && roomWalls(level, roomId).some((w) => garden.has(w.wallId));
}

/** The room on the far side of a room's wall at a point along it, if any. */
export function neighbourAcross(level: Level, wall: RoomWall, at: number): Id | null {
  const axis = deriveLevelGeometry(level).axes.get(wall.wallId);
  if (!axis) return null;
  const n = SIDE_NORMAL[wall.side];
  const reach = axis.wall.thickness / 2 + 0.05;
  const p = axis.orientation === "horizontal" ? { x: at, y: axis.line + n.y * reach } : { x: axis.line + n.x * reach, y: at };
  return roomAtPoint(level, p);
}

export type ConnectionTarget = { kind: "room"; roomId: Id; name: string } | { kind: "garden" } | { kind: "outside" };

export interface RoomConnection {
  openingId: Id;
  kind: "door" | "window";
  side: Side;
  width: number;
  target: ConnectionTarget;
}

/** Doors and windows in a room's walls, and what each leads to. */
export function roomConnections(level: Level, roomId: Id): RoomConnection[] {
  const geometry = deriveLevelGeometry(level);
  const connections: RoomConnection[] = [];
  const garden = gardenWallIds(level);
  for (const wall of roomWalls(level, roomId)) {
    const axis = geometry.axes.get(wall.wallId);
    if (!axis) continue;
    const along = (p: Point2) => (axis.orientation === "horizontal" ? p.x : p.y);
    for (const opening of Object.values(level.openings)) {
      if (opening.wallId !== wall.wallId) continue;
      const a = along(pointAtParam(axis, opening.offset));
      const b = along(pointAtParam(axis, opening.offset + opening.width));
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      if (Math.min(hi, wall.to) - Math.max(lo, wall.from) < MIN_OVERLAP) continue;
      let target: ConnectionTarget;
      if (wall.external) target = garden.has(wall.wallId) ? { kind: "garden" } : { kind: "outside" };
      else {
        const other = neighbourAcross(level, wall, (lo + hi) / 2);
        if (!other) continue;
        target = { kind: "room", roomId: other, name: level.rooms[other]?.name ?? "another room" };
      }
      connections.push({ openingId: opening.id, kind: opening.kind, side: wall.side, width: opening.width, target });
    }
  }
  return connections;
}

// ── Whole-plan assessment ────────────────────────────────────────────────

export const PLAN_FEATURES = [
  "open_plan",
  "kitchen_diner",
  "separate_living",
  "kitchen_faces_garden",
  "garden_access",
  "natural_light",
  "utility_room",
  "home_office",
  "ensuite",
  "dining_room",
  "garage",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABEL: Record<PlanFeature, string> = {
  open_plan: "Open-plan living",
  kitchen_diner: "Kitchen-diner",
  separate_living: "Separate living room",
  kitchen_faces_garden: "Kitchen facing garden",
  garden_access: "Garden access",
  natural_light: "Lots of natural light",
  utility_room: "Utility room",
  home_office: "Home office",
  ensuite: "Ensuite",
  dining_room: "Dining room",
  garage: "Garage",
};

const DAY: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining", "office"]);
const BED: ReadonlySet<RoomType> = new Set(["bedroom", "primary_bedroom"]);
const BATH: ReadonlySet<RoomType> = new Set(["bathroom", "ensuite", "wc"]);
const KITCHEN: ReadonlySet<RoomType> = new Set(["kitchen", "kitchen_dining"]);

/** Window area per m² of floor at or above which a plan counts as well lit. */
export const LIGHT_RATIO = 0.18;

export interface AssessedRoom {
  id: Id;
  name: string;
  type: RoomType;
  area: number;
}

export interface PlanAssessment {
  /** Clear floor area of all rooms, m². */
  totalArea: number;
  /** Living, kitchen, dining and office floor area, m². */
  dayArea: number;
  bedrooms: number;
  bathrooms: number;
  /** Largest first. */
  rooms: AssessedRoom[];
  /** Window area per m² of floor. */
  glazingRatio: number;
  /** Outside width × depth, m. */
  outside: { width: number; depth: number } | null;
  features: PlanFeature[];
}

const assessCache = new WeakMap<Level, PlanAssessment>();

export function assessPlan(level: Level): PlanAssessment {
  const cached = assessCache.get(level);
  if (cached) return cached;
  const regions = deriveRoomRegions(level);
  const faceOf = roomFaceIndices(level);
  const rooms: AssessedRoom[] = [];
  for (const room of Object.values(level.rooms)) {
    const region = regions[faceOf.get(room.id) ?? -1];
    if (region) rooms.push({ id: room.id, name: room.name, type: room.type, area: region.clearArea });
  }
  rooms.sort((a, b) => b.area - a.area);
  const sum = (filter: (r: AssessedRoom) => boolean) => rooms.filter(filter).reduce((acc, r) => acc + r.area, 0);
  const totalArea = sum(() => true);
  const has = (type: RoomType) => rooms.some((r) => r.type === type);
  const glazing = Object.values(level.openings).reduce((acc, o) => acc + (o.kind === "window" ? o.width * o.height : 0), 0);
  const glazingRatio = totalArea > 0 ? glazing / totalArea : 0;
  const garden = gardenWallIds(level);
  const rearDoor = Object.values(level.openings).some((o) => o.kind === "door" && garden.has(o.wallId));
  const env = analyzeEnvelope(level);

  const features: PlanFeature[] = [];
  if (has("kitchen_dining") && !has("living")) features.push("open_plan");
  if (has("kitchen_dining") && has("living")) features.push("kitchen_diner");
  if (has("living") && (has("kitchen") || has("kitchen_dining"))) features.push("separate_living");
  if (rooms.some((r) => KITCHEN.has(r.type) && touchesRear(level, r.id))) features.push("kitchen_faces_garden");
  if (rearDoor) features.push("garden_access");
  if (glazingRatio >= LIGHT_RATIO) features.push("natural_light");
  if (has("utility")) features.push("utility_room");
  if (has("office")) features.push("home_office");
  if (has("ensuite")) features.push("ensuite");
  if (has("dining")) features.push("dining_room");
  if (has("garage")) features.push("garage");

  const result: PlanAssessment = {
    totalArea,
    dayArea: sum((r) => DAY.has(r.type)),
    bedrooms: rooms.filter((r) => BED.has(r.type)).length,
    bathrooms: rooms.filter((r) => BATH.has(r.type)).length,
    rooms,
    glazingRatio,
    outside: env.ok ? { width: env.info.width, depth: env.info.depth } : null,
    features,
  };
  assessCache.set(level, result);
  return result;
}

/**
 * How well a plan answers the brief; higher is better. Used to recommend one
 * concept among several, so only the ordering matters.
 */
export function briefFit(a: PlanAssessment, brief: HouseBrief): number {
  let score = 0;
  score -= 2 * Math.abs(a.bedrooms - brief.bedrooms);
  score -= 1.5 * Math.abs(a.bathrooms - brief.bathrooms);
  const present: Record<string, boolean> = {
    kitchen: a.rooms.some((r) => KITCHEN.has(r.type)),
    living: a.rooms.some((r) => r.type === "living" || (r.type === "kitchen_dining" && /living/i.test(r.name))),
    dining: a.rooms.some((r) => r.type === "dining" || r.type === "kitchen_dining"),
    office: a.features.includes("home_office"),
    utility: a.features.includes("utility_room"),
    garage: a.features.includes("garage"),
  };
  for (const space of brief.requiredSpaces) if (!present[space]) score -= 1;
  const prefers = new Set(brief.preferences);
  if (prefers.has("open_plan")) score += a.features.includes("open_plan") ? 1 : -0.5;
  if (prefers.has("separate_living_room")) score += a.features.includes("separate_living") ? 1 : -0.5;
  if (prefers.has("kitchen_faces_garden")) score += a.features.includes("kitchen_faces_garden") ? 1.5 : -1;
  if (prefers.has("maximize_natural_light")) score += a.glazingRatio * 5;
  // Prefer plans that spend their area on rooms rather than hallway.
  const hall = a.rooms.filter((r) => r.type === "hall").reduce((acc, r) => acc + r.area, 0);
  if (a.totalArea > 0) score -= (hall / a.totalArea) * 4;
  score += (a.dayArea / Math.max(a.totalArea, 1)) * 2;
  return score;
}

/**
 * The command that sets a room's clear width (east–west) or depth
 * (north–south) by moving one of its internal walls; the room on the other
 * side gives or takes the difference. A message when no wall can move.
 */
export function roomResizeCommand(level: Level, roomId: Id, dimension: "width" | "depth", size: number): PlanCommand | string | null {
  const b = roomBounds(level, roomId);
  if (!b) return "That room isn't on this plan.";
  const current = dimension === "width" ? b.maxX - b.minX : b.maxY - b.minY;
  const span = dimension === "width" ? b.maxY - b.minY : b.maxX - b.minX;
  const delta = size - current;
  if (Math.abs(delta) < 0.0005) return null;
  const sides: Side[] = dimension === "width" ? ["east", "west"] : ["north", "south"];
  const walls = roomWalls(level, roomId).filter((w) => !w.external && sides.includes(w.side));
  // A wall along the whole side moves the side; a partial one would make a notch.
  const wall = walls.find((w) => w.to - w.from >= span - 0.05);
  if (!wall) {
    return walls.length
      ? `No single wall runs along the ${sides.join(" or ")} side of this room. Drag its walls in Structure instead.`
      : `The ${sides.join(" and ")} sides are outside walls. Change the house size in Structure.`;
  }
  const outward = wall.side === "east" || wall.side === "north" ? 1 : -1;
  return { type: "moveWall", wallId: wall.wallId, delta: Math.round(outward * delta * 1e6) / 1e6 };
}

// ── Room comparisons ─────────────────────────────────────────────────────

export interface RoomFacts {
  name: string;
  area: number;
  /** Clear width (east–west) and depth (north–south) of the room's bounds, m. */
  width: number;
  depth: number;
  doors: number;
  windows: number;
  /** Total window width, m. */
  glazing: number;
  /** Widest door straight to the garden, m (0 if none). */
  gardenDoor: number;
}

export function roomFacts(level: Level, roomId: Id): RoomFacts | null {
  const region = roomRegion(level, roomId);
  const b = roomBounds(level, roomId);
  if (!region || !b) return null;
  const connections = roomConnections(level, roomId);
  const windows = connections.filter((c) => c.kind === "window");
  return {
    name: level.rooms[roomId]?.name ?? "Room",
    area: region.clearArea,
    width: b.maxX - b.minX,
    depth: b.maxY - b.minY,
    doors: connections.filter((c) => c.kind === "door").length,
    windows: windows.length,
    glazing: windows.reduce((sum, w) => sum + w.width, 0),
    gardenDoor: Math.max(0, ...connections.filter((c) => c.kind === "door" && c.target.kind === "garden").map((c) => c.width)),
  };
}

export interface ConnectionLine {
  kind: "door" | "garden" | "outside" | "window";
  text: string;
}

/** A room's doors (and what they lead to) and windows (grouped by the way they face), as short lines. */
export function connectionSummary(level: Level, roomId: Id): ConnectionLine[] {
  const all = roomConnections(level, roomId);
  const lines: ConnectionLine[] = all
    .filter((c) => c.kind === "door")
    .map((d) =>
      d.target.kind === "garden"
        ? { kind: "garden", text: `${d.width >= 1.5 ? "Garden doors" : "Door to the garden"} (${d.width.toFixed(1)} m)` }
        : d.target.kind === "outside"
          ? { kind: "outside", text: "Door to outside" }
          : { kind: "door", text: `Door to ${d.target.name.toLowerCase()}` },
    );
  const facing = new Map<Side, number>();
  for (const w of all) if (w.kind === "window") facing.set(w.side, (facing.get(w.side) ?? 0) + 1);
  for (const [side, n] of facing) lines.push({ kind: "window", text: `${n === 1 ? "Window" : `${n} windows`} facing ${side}` });
  return lines;
}

export interface RoomChange {
  kind: "area" | "size" | "garden" | "windows" | "doors" | "merged" | "neighbour";
  text: string;
}

const m2 = (v: number) => `${v.toFixed(1)} m²`;
const signed = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;

/**
 * What a change did to a room, in plain lines: its area and size, doors,
 * windows and garden access, and the rooms around it that gave or took space.
 * `afterRoomId` differs when the room was merged into another.
 */
export function compareRoom(before: Level, after: Level, roomId: Id, afterRoomId: Id = roomId): RoomChange[] {
  const a = roomFacts(before, roomId);
  const b = roomFacts(after, afterRoomId);
  if (!a || !b) return [];
  const changes: RoomChange[] = [];
  if (Math.abs(b.area - a.area) >= 0.1) changes.push({ kind: "area", text: `${m2(b.area)} (${signed(b.area - a.area)} m²)` });
  if (Math.abs(b.width - a.width) >= 0.05 || Math.abs(b.depth - a.depth) >= 0.05) changes.push({ kind: "size", text: `${b.width.toFixed(1)} × ${b.depth.toFixed(1)} m, was ${a.width.toFixed(1)} × ${a.depth.toFixed(1)} m` });
  if (b.gardenDoor > a.gardenDoor) changes.push({ kind: "garden", text: `${b.gardenDoor.toFixed(1)} m garden doors` });
  if (Math.abs(b.glazing - a.glazing) >= 0.05) {
    changes.push({ kind: "windows", text: b.glazing < 0.05 ? `No windows, was ${a.glazing.toFixed(1)} m` : `${b.glazing.toFixed(1)} m of windows, was ${a.glazing.toFixed(1)} m` });
  }
  if (b.doors !== a.doors && b.gardenDoor === a.gardenDoor) changes.push({ kind: "doors", text: `${b.doors} door${b.doors === 1 ? "" : "s"}, was ${a.doors}` });
  const gone = Object.keys(before.rooms).filter((id) => !after.rooms[id] && id !== roomId);
  for (const id of gone) changes.push({ kind: "merged", text: `Opened up to ${before.rooms[id].name.toLowerCase()}` });
  if (afterRoomId !== roomId && !gone.length) changes.push({ kind: "merged", text: `Now part of ${b.name.toLowerCase()}` });
  for (const id of Object.keys(before.rooms)) {
    if (id === roomId || id === afterRoomId || !after.rooms[id]) continue;
    const was = roomRegion(before, id)?.clearArea ?? 0;
    const now = roomRegion(after, id)?.clearArea ?? 0;
    if (Math.abs(now - was) >= 0.3) changes.push({ kind: "neighbour", text: `${after.rooms[id].name} ${m2(now)} (${signed(now - was)} m²)` });
  }
  return changes;
}
