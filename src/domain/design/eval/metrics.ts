import { furnishRoom } from "../../furniture/furnish";
import { analyzeEnvelope } from "../../geometry/envelope";
import { OPPOSITE_SIDE, type EnvelopeSide } from "../../geometry/outline";
import type { Circulation, Id, Level, PlanDocument, RoomType } from "../../plan/types";
import { assessPlan, roomBounds, roomConnections, roomRegion, roomWalls, type RoomConnection, type RoomWall } from "../analysis";
import { circulationOf } from "../circulation";
import { ROOM_RULES } from "../roomRules";
import { assessSense } from "../sense";

/**
 * Measures of a plan's design quality and of how far apart two plans are,
 * for the generation benchmark (`tests/design/bench.test.ts`,
 * `npm run plans:bench`). It reads finished plans only, so it judges any plan,
 * generated or drawn. Nothing here ranks candidates yet: it measures, so a
 * planner change shows as a change in numbers rather than only in pictures.
 *
 *   level ──► circulation (hall, cupboards cut from it), entry and depth,
 *             privacy, glazing, furniture that wouldn't fit
 *         ──► descriptor (the design idea, in words that ignore mirroring)
 *   plans ──► door-graph distance, spatial distance, "same idea" or not
 */

const LIVING: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining"]);
const BEDROOMS: ReadonlySet<RoomType> = new Set(["bedroom", "primary_bedroom"]);

export interface LevelMetrics {
  /** Clear floor of every room, m². */
  area: number;
  /** Hall (and landing) floor over all room floor; on upper floors it includes the stair void. */
  hallShare: number;
  /** Hall plus stores that open only off it and weren't asked for (cupboards cut from hall strips), over all room floor. */
  circulationShare: number;
  /** Hall floor per door that opens off it, m²: how hard the hall works for its size. */
  hallPerDoor: number;
  /** What the front door opens into; "none" upstairs. */
  entry: RoomType | "none";
  /** Doors from the way in to each habitable room: the mean, and the deepest. */
  meanDepth: number;
  maxDepth: number;
  /** Mean bedroom depth less mean living-space depth: above 0 the bedrooms lie further in than the living spaces. */
  privacyGradient: number;
  /** Bedrooms sharing a wall with a living space. */
  bedroomsOnLiving: number;
  /** The least window area over floor area of any habitable room (0 for a room without a window). */
  minGlazing: number;
  /** Pieces the furnishing recipes wanted but couldn't place, over every room. */
  furnitureMissing: number;
}

/** What a plan's design idea is, in terms that ignore mirroring and sizes. */
export interface Descriptor {
  entry: RoomType | "none";
  /** K: a separate kitchen; KD: kitchen and dining together; KLD: one open-plan space. */
  openGroup: "K" | "KD" | "KLD" | "none";
  /** Where the master bedroom is: on the garden side, the street side, neither, or upstairs. */
  masterPos: "garden" | "street" | "inner" | "upper" | "none";
  kitchenPos: "garden" | "street" | "inner" | "none";
  /** The room with the main door to the garden. */
  gardenRoom: RoomType | "none";
  /** The hall's shape: a straight corridor, one that bends, or a compact hub; none when no room is a hall. */
  hall: "none" | "strip" | "bent" | "hub";
}

export const DESCRIPTOR_FIELDS = ["entry", "openGroup", "masterPos", "kitchenPos", "gardenRoom", "hall"] as const satisfies ReadonlyArray<keyof Descriptor>;

export interface PlanMetrics {
  levels: LevelMetrics[];
  /** Area-weighted over the floors. */
  hallShare: number;
  circulationShare: number;
  /** Hall floor of each kind (entrance hall, corridor, landing, hub) over all room floor. */
  hallByKind: Record<Circulation, number>;
  furnitureMissing: number;
  descriptor: Descriptor;
}

interface Facts {
  id: Id;
  type: RoomType;
  area: number;
  connections: RoomConnection[];
}

const doorsOf = (f: Facts) => f.connections.filter((c) => c.kind === "door");

function factsOf(level: Level): Facts[] {
  return Object.values(level.rooms).map((room) => ({ id: room.id, type: room.type, area: roomRegion(level, room.id)?.clearArea ?? 0, connections: roomConnections(level, room.id) }));
}

function streetSide(level: Level): EnvelopeSide | undefined {
  const env = analyzeEnvelope(level);
  const rear = env.ok && level.rearWallId ? env.info.sideOfWall[level.rearWallId] : undefined;
  return rear ? OPPOSITE_SIDE[rear] : undefined;
}

