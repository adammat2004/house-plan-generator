import { deriveLevelGeometry, openingPlacement } from "@/domain/geometry/derive";
import { analyzeEnvelope, type EnvelopeEdge, type EnvelopeSide } from "@/domain/geometry/envelope";
import { OPPOSITE_SIDE } from "@/domain/geometry/outline";
import { difference, distanceToRing, pointInPolygon, rectToPolygon, union, type MultiPolygon, type PolygonWithHoles } from "@/domain/geometry/polygons";
import type { Rect } from "@/domain/geometry/vector";
import type { Level, Point2 } from "@/domain/plan/types";
import { sitePlot, type Site } from "@/domain/project/site";

/**
 * The garden round a house, worked out from the house alone: a lawn to the
 * edge of the plot, a gravel strip at the foot of the walls, a terrace by
 * the garden doors, a path from the front door to the street, hedges on the
 * boundary and trees on the lawn. World metres, y up, like the plan; pure
 * data, so the plan, the 3D view and the layout pictures draw the same one.
 * It's decoration: nothing here is part of the plan or its checks.
 */

export interface GardenTree {
  x: number;
  y: number;
  /** Canopy radius, m. */
  r: number;
  /** Which of the theme's canopy greens. */
  shade: number;
}

export interface Garden {
  /** The plot the garden fills. */
  plot: Rect;
  /** Whether the plot is the site's own (a real boundary) rather than one made up round the house. */
  fromSite: boolean;
  /** Which side the garden is on; the street is opposite. */
  rear: EnvelopeSide;
  lawn: MultiPolygon;
  /** The lawn reaching the plot's edge, where there's no hedge (a made-up garden). */
  lawnToEdge: MultiPolygon;
  /** Gravel at the foot of the walls. */
  apron: MultiPolygon;
  terrace: MultiPolygon;
  path: MultiPolygon;
  hedges: MultiPolygon;
  trees: GardenTree[];
}

/** How far the plot reaches past the house on each side when there's no plot of its own, m. */
export const GARDEN_MARGIN = { rear: 9, front: 5, side: 4.5 } as const;
const APRON = 0.6;
const TERRACE_DEPTH = 3;
const TERRACE_MIN = 4;
const PATH_WIDTH = 1.2;
const HEDGE = 0.7;
/** Trees keep this far from the walls, so dimension lines and the GARDEN and STREET labels stay clear. */
const TREE_CLEAR = 2.4;

const OUT: Record<EnvelopeSide, Point2> = { north: { x: 0, y: 1 }, south: { x: 0, y: -1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 } };

/** The plot round a house: the house plus a margin, deepest on the garden side. */
export function gardenPlot(house: Rect, rear: EnvelopeSide, margin: { rear: number; front: number; side: number } = GARDEN_MARGIN): Rect {
  const grow: Record<EnvelopeSide, number> = { north: margin.side, south: margin.side, east: margin.side, west: margin.side };
  grow[rear] = margin.rear;
  grow[OPPOSITE_SIDE[rear]] = margin.front;
  return { minX: house.minX - grow.west, maxX: house.maxX + grow.east, minY: house.minY - grow.south, maxY: house.maxY + grow.north };
}

const horizontal = (side: EnvelopeSide) => side === "north" || side === "south";

/**
 * A strip beside a stretch of outside face: from `near` to `far` metres out
 * from it, between `from` and `to` along it (coordinates on the face's axis).
 */
function strip(face: number, side: EnvelopeSide, from: number, to: number, near: number, far: number): PolygonWithHoles {
  const out = OUT[side];
  const a = face + (horizontal(side) ? out.y : out.x) * near;
  const b = face + (horizontal(side) ? out.y : out.x) * far;
  const [lo, hi] = [Math.min(from, to), Math.max(from, to)];
  return rectToPolygon(
    horizontal(side) ? { minX: lo, maxX: hi, minY: Math.min(a, b), maxY: Math.max(a, b) } : { minX: Math.min(a, b), maxX: Math.max(a, b), minY: lo, maxY: hi },
  );
}

/** Where an edge's outside face is (y for north and south faces, x for east and west), and its span along the face. */
function faceOf(edge: EnvelopeEdge): { face: number; lo: number; hi: number } {
  const { start, end } = edge.outside;
  return horizontal(edge.facing)
    ? { face: start.y, lo: Math.min(start.x, end.x), hi: Math.max(start.x, end.x) }
    : { face: start.x, lo: Math.min(start.y, end.y), hi: Math.max(start.y, end.y) };
}

/** Coordinate along a face. */
const along = (side: EnvelopeSide, p: Point2) => (horizontal(side) ? p.x : p.y);

