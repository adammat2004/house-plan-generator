import { deriveLevelGeometry, openingHostInterval } from "../geometry/derive";
import { analyzeEnvelope } from "../geometry/envelope";
import { OPPOSITE_SIDE } from "../geometry/outline";
import type { Id, Level, RoomType } from "../plan/types";
import { roomBounds, roomConnections, roomRegion, roomWalls, type RoomConnection } from "./analysis";
import { ROOM_RULES } from "./roomRules";

/**
 * Does a plan make sense to a person? validateDocument only checks that the
 * geometry holds together; this checks what someone walking round the house
 * would notice. Hard rules are things a sensible house never does (a room you
 * can't reach, a bedroom with no window); the score ranks plans that pass
 * them (less hallway, doors in corners, a garden door from the living space).
 *
 *   level ──► facts per room (area, bounds, doors, windows)
 *         ──► hard rules  → findings  (the planner drops a candidate once a rule is enforced)
 *         ──► soft scores → score     (higher is better; ranks candidates)
 *
 * It reads plans only, so it judges hand-edited plans the same way as
 * generated ones.
 */

export const SENSE_RULES = [
  "reachable",
  "front_door",
  "daylight",
  "kitchen_connected",
  "wet_room_privacy",
  "room_shape",
  "master_largest",
] as const;

export type SenseRule = (typeof SENSE_RULES)[number];

export interface SenseFinding {
  rule: SenseRule;
  roomIds: Id[];
  message: string;
}

export interface SenseMetrics {
  /** Hall floor area over all room floor area. */
  hallShare: number;
  /** Mean of |area − target| / target over rooms with a target. */
  areaMiss: number;
  /** Share of internal doors within 0.6 m of a corner of their stretch of wall. */
  cornerDoors: number;
  /** A door from a living space (living, kitchen, dining) to the garden. */
  gardenDoorFromLiving: boolean;
  /** Rooms whose floor isn't a rectangle. */
  irregularRooms: number;
  /** The utility opens off the kitchen (true when there's no utility). */
  utilityByKitchen: boolean;
  /** The primary bedroom shares no wall with a living space (true when there's none). */
  primaryPrivate: boolean;
}

export interface PlanSense {
  findings: SenseFinding[];
  metrics: SenseMetrics;
  /** 0–100, higher is better. Only the ordering between plans matters. */
  score: number;
}

const LIVING: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining"]);
const WET: ReadonlySet<RoomType> = new Set(["bathroom", "ensuite", "wc"]);
/** Rooms a front door may sensibly open into. */
const ENTRY: ReadonlySet<RoomType> = new Set(["hall", "living", "kitchen_dining", "kitchen", "dining"]);

/** How far from either end of its stretch of wall a door may be and still count as in the corner, m. */
const CORNER = 0.6;
/** A room whose floor fills less of its bounds than this isn't a rectangle. */
const RECTANGULAR = 0.97;

interface RoomFacts {
  id: Id;
  name: string;
  type: RoomType;
  area: number;
  width: number;
  depth: number;
  connections: RoomConnection[];
}

const cache = new WeakMap<Level, PlanSense>();

