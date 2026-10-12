import { deriveLevelGeometry } from "../geometry/derive";
import { overlapArea } from "../geometry/polygons";
import { levelStairs } from "../geometry/stairs";
import type { Rect } from "../geometry/vector";
import { storeyName } from "../plan/levels";
import type { Id, Level, PlanDocument, RoomType } from "../plan/types";
import { assessPlan, roomAtPoint, roomConnections, roomRegion } from "./analysis";
import { assessSense, senseScore, type SenseMetrics, type SenseRule } from "./sense";

/**
 * Plan sense for a whole house. Each floor is judged as `assessSense` judges
 * a bungalow, except that only the ground floor has a front door: an upper
 * floor is reached by its stairs, so every room on it must be reachable from
 * where they arrive. Stairs should leave from and arrive in a hall or living
 * space, and bathrooms upstairs are better over the plumbing below.
 *
 * A house of one floor gets exactly `assessSense` for it.
 */

/** Rules only houses of several floors have; kept apart so the single-storey scoreboard is unchanged. */
export const STOREY_SENSE_RULES = ["stairs"] as const;

export type HouseSenseRule = SenseRule | (typeof STOREY_SENSE_RULES)[number];

export interface HouseSenseFinding {
  rule: HouseSenseRule;
  roomIds: Id[];
  message: string;
}

export interface HouseSenseMetrics extends SenseMetrics {
  /** Share of upstairs bathroom floor standing over a bathroom, kitchen or utility (1 with none upstairs). */
  wetStacked?: number;
  /** A WC or bathroom on the ground floor. */
  groundWc?: boolean;
}

export interface HouseSense {
  findings: HouseSenseFinding[];
  metrics: HouseSenseMetrics;
  /** 0–100, higher is better. */
  score: number;
}

const WET: ReadonlySet<RoomType> = new Set(["bathroom", "ensuite", "wc"]);
/** What a bathroom upstairs is best stacked over: other wet rooms, the kitchen, the utility. */
const PLUMBED: ReadonlySet<RoomType> = new Set(["bathroom", "ensuite", "wc", "kitchen", "kitchen_dining", "utility"]);
/** Rooms stairs may sensibly leave from or arrive in. */
const STAIR_ROOMS: ReadonlySet<RoomType> = new Set(["hall", "living", "kitchen_dining", "kitchen", "dining"]);

const centre = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 });

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const cache = new WeakMap<PlanDocument, HouseSense>();