/** Which outside face a room has: the garden side, the street side, or neither. */
function position(level: Level, roomId: Id): "garden" | "street" | "inner" {
  const env = analyzeEnvelope(level);
  if (!env.ok || !level.rearWallId) return "inner";
  const rear = env.info.sideOfWall[level.rearWallId];
  const sides = new Set(roomWalls(level, roomId).filter((w) => w.external).map((w) => env.info.sideOfWall[w.wallId]));
  return sides.has(rear) ? "garden" : sides.has(OPPOSITE_SIDE[rear]) ? "street" : "inner";
}

export function levelMetrics(level: Level, upper = false): LevelMetrics {
  const rooms = factsOf(level);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const area = rooms.reduce((sum, r) => sum + r.area, 0);
  const halls = rooms.filter((r) => r.type === "hall");
  const hallIds = new Set(halls.map((h) => h.id));
  const hallArea = halls.reduce((sum, r) => sum + r.area, 0);
  const { hallShare, circulationShare } = assessSense(level).metrics;
  const hallDoors = halls.reduce((sum, h) => sum + doorsOf(h).filter((c) => c.target.kind === "room" && !hallIds.has(c.target.roomId)).length, 0);

  // Depth: doors from the room the front door opens into (upstairs, from the landing).
  const front = upper ? [] : rooms.filter((r) => doorsOf(r).some((c) => c.target.kind === "outside"));
  const starts = front.length ? front : halls;
  const depth = new Map<Id, number>(starts.map((r) => [r.id, 1]));
  const queue = [...depth.keys()];
  while (queue.length) {
    const id = queue.shift()!;
    for (const c of doorsOf(byId.get(id)!)) {
      if (c.target.kind !== "room" || depth.has(c.target.roomId)) continue;
      depth.set(c.target.roomId, depth.get(id)! + 1);
      queue.push(c.target.roomId);
    }
  }
  const habitable = rooms.filter((r) => ROOM_RULES[r.type].habitable);
  const depths = habitable.map((r) => depth.get(r.id) ?? Infinity).filter(Number.isFinite);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const bedDepth = mean(habitable.filter((r) => BEDROOMS.has(r.type)).map((r) => depth.get(r.id) ?? 0));
  const dayDepth = mean(habitable.filter((r) => LIVING.has(r.type)).map((r) => depth.get(r.id) ?? 0));

  // Sharing a wall: either face of the same wall, over a stretch of it.
  const livingWalls = rooms.filter((r) => LIVING.has(r.type)).flatMap((r) => roomWalls(level, r.id).filter((w) => !w.external));
  const touchesLiving = (w: RoomWall) => livingWalls.some((l) => l.wallId === w.wallId && l.side !== w.side && Math.min(l.to, w.to) - Math.max(l.from, w.from) >= 0.3);
  const bedroomsOnLiving = rooms.filter((r) => BEDROOMS.has(r.type) && roomWalls(level, r.id).some((w) => !w.external && touchesLiving(w))).length;

  const glazing = habitable.map((r) => {
    const windows = r.connections.filter((c) => c.kind === "window" && c.target.kind !== "room");
    const glass = windows.reduce((sum, c) => sum + c.width * (level.openings[c.openingId]?.height ?? 0), 0);
    return r.area > 0 ? glass / r.area : 0;
  });

  const furnitureMissing = rooms.reduce((sum, r) => sum + (furnishRoom(level, r.id, "metrics")?.missing.length ?? 0), 0);
  const entry = front[0]?.type ?? "none";
  return {
    area,
    hallShare,
    circulationShare,
    hallPerDoor: hallDoors ? hallArea / hallDoors : 0,
    entry,
    meanDepth: mean(depths),
    maxDepth: depths.length ? Math.max(...depths) : 0,
    privacyGradient: bedDepth && dayDepth ? bedDepth - dayDepth : 0,
    bedroomsOnLiving,
    minGlazing: glazing.length ? Math.min(...glazing) : 0,
    furnitureMissing,
  };
}

/** The design idea of a plan, read from its floors. */
export function describeIdea(doc: PlanDocument): Descriptor {
  const ground = doc.levels[0];
  const rooms = Object.values(ground.rooms);
  const types = new Set(rooms.map((r) => r.type));
  const openGroup = types.has("kitchen_dining") ? (types.has("living") ? "KD" : "KLD") : types.has("kitchen") ? "K" : "none";
  const facts = factsOf(ground);
  const entry = facts.find((r) => doorsOf(r).some((c) => c.target.kind === "outside"))?.type ?? "none";
  const garden = facts
    .map((r) => ({ r, width: doorsOf(r).filter((c) => c.target.kind === "garden").reduce((sum, c) => sum + c.width, 0) }))
    .filter((x) => x.width > 0)
    .sort((a, b) => b.width - a.width)[0];
  const masterOnGround = rooms.find((r) => r.type === "primary_bedroom");
  const masterUpper = !masterOnGround && doc.levels.slice(1).some((l) => Object.values(l.rooms).some((r) => r.type === "primary_bedroom"));
  const kitchen = rooms.find((r) => r.type === "kitchen" || r.type === "kitchen_dining");
  return {
    entry,
    openGroup,
    masterPos: masterOnGround ? position(ground, masterOnGround.id) : masterUpper ? "upper" : "none",
    kitchenPos: kitchen ? position(ground, kitchen.id) : "none",
    gardenRoom: garden?.r.type ?? "none",
    hall: hallShape(ground),
  };
}