export function assessSense(level: Level): PlanSense {
  const cached = cache.get(level);
  if (cached) return cached;
  const rooms: RoomFacts[] = Object.values(level.rooms).map((room) => {
    const b = roomBounds(level, room.id);
    return {
      id: room.id,
      name: room.name,
      type: room.type,
      area: roomRegion(level, room.id)?.clearArea ?? 0,
      width: b ? b.maxX - b.minX : 0,
      depth: b ? b.maxY - b.minY : 0,
      connections: roomConnections(level, room.id),
    };
  });
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const findings: SenseFinding[] = [];
  const find = (rule: SenseRule, roomIds: Id[], message: string) => findings.push({ rule, roomIds, message });
  const doorsTo = (r: RoomFacts) => r.connections.filter((c) => c.kind === "door");

  // ── Front door: on the street side, into a hall or living space ──
  const env = analyzeEnvelope(level);
  const rear = env.ok && level.rearWallId ? env.info.sideOfWall[level.rearWallId] : undefined;
  const street = rear ? OPPOSITE_SIDE[rear] : undefined;
  const outsideDoors = rooms.flatMap((r) => doorsTo(r).filter((c) => c.target.kind === "outside").map((c) => ({ room: r, door: c })));
  const front = outsideDoors.filter(({ door }) => !street || door.side === street);
  if (!outsideDoors.length) find("front_door", [], "There's no front door.");
  else if (!front.length) find("front_door", outsideDoors.map((d) => d.room.id), `The front door isn't on the street side; it's on the ${outsideDoors[0].door.side} wall.`);
  for (const { room } of front) if (!ENTRY.has(room.type)) find("front_door", [room.id], `The front door opens into ${article(room.name)}.`);

  // ── Every room reachable from the way in ──
  const starts = (front.length ? front : outsideDoors).map((d) => d.room.id);
  const anyWayIn = starts.length > 0 || rooms.some((r) => doorsTo(r).some((c) => c.target.kind === "garden"));
  const reached = new Set<Id>(starts.length ? starts : rooms.filter((r) => doorsTo(r).some((c) => c.target.kind === "garden")).map((r) => r.id));
  const queue = [...reached];
  while (queue.length) {
    const room = byId.get(queue.pop()!);
    for (const c of room ? doorsTo(room) : []) {
      if (c.target.kind === "room" && !reached.has(c.target.roomId)) {
        reached.add(c.target.roomId);
        queue.push(c.target.roomId);
      }
    }
  }
  const unreachable = rooms.filter((r) => !reached.has(r.id));
  if (anyWayIn && unreachable.length) find("reachable", unreachable.map((r) => r.id), `${list(unreachable.map((r) => r.name))} can't be reached from the front door.`);

  // ── Daylight in rooms people live in ──
  for (const r of rooms) {
    if (ROOM_RULES[r.type].habitable && !r.connections.some((c) => c.kind === "window" && c.target.kind !== "room")) find("daylight", [r.id], `${r.name} has no window.`);
  }

  // ── The kitchen opens to where people eat or sit ──
  const eating = new Set(rooms.filter((r) => r.type === "dining" || r.type === "living" || r.type === "kitchen_dining").map((r) => r.id));
  for (const k of rooms.filter((r) => r.type === "kitchen")) {
    const opensToEating = doorsTo(k).some((c) => c.target.kind === "room" && eating.has(c.target.roomId));
    if (eating.size && !opensToEating) find("kitchen_connected", [k.id], `${k.name} doesn't connect to the dining or living room.`);
  }

  // ── Bathrooms don't open onto living spaces ──
  for (const w of rooms.filter((r) => WET.has(r.type))) {
    for (const c of doorsTo(w)) {
      const other = c.target.kind === "room" ? byId.get(c.target.roomId) : undefined;
      if (other && LIVING.has(other.type)) find("wet_room_privacy", [w.id, other.id], `${w.name} opens straight onto ${other.name.toLowerCase()}.`);
    }
  }

  // ── Room proportions: wide enough, not a corridor, big enough ──
  let irregular = 0;
  for (const r of rooms) {
    const rule = ROOM_RULES[r.type];
    const short = Math.min(r.width, r.depth);
    const long = Math.max(r.width, r.depth);
    if (r.area < r.width * r.depth * RECTANGULAR) irregular++;
    if (r.type === "hall" || !short) continue;
    const problems: string[] = [];
    if (short < rule.minWidth - 0.005) problems.push(`only ${short.toFixed(1)} m wide`);
    if (long / short > rule.maxProportion + 0.005) problems.push(`${short.toFixed(1)} × ${long.toFixed(1)} m, too long and narrow`);
    if (r.area < rule.minArea - 0.05) problems.push(`only ${r.area.toFixed(1)} m²`);
    if (problems.length) find("room_shape", [r.id], `${r.name} is ${problems.join(" and ")}.`);
  }

  // ── The master bedroom is the biggest bedroom ──
  for (const master of rooms.filter((r) => r.type === "primary_bedroom")) {
    const bigger = rooms.filter((r) => r.type === "bedroom" && r.area > master.area + 0.2);
    if (bigger.length) find("master_largest", [master.id, ...bigger.map((b) => b.id)], `${master.name} (${master.area.toFixed(1)} m²) is smaller than ${list(bigger.map((b) => b.name))}.`);
  }

  // ── Soft scores ──
  const total = rooms.reduce((sum, r) => sum + r.area, 0);
  const hallShare = total > 0 ? rooms.filter((r) => r.type === "hall").reduce((sum, r) => sum + r.area, 0) / total : 0;
  const targeted = rooms.filter((r) => (level.rooms[r.id]?.targetArea ?? 0) > 0);
  const areaMiss = targeted.length ? targeted.reduce((sum, r) => sum + Math.abs(r.area - level.rooms[r.id].targetArea!) / level.rooms[r.id].targetArea!, 0) / targeted.length : 0;
  const geometry = deriveLevelGeometry(level);
  const internalDoors = Object.values(level.openings).filter((o) => o.kind === "door" && geometry.axes.get(o.wallId)?.wall.role === "internal");
  const inCorner = internalDoors.filter((o) => {
    const host = openingHostInterval(geometry, o);
    return host && (o.offset - host[0] <= CORNER || host[1] - (o.offset + o.width) <= CORNER);
  });
  const cornerDoors = internalDoors.length ? inCorner.length / internalDoors.length : 1;
  const gardenDoorFromLiving = rooms.some((r) => LIVING.has(r.type) && doorsTo(r).some((c) => c.target.kind === "garden"));
  const utilities = rooms.filter((r) => r.type === "utility");
  const utilityByKitchen = utilities.every((u) => doorsTo(u).some((c) => c.target.kind === "room" && ["kitchen", "kitchen_dining"].includes(byId.get(c.target.roomId)?.type ?? "unspecified")));
  const primaryPrivate = rooms
    .filter((r) => r.type === "primary_bedroom")
    .every((m) => !roomWalls(level, m.id).some((w) => !w.external && rooms.some((o) => LIVING.has(o.type) && roomWalls(level, o.id).some((ow) => ow.wallId === w.wallId))));
  const metrics: SenseMetrics = { hallShare, areaMiss, cornerDoors, gardenDoorFromLiving, irregularRooms: irregular, utilityByKitchen, primaryPrivate };

  let score = 100;
  score -= Math.max(0, hallShare - 0.08) * 150;
  score -= areaMiss * 30;
  score -= (1 - cornerDoors) * 10;
  score -= gardenDoorFromLiving ? 0 : 8;
  score -= irregular * 4;
  score -= utilityByKitchen ? 0 : 4;
  score -= primaryPrivate ? 0 : 4;
  score -= findings.length * 5;
  const result: PlanSense = { findings, metrics, score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)) };
  cache.set(level, result);
  return result;
}

/** Findings for the rules given, e.g. the ones the planner enforces. */
export const findingsFor = (sense: PlanSense, rules: readonly SenseRule[]) => sense.findings.filter((f) => rules.includes(f.rule));

function article(name: string): string {
  const lower = name.toLowerCase();
  return /^[aeiou]/.test(lower) ? `an ${lower}` : `a ${lower}`;
}

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