/** The plot's boundary on a side (y or x). */
function boundary(plot: Rect, side: EnvelopeSide): number {
  return side === "north" ? plot.maxY : side === "south" ? plot.minY : side === "east" ? plot.maxX : plot.minX;
}

/** A small fixed pseudo-random sequence, seeded from the house so its trees stay put. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Door {
  edge: EnvelopeEdge;
  lo: number;
  hi: number;
  centre: number;
}

/** The doors in the outside walls, each on the face it opens through. */
function outsideDoors(level: Level, edges: EnvelopeEdge[]): Door[] {
  const geometry = deriveLevelGeometry(level);
  const doors: Door[] = [];
  for (const opening of Object.values(level.openings)) {
    if (opening.kind !== "door") continue;
    const edge = edges.find((e) => e.wallId === opening.wallId);
    const at = edge && openingPlacement(geometry, opening);
    if (!edge || !at) continue;
    const [a, b] = [along(edge.facing, at.start), along(edge.facing, at.end)];
    doors.push({ edge, lo: Math.min(a, b), hi: Math.max(a, b), centre: along(edge.facing, at.centre) });
  }
  return doors;
}

const cache = new WeakMap<Level, Map<string, Garden | null>>();

/**
 * The garden round a floor's outline (the ground floor's, in practice), to
 * the edge of the site's plot when it has one; null while the outline isn't
 * closed.
 */
export function buildGarden(level: Level, site?: Site): Garden | null {
  const key = site?.plot ? JSON.stringify([site.plot, site.setbacks]) : "";
  let byPlot = cache.get(level);
  if (!byPlot) cache.set(level, (byPlot = new Map()));
  if (!byPlot.has(key)) byPlot.set(key, makeGarden(level, site));
  return byPlot.get(key)!;
}

function makeGarden(level: Level, site: Site | undefined): Garden | null {
  const env = analyzeEnvelope(level);
  if (!env.ok) return null;
  const { outsideRect: house, outsideRing, edges, sideOfWall } = env.info;
  const rear: EnvelopeSide = (level.rearWallId && sideOfWall[level.rearWallId]) || "north";
  const front = OPPOSITE_SIDE[rear];
  // The site's plot, though never less than the house and the gravel round it.
  const given = sitePlot(house, rear, site);
  const least = HEDGE + APRON + 0.3;
  const plot = given
    ? { minX: Math.min(given.minX, house.minX - least), minY: Math.min(given.minY, house.minY - least), maxX: Math.max(given.maxX, house.maxX + least), maxY: Math.max(given.maxY, house.maxY + least) }
    : gardenPlot(house, rear);
  const housePoly: PolygonWithHoles = { outer: outsideRing, holes: [] };
  const doors = outsideDoors(level, edges);

  // Gravel along every face, its ends reaching round the corners.
  const skirt = edges.map((e) => {
    const f = faceOf(e);
    return strip(f.face, e.facing, f.lo - APRON, f.hi + APRON, 0, APRON);
  });
  const apron = difference(union([housePoly, ...skirt])[0] ?? housePoly, [housePoly]);

  // A terrace on the garden side, across the garden doors if there are any.
  const rearEdges = edges.filter((e) => e.facing === rear);
  const gardenDoors = doors.filter((d) => d.edge.facing === rear);
  const main = gardenDoors.length
    ? gardenDoors.reduce((a, b) => (b.hi - b.lo > a.hi - a.lo ? b : a)).edge
    : rearEdges.find((e) => e.wallId === level.rearWallId) ?? rearEdges.reduce<EnvelopeEdge | undefined>((a, b) => (!a || b.outside.length > a.outside.length ? b : a), undefined);
  let terrace: MultiPolygon = [];
  if (main) {
    const f = faceOf(main);
    const onFace = gardenDoors.filter((d) => d.edge === main);
    let [lo, hi] = onFace.length ? [Math.min(...onFace.map((d) => d.lo)) - 1.2, Math.max(...onFace.map((d) => d.hi)) + 1.2] : [(f.lo + f.hi) / 2 - (f.hi - f.lo) * 0.3, (f.lo + f.hi) / 2 + (f.hi - f.lo) * 0.3];
    if (hi - lo < TERRACE_MIN) [lo, hi] = [(lo + hi) / 2 - TERRACE_MIN / 2, (lo + hi) / 2 + TERRACE_MIN / 2];
    [lo, hi] = [Math.max(lo, f.lo), Math.min(hi, f.hi)];
    const room = Math.abs(boundary(plot, rear) - f.face) - HEDGE - 1;
    if (hi - lo > 1 && room > 1) terrace = difference(strip(f.face, rear, lo, hi, 0, Math.min(TERRACE_DEPTH, room)), [housePoly]);
  }

  // A path from the front door to the street, round the corner from a door in a side wall.
  const middle = horizontal(front) ? (house.minX + house.maxX) / 2 : (house.minY + house.maxY) / 2;
  const frontDoor =
    doors.filter((d) => d.edge.facing === front).sort((a, b) => Math.abs(a.centre - middle) - Math.abs(b.centre - middle))[0] ??
    doors.find((d) => d.edge.facing !== rear);
  const street = boundary(plot, front);
  let path: MultiPolygon = [];
  let gate: PolygonWithHoles | null = null;
  if (frontDoor) {
    const f = faceOf(frontDoor.edge);
    const side = frontDoor.edge.facing;
    const [lo, hi] = [frontDoor.centre - PATH_WIDTH / 2, frontDoor.centre + PATH_WIDTH / 2];
    if (side === front) {
      path = difference(strip(f.face, side, lo, hi, 0, Math.abs(street - f.face)), [housePoly]);
      gate = strip(street, front, lo - 0.2, hi + 0.2, -(HEDGE + 0.1), 0.1);
    } else {
      // Out from the side door, then along the side of the house to the street.
      const out = 1 + PATH_WIDTH;
      const leg = strip(f.face, side, lo, hi, 0, out);
      const run = strip(f.face, side, frontDoor.centre, street, 1, out);
      path = difference(union([leg, run])[0] ?? leg, [housePoly]);
      const sign = horizontal(side) ? OUT[side].y : OUT[side].x;
      gate = strip(street, front, f.face + sign - 0.2 * sign, f.face + sign * out + 0.2 * sign, -(HEDGE + 0.1), 0.1);
    }
  }

  // Hedges round the plot, with a gap where the path goes through.
  const inner: Rect = { minX: plot.minX + HEDGE, minY: plot.minY + HEDGE, maxX: plot.maxX - HEDGE, maxY: plot.maxY - HEDGE };
  const hedges = difference(rectToPolygon(plot), [rectToPolygon(inner), ...(gate ? [gate] : [])]);
  const lawn = difference(rectToPolygon(inner), [housePoly, ...apron, ...terrace, ...path]);

  const lawnToEdge = given ? lawn : difference(rectToPolygon(plot), [housePoly, ...apron, ...terrace, ...path]);
  return { plot, fromSite: !!given, rear, lawn, lawnToEdge, apron, terrace, path, hedges, trees: plantTrees(inner, house, lawn, [...terrace, ...path], outsideRing) };
}