/** The biggest hall's shape: under 85% of its bounds is a bend, 2.5 times as long as wide a strip, otherwise a hub. */
function hallShape(level: Level): Descriptor["hall"] {
  const hall = Object.values(level.rooms)
    .filter((r) => r.type === "hall")
    .map((r) => ({ b: roomBounds(level, r.id), area: roomRegion(level, r.id)?.clearArea ?? 0 }))
    .sort((a, b) => b.area - a.area)[0];
  if (!hall?.b) return "none";
  const w = hall.b.maxX - hall.b.minX;
  const d = hall.b.maxY - hall.b.minY;
  if (hall.area < w * d * 0.85) return "bent";
  return Math.max(w, d) >= Math.min(w, d) * 2.5 ? "strip" : "hub";
}

export function planMetrics(doc: PlanDocument): PlanMetrics {
  const levels = doc.levels.map((l, i) => levelMetrics(l, i > 0));
  const total = levels.reduce((sum, l) => sum + l.area, 0);
  const weighted = (key: "hallShare" | "circulationShare") => (total > 0 ? levels.reduce((sum, l) => sum + l[key] * l.area, 0) / total : 0);
  // Each hall by what it's for, whether or not the plan says.
  const hallByKind: Record<Circulation, number> = { entry: 0, corridor: 0, landing: 0, hub: 0 };
  for (const level of doc.levels) {
    for (const r of assessPlan(level).rooms) {
      const kind = circulationOf(doc, level, r.id);
      if (kind && total > 0) hallByKind[kind] += r.area / total;
    }
  }
  return {
    levels,
    hallShare: weighted("hallShare"),
    circulationShare: weighted("circulationShare"),
    hallByKind,
    furnitureMissing: levels.reduce((sum, l) => sum + l.furnitureMissing, 0),
    descriptor: ideaOf(doc).descriptor,
  };
}

// ── How far apart two plans are ──────────────────────────────────────────

/** The plan's doors as a multiset of room-type pairs, floor by floor: what leads to what, whichever way round it's drawn. */
export function doorGraph(doc: PlanDocument): Set<string> {
  const edges = new Set<string>();
  doc.levels.forEach((level, k) => {
    const counts = new Map<string, number>();
    const seen = new Set<Id>();
    for (const room of Object.values(level.rooms)) {
      for (const c of roomConnections(level, room.id)) {
        if (c.kind !== "door" || seen.has(c.openingId)) continue;
        seen.add(c.openingId);
        const other = c.target.kind === "room" ? (level.rooms[c.target.roomId]?.type ?? "unspecified") : c.target.kind;
        const pair = `${k}:${[room.type, other].sort().join("~")}`;
        const n = (counts.get(pair) ?? 0) + 1;
        counts.set(pair, n);
        edges.add(`${pair}#${n}`);
      }
    }
  });
  return edges;
}

/** 1 − Jaccard similarity of two door graphs: 0 when the same rooms lead to the same rooms. */
export function graphDistance(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]).size;
  if (!union) return 0;
  return 1 - [...a].filter((x) => b.has(x)).length / union;
}

export interface Spot {
  type: RoomType;
  area: number;
  /** Across the street front, 0–1. */
  u: number;
  /** From the street (0) to the garden (1). */
  v: number;
  level: number;
}

/** Where each room sits in the house's own frame, as fractions of its size. */
export function roomSpots(doc: PlanDocument): Spot[] {
  const spots: Spot[] = [];
  doc.levels.forEach((level, k) => {
    const street = streetSide(level) ?? "south";
    const bounds = Object.values(level.rooms).map((r) => ({ r, b: roomBounds(level, r.id) })).filter((x) => !!x.b);
    if (!bounds.length) return;
    const minX = Math.min(...bounds.map((x) => x.b!.minX));
    const maxX = Math.max(...bounds.map((x) => x.b!.maxX));
    const minY = Math.min(...bounds.map((x) => x.b!.minY));
    const maxY = Math.max(...bounds.map((x) => x.b!.maxY));
    const w = Math.max(maxX - minX, 1e-6);
    const d = Math.max(maxY - minY, 1e-6);
    for (const { r, b } of bounds) {
      const x = ((b!.minX + b!.maxX) / 2 - minX) / w;
      const y = ((b!.minY + b!.maxY) / 2 - minY) / d;
      // u along the street, v away from it.
      const [u, v] = street === "south" ? [x, y] : street === "north" ? [1 - x, 1 - y] : street === "west" ? [1 - y, x] : [y, 1 - x];
      spots.push({ type: r.type, area: roomRegion(level, r.id)?.clearArea ?? 0, u, v, level: k });
    }
  });
  return spots;
}

