import type { RoomPicks } from "../brief/rooms";
import { parsePlacementKey, type HouseBrief, type Placement } from "../brief/schema";
import { analyzeEnvelope, type EnvelopeSide } from "../geometry/envelope";
import type { Rect } from "../geometry/vector";
import type { Id, PlanDocument } from "../plan/types";
import { roomBounds } from "./analysis";
import { pickRoomName } from "./program";
import { frameOf } from "./zonePlanner";

/**
 * Rooms placed on the house before generating: soft hints that rank
 * layouts, never rules. A placement is a point in the ground floor's frame
 * (u across, v from the street to the garden, both 0–1); the room it names
 * honours it when the point falls in the room or the room's middle is in
 * the same third of the house both ways.
 */

export interface PlacementCheck {
  key: string;
  /** The room's name in this plan, or what it would have been called. */
  name: string;
  roomId: Id | null;
  levelId: Id | null;
  /** How far the point is from the room, as a share of the house's diagonal: 0 inside it, 1 if the room is missing. */
  distance: number;
  honoured: boolean;
  /** Where the room is, and where it was placed, in words ("back left"). */
  at: string | null;
  wanted: string;
}

type Placements = NonNullable<HouseBrief["placements"]>;

/** Merged rooms a hint can land on when its own room was combined to fit. */
const FALLBACK: Record<string, readonly string[]> = {
  Kitchen: ["Kitchen / Dining", "Kitchen / Living / Dining"],
  "Dining Room": ["Kitchen / Dining", "Kitchen / Living / Dining"],
  "Kitchen / Dining": ["Kitchen / Living / Dining"],
  "Living Room": ["Kitchen / Living / Dining"],
};

const third = (t: number) => (t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2);
const ACROSS = ["left", "", "right"] as const;
const DEPTH = ["front", "middle", "back"] as const;

/** A point of the house as a third both ways: "back left", "middle", "front". */
export function whereInHouse(u: number, v: number): string {
  const a = ACROSS[third(u)];
  const d = DEPTH[third(v)];
  return d === "middle" ? (a ? `middle ${a}` : "middle") : a ? `${d} ${a}` : d;
}

/** The names a placement's room may go by in a plan, its own first, then the merged rooms it can end up in. */
function namesFor(key: string, picks: RoomPicks): string[] {
  const k = parsePlacementKey(key);
  const name = k ? pickRoomName(k.pick, k.n, picks) : key;
  return [name, ...(FALLBACK[name] ?? [])];
}

/** The room a placement names: by the name the planner gives that pick's room, then a merged room. */
export function placementRoom(key: string, doc: PlanDocument, picks: RoomPicks): { name: string; roomId: Id; levelId: Id } | { name: string; roomId: null; levelId: null } {
  const names = namesFor(key, picks);
  for (const candidate of names)
    for (const level of doc.levels)
      for (const room of Object.values(level.rooms)) if (room.name === candidate) return { name: candidate, roomId: room.id, levelId: level.id };
  return { name: names[0], roomId: null, levelId: null };
}

/** A placement against a room's bounds, both in the house's normalised frame. */
function against(p: Placement, a: { u: number; v: number }, b: { u: number; v: number }): { distance: number; honoured: boolean; at: string } {
  const [u0, u1] = [Math.min(a.u, b.u), Math.max(a.u, b.u)];
  const [v0, v1] = [Math.min(a.v, b.v), Math.max(a.v, b.v)];
  const du = Math.max(u0 - p.u, 0, p.u - u1);
  const dv = Math.max(v0 - p.v, 0, p.v - v1);
  const mid = { u: (u0 + u1) / 2, v: (v0 + v1) / 2 };
  const honoured = (du === 0 && dv === 0) || (third(mid.u) === third(p.u) && third(mid.v) === third(p.v));
  return { distance: Math.hypot(du, dv) / Math.SQRT2, honoured, at: whereInHouse(mid.u, mid.v) };
}

/**
 * How a layout plan (named rooms as rectangles, before it is built) fares
 * against the placements: the mean distance, and whether it honours every
 * one. `outside` is the house's bounding box and `rear` its garden side.
 */