export function assessHouseSense(doc: PlanDocument): HouseSense {
  if (doc.levels.length === 1) return assessSense(doc.levels[0]);
  const cached = cache.get(doc);
  if (cached) return cached;

  const perFloor = doc.levels.map(assessSense);
  const findings: HouseSenseFinding[] = [];
  doc.levels.forEach((_, i) => {
    for (const f of perFloor[i].findings) if (i === 0 || (f.rule !== "front_door" && f.rule !== "reachable")) findings.push(f);
  });

  // ── Stairs: one reaches every upper floor, from and to a hall or living space ──
  doc.levels.forEach((level, i) => {
    const floor = storeyName(i).toLowerCase();
    const stairs = levelStairs(doc, level.id);
    for (const { plan, role } of stairs) {
      const ends = [...(role === "end" ? [] : [{ zone: plan.departure, word: "start" }]), ...(role === "start" ? [] : [{ zone: plan.arrival, word: "arrive" }])];
      for (const { zone, word } of ends) {
        const roomId = roomAtPoint(level, centre(zone));
        const room = roomId ? level.rooms[roomId] : undefined;
        if (!room) findings.push({ rule: "stairs", roomIds: [], message: `The stairs ${word} outside any room on the ${floor}.` });
        else if (!STAIR_ROOMS.has(room.type)) findings.push({ rule: "stairs", roomIds: [room.id], message: `The stairs ${word} in ${room.name}; they should ${word} in a hall or landing.` });
      }
    }
    if (i === 0) return;
    const arrivals = stairs.filter((s) => s.role !== "start");
    if (!arrivals.length) {
      findings.push({ rule: "stairs", roomIds: [], message: `No stairs lead up to the ${floor}.` });
      return;
    }
    // Every room upstairs is reachable from where the stairs arrive.
    const reached = new Set(arrivals.map((s) => roomAtPoint(level, centre(s.plan.arrival))).filter((id): id is Id => !!id));
    const queue = [...reached];
    while (queue.length) {
      for (const c of roomConnections(level, queue.pop()!)) {
        if (c.kind === "door" && c.target.kind === "room" && !reached.has(c.target.roomId)) {
          reached.add(c.target.roomId);
          queue.push(c.target.roomId);
        }
      }
    }
    const unreachable = Object.values(level.rooms).filter((r) => !reached.has(r.id));
    if (unreachable.length) findings.push({ rule: "reachable", roomIds: unreachable.map((r) => r.id), message: `${list(unreachable.map((r) => r.name))} can't be reached from the stairs.` });
  });

  // ── Metrics: each floor's, weighted by what it holds ──
  const areas = doc.levels.map((l) => assessPlan(l).totalArea);
  const total = areas.reduce((a, b) => a + b, 0);
  const weighted = (value: (m: SenseMetrics) => number, weight: (i: number) => number, empty: number) => {
    const w = doc.levels.map((_, i) => weight(i));
    const sum = w.reduce((a, b) => a + b, 0);
    return sum > 0 ? perFloor.reduce((acc, p, i) => acc + value(p.metrics) * w[i], 0) / sum : empty;
  };
  const targeted = (i: number) => Object.values(doc.levels[i].rooms).filter((r) => (r.targetArea ?? 0) > 0).length;
  const internalDoors = (i: number) => {
    const geometry = deriveLevelGeometry(doc.levels[i]);
    return Object.values(doc.levels[i].openings).filter((o) => o.kind === "door" && geometry.axes.get(o.wallId)?.wall.role === "internal").length;
  };
  const metrics: HouseSenseMetrics = {
    hallShare: total > 0 ? weighted((m) => m.hallShare, (i) => areas[i], 0) : 0,
    areaMiss: weighted((m) => m.areaMiss, targeted, 0),
    cornerDoors: weighted((m) => m.cornerDoors, internalDoors, 1),
    gardenDoorFromLiving: perFloor[0].metrics.gardenDoorFromLiving,
    irregularRooms: perFloor.reduce((acc, p) => acc + p.metrics.irregularRooms, 0),
    utilityByKitchen: perFloor.every((p) => p.metrics.utilityByKitchen),
    primaryPrivate: perFloor.every((p) => p.metrics.primaryPrivate),
    wetStacked: wetStacked(doc.levels),
    groundWc: Object.values(doc.levels[0].rooms).some((r) => WET.has(r.type)),
  };
  const extra = (1 - metrics.wetStacked!) * 6 + (metrics.groundWc ? 0 : 4);
  const result: HouseSense = { findings, metrics, score: senseScore(metrics, findings.length, extra) };
  cache.set(doc, result);
  return result;
}

/** Share of upstairs wet-room floor standing over plumbing on the floor below. */
function wetStacked(levels: readonly Level[]): number {
  let upstairs = 0;
  let stacked = 0;
  for (let i = 1; i < levels.length; i++) {
    const below = Object.values(levels[i - 1].rooms)
      .filter((r) => PLUMBED.has(r.type))
      .flatMap((r) => roomRegion(levels[i - 1], r.id)?.clear ?? []);
    for (const room of Object.values(levels[i].rooms)) {
      if (!WET.has(room.type)) continue;
      const region = roomRegion(levels[i], room.id);
      if (!region) continue;
      upstairs += region.clearArea;
      for (const poly of region.clear) for (const b of below) stacked += overlapArea(poly, b);
    }
  }
  return upstairs > 0 ? Math.min(1, stacked / upstairs) : 1;
}