/**
 * How far the rooms moved between two plans: rooms are matched by floor and
 * type, largest first, and the distance is the mean shift of their centres
 * as fractions of the house (an unmatched room counts 1). The smaller of the
 * plan and its mirror image, so a mirrored plan is the same plan.
 */
export function spatialDistance(a: Spot[], b: Spot[]): number {
  const once = (bs: Spot[]) => {
    const groups = (spots: Spot[]) => {
      const map = new Map<string, Spot[]>();
      for (const s of spots) map.set(`${s.level}:${s.type}`, [...(map.get(`${s.level}:${s.type}`) ?? []), s]);
      for (const list of map.values()) list.sort((p, q) => q.area - p.area);
      return map;
    };
    const ga = groups(a);
    const gb = groups(bs);
    let sum = 0;
    let n = 0;
    for (const key of new Set([...ga.keys(), ...gb.keys()])) {
      const la = ga.get(key) ?? [];
      const lb = gb.get(key) ?? [];
      for (let i = 0; i < Math.max(la.length, lb.length); i++) {
        n++;
        sum += la[i] && lb[i] ? Math.min(1, Math.hypot(la[i].u - lb[i].u, la[i].v - lb[i].v)) : 1;
      }
    }
    return n ? sum / n : 0;
  };
  return Math.min(once(b), once(b.map((s) => ({ ...s, u: 1 - s.u }))));
}

/** What selection needs to tell plans apart: the design idea, the doors and where the rooms sit. */
export interface Idea {
  descriptor: Descriptor;
  graph: Set<string>;
  spots: Spot[];
  /** Room floor on each floor, m². */
  areas: number[];
}

const ideas = new WeakMap<PlanDocument, Idea>();

/** A plan's idea, worked out once per document. */
export function ideaOf(doc: PlanDocument): Idea {
  let idea = ideas.get(doc);
  if (!idea) {
    const spots = roomSpots(doc);
    const areas = doc.levels.map((_, k) => spots.filter((s) => s.level === k).reduce((sum, s) => sum + s.area, 0));
    ideas.set(doc, (idea = { descriptor: describeIdea(doc), graph: doorGraph(doc), spots, areas }));
  }
  return idea;
}

export interface Difference {
  graph: number;
  spatial: number;
  /** Descriptor fields that differ. */
  fields: Array<keyof Descriptor>;
  /** The same plan, perhaps mirrored or with rooms of a kind swapped: the same doors, rooms in the same places, and the same floor area on every floor. */
  identical: boolean;
  /** A different design idea, not the same one resized, mirrored or reshuffled. */
  distinct: boolean;
}

/**
 * "A different idea": two descriptor fields apart with the doors or the rooms
 * substantially rearranged too, or one field apart with both. A single- or
 * double-loaded version of the same zone layout differs in two fields but
 * keeps most of its doors and rooms, so it stays the same idea, as do mirrors,
 * swapped bedrooms and resized houses. Living and bedrooms swapped between
 * street and garden keeps the doors but moves every room: a different idea.
 */
export const DISTINCT = { fields: 2, graph: 0.25, spatial: 0.4, oneFieldGraph: 0.35, oneFieldSpatial: 0.25 } as const;

/** Floors of the same size, within 3%: a resized house, or one with less upstairs, is a variation rather than the same plan. */
const sameAreas = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= 0.03 * Math.max(x, b[i], 1));

export function compareIdeas(a: Idea, b: Idea): Difference {
  const graph = graphDistance(a.graph, b.graph);
  const spatial = spatialDistance(a.spots, b.spots);
  const fields = DESCRIPTOR_FIELDS.filter((f) => a.descriptor[f] !== b.descriptor[f]);
  return {
    graph,
    spatial,
    fields,
    identical: graph === 0 && spatial < 0.05 && sameAreas(a.areas, b.areas),
    distinct:
      (fields.length >= DISTINCT.fields && (graph >= DISTINCT.graph || spatial >= DISTINCT.spatial)) ||
      (fields.length >= 1 && graph >= DISTINCT.oneFieldGraph && spatial >= DISTINCT.oneFieldSpatial),
  };
}