/**
 * Trees along the boundary, on the lawn: clear of the house (and its
 * dimension lines), the terrace and the path, and not crowding each other.
 */
function plantTrees(inner: Rect, house: Rect, lawn: MultiPolygon, paved: MultiPolygon, outsideRing: PolygonWithHoles["outer"]): GardenTree[] {
  const rand = random(Math.round((house.maxX - house.minX) * 100) * 7919 + Math.round((house.maxY - house.minY) * 100));
  const trees: GardenTree[] = [];
  const onLawn = (p: Point2) => lawn.some((poly) => pointInPolygon(poly, p));
  const fits = (t: GardenTree) =>
    onLawn(t) &&
    !pointInPolygon({ outer: outsideRing, holes: [] }, t) &&
    distanceToRing(outsideRing, t) >= t.r + TREE_CLEAR &&
    paved.every((poly) => !pointInPolygon(poly, t) && distanceToRing(poly.outer, t) >= t.r * 0.7) &&
    trees.every((o) => Math.hypot(o.x - t.x, o.y - t.y) >= (o.r + t.r) * 0.85);
  const line = (a: Point2, b: Point2, step: number) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.round(length / step));
    for (let i = 0; i < count; i++) {
      const r = 0.7 + rand() * 0.6;
      const t = (i + 0.3 + rand() * 0.4) / count;
      // In from the hedge by the canopy, give or take.
      const inX = a.x === b.x ? (a.x === inner.minX ? 1 : -1) : 0;
      const inY = a.y === b.y ? (a.y === inner.minY ? 1 : -1) : 0;
      const depth = r + 0.15 + rand() * 0.5;
      const tree = { x: a.x + (b.x - a.x) * t + inX * depth, y: a.y + (b.y - a.y) * t + inY * depth, r, shade: Math.floor(rand() * 4) };
      if (fits(tree)) trees.push(tree);
    }
  };
  line({ x: inner.minX, y: inner.maxY }, { x: inner.maxX, y: inner.maxY }, 3.4);
  line({ x: inner.minX, y: inner.minY }, { x: inner.maxX, y: inner.minY }, 3.4);
  line({ x: inner.minX, y: inner.minY }, { x: inner.minX, y: inner.maxY }, 3.8);
  line({ x: inner.maxX, y: inner.minY }, { x: inner.maxX, y: inner.maxY }, 3.8);
  return trees;
}