export function layoutPlacement(rooms: ReadonlyArray<{ name: string; rects: readonly Rect[] }>, outside: Rect, rear: EnvelopeSide, placements: Placements | undefined, picks: RoomPicks): { cost: number; honoured: boolean } {
  const entries = Object.entries(placements ?? {});
  if (!entries.length) return { cost: 0, honoured: true };
  const frame = frameOf(outside, rear);
  const norm = (p: { x: number; y: number }) => {
    const l = frame.local(p);
    return { u: l.u / frame.W, v: l.v / frame.V };
  };
  let cost = 0;
  let honoured = true;
  for (const [key, p] of entries) {
    const names = namesFor(key, picks);
    const room = names.map((n) => rooms.find((r) => r.name === n)).find((r) => r && r.rects.length);
    if (!room) {
      cost += 1;
      honoured = false;
      continue;
    }
    const b = { minX: Math.min(...room.rects.map((r) => r.minX)), minY: Math.min(...room.rects.map((r) => r.minY)), maxX: Math.max(...room.rects.map((r) => r.maxX)), maxY: Math.max(...room.rects.map((r) => r.maxY)) };
    const c = against(p, norm({ x: b.minX, y: b.minY }), norm({ x: b.maxX, y: b.maxY }));
    cost += c.distance;
    honoured &&= c.honoured;
  }
  return { cost: cost / entries.length, honoured };
}

/** The ground floor's frame, normalised: a world point as u, v in 0–1. */
function houseFrame(doc: PlanDocument): ((p: { x: number; y: number }) => { u: number; v: number }) | null {
  const ground = doc.levels[0];
  const env = analyzeEnvelope(ground);
  if (!env.ok) return null;
  const rear: EnvelopeSide = (ground.rearWallId && env.info.sideOfWall[ground.rearWallId]) || "north";
  const frame = frameOf(env.info.outsideRect, rear);
  return (p) => {
    const l = frame.local(p);
    return { u: l.u / frame.W, v: l.v / frame.V };
  };
}

/** How each placement fares in a plan. */
export function checkPlacements(doc: PlanDocument, placements: Placements | undefined, picks: RoomPicks): PlacementCheck[] {
  if (!placements) return [];
  const toFrame = houseFrame(doc);
  return Object.entries(placements).map(([key, p]: [string, Placement]) => {
    const found = placementRoom(key, doc, picks);
    const wanted = whereInHouse(p.u, p.v);
    const level = found.levelId ? doc.levels.find((l) => l.id === found.levelId) : undefined;
    const bounds = level && found.roomId ? roomBounds(level, found.roomId) : null;
    if (!toFrame || !bounds) return { key, name: found.name, roomId: found.roomId, levelId: found.levelId, distance: 1, honoured: false, at: null, wanted };
    const c = against(p, toFrame({ x: bounds.minX, y: bounds.minY }), toFrame({ x: bounds.maxX, y: bounds.maxY }));
    return { key, name: found.name, roomId: found.roomId, levelId: found.levelId, ...c, wanted };
  });
}

/** The mean distance of placed rooms from their points: exactly 0 with no placements. */
export function placementCost(doc: PlanDocument, placements: Placements | undefined, picks: RoomPicks): number {
  if (!placements || !Object.keys(placements).length) return 0;
  const checks = checkPlacements(doc, placements, picks);
  return checks.reduce((sum, c) => sum + c.distance, 0) / checks.length;
}

/** True when the plan honours every placement. */
export const honoursAll = (doc: PlanDocument, placements: Placements | undefined, picks: RoomPicks): boolean => checkPlacements(doc, placements, picks).every((c) => c.honoured);

/** The note a layout card shows for a placement it misses, e.g. "Master Bedroom is at the front, not the back where you placed it." */
export function missNote(c: PlacementCheck): string {
  return c.at ? `${c.name} is at the ${c.at}, not the ${c.wanted} where you placed it.` : `${c.name} isn't in this layout.`;
}

/**
 * For ranking (`pickIdeas`): a plan's distance from the brief's placements
 * if it honours every one, else null. Undefined when the brief places no
 * rooms, so ranking is exactly as without placements.
 */
export function placedBy(brief: HouseBrief | undefined): ((c: { document: PlanDocument }) => number | null) | undefined {
  const placements = brief?.placements;
  const picks = brief?.rooms;
  if (!placements || !picks || !Object.keys(placements).length) return undefined;
  return (c) => {
    const checks = checkPlacements(c.document, placements, picks);
    return checks.every((x) => x.honoured) ? checks.reduce((sum, x) => sum + x.distance, 0) / checks.length : null;
  };
}
