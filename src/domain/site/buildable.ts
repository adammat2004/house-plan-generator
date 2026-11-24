import type { PlotLimits } from "../design/footprint";
import { difference, distanceToRing, intersection, multiPolygonArea, pointInPolygon, union, type MultiPolygon, type PolygonWithHoles, type Ring } from "../geometry/polygons";
import { rectFromPoints, type Rect } from "../geometry/vector";
import type { Point2 } from "../plan/types";
import type { EdgeRole, Setbacks, TracedSite } from "../project/site";
import { toGrid } from "./geo";

/**
 * Where a house may go on a traced site. The site is turned so its road is
 * to the south, as every planner expects; each edge keeps a gap that depends
 * on what it is (the road side, the back or a side); the wastewater area and
 * its separation distance are cut out; what's left is the buildable area.
 */

/** Below this, an area or overlap is rounding, not a real piece, m². */
const AREA_EPS = 1e-4;
/** Corners on a gap's rounded ends. */
const ARC_SEGMENTS = 16;
/**
 * Site geometry is snapped to a tenth of a millimetre: far finer than any
 * trace, and it keeps near-equal corners (a grid round trip leaves 39.9999999994
 * where 40 was meant) from tripping up the polygon clipper.
 */
const SNAP = 1e-4;
const snap = (p: Point2): Point2 => ({ x: Math.round(p.x / SNAP) * SNAP + 0, y: Math.round(p.y / SNAP) * SNAP + 0 });

export type SetbackSource = "pack" | "default" | "user";

export interface SiteEdgeInfo {
  /** Edge i runs from traced corner i to corner i + 1. */
  index: number;
  a: Point2;
  b: Point2;
  length: number;
  /** Unit normal pointing out of the site. */
  normal: Point2;
  road: boolean;
  role: EdgeRole;
  roleSource: "auto" | "user";
  setback: number;
  setbackSource: SetbackSource;
}

export interface SiteFrame {
  /** The boundary in the site's frame, metres, corners in traced order. */
  ring: Ring;
  edges: SiteEdgeInfo[];
  /** Whether any edge is marked as meeting the road. Without one the site isn't turned. */
  hasRoad: boolean;
  /** Degrees the grid was turned (anticlockwise) to put the road to the south. */
  rotation: number;
  /** The grid point at the frame's origin. */
  origin: Point2;
  /** Degrees clockwise from straight up the plan to north, as `Site.north`. */
  north: number;
}

const rotate = (p: Point2, deg: number): Point2 => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Each edge's outward unit normal, for a ring in either winding. */
function outwardNormals(ring: Ring): Point2[] {
  const ccw = signedArea(ring) > 0;
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    return ccw ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
  });
}

/**
 * The site in its own frame, with each edge's role and gap. Edges marked as
 * meeting the road are the front; the edge facing most nearly away from them
 * is the rear; the rest are sides. A role the user chose wins. Gaps come from
 * what the user typed, then the rule pack, then the plot's gaps for that role.
 */
export function siteFrame(traced: TracedSite, setbacks: Setbacks, pack: Partial<Setbacks> = {}): SiteFrame {
  const grid = traced.boundary.map((p) => toGrid(p, traced.exportGrid));
  const origin = grid[0];
  const local = grid.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
  const normals = outwardNormals(local);
  const edgeAt = (i: number) => traced.edges?.[i] ?? {};
  const lengths = local.map((a, i) => Math.hypot(local[(i + 1) % local.length].x - a.x, local[(i + 1) % local.length].y - a.y));

  // The road's facing: the road edges' normals weighted by length.
  const roads = local.map((_, i) => edgeAt(i).road === true);
  const hasRoad = roads.some(Boolean);
  let front = { x: 0, y: -1 };
  if (hasRoad) {
    const sum = normals.reduce((acc, n, i) => (roads[i] ? { x: acc.x + n.x * lengths[i], y: acc.y + n.y * lengths[i] } : acc), { x: 0, y: 0 });
    const len = Math.hypot(sum.x, sum.y);
    if (len > 1e-9) front = { x: sum.x / len, y: sum.y / len };
  }
  // Turn so the road faces south (−y).
  const rotation = hasRoad ? (((-90 - (Math.atan2(front.y, front.x) * 180) / Math.PI) % 360) + 360) % 360 : 0;

  // The rear: of the edges not on the road, the one facing most nearly away from it.
  let rear = -1;
  if (hasRoad) {
    let best = -Infinity;
    let farthest = -Infinity;
    normals.forEach((n, i) => {
      if (roads[i]) return;
      const facing = -(n.x * front.x + n.y * front.y);
      // Of edges facing the same way (the step of an L and its far side), the one farthest from the road.
      const a = local[i];
      const b = local[(i + 1) % local.length];
      const away = -(((a.x + b.x) / 2) * front.x + ((a.y + b.y) / 2) * front.y);
      if (facing > best + 1e-6 || (facing > best - 1e-6 && away > farthest)) {
        best = Math.max(best, facing);
        farthest = away;
        rear = i;
      }
    });
  }

  const ring = local.map((p) => snap(rotate(p, rotation)));
  const turned = outwardNormals(ring);
  const edges: SiteEdgeInfo[] = ring.map((a, i) => {
    const e = edgeAt(i);
    const auto: EdgeRole = roads[i] ? "front" : i === rear ? "rear" : "side";
    const role = e.role ?? auto;
    const packGap = pack[role];
    const [setback, setbackSource]: [number, SetbackSource] =
      e.setback !== undefined ? [e.setback, "user"] : packGap !== undefined ? [packGap, "pack"] : [setbacks[role], "default"];
    return {
      index: i,
      a,
      b: ring[(i + 1) % ring.length],
      length: lengths[i],
      normal: turned[i],
      road: roads[i],
      role,
      roleSource: e.role ? "user" : "auto",
      setback,
      setbackSource,
    };
  });
  return { ring, edges, hasRoad, rotation, origin, north: (((-rotation) % 360) + 360) % 360 };
}

/** A point traced on the map, in the site's frame. */
export function toFrame(frame: Pick<SiteFrame, "origin" | "rotation">, p: Point2): Point2 {
  return rotate({ x: p.x - frame.origin.x, y: p.y - frame.origin.y }, frame.rotation);
}

/** The inverse of {@link toFrame}: a point in the site's frame, back to the grid. */
export function fromFrame(frame: Pick<SiteFrame, "origin" | "rotation">, p: Point2): Point2 {
  const r = rotate(p, -frame.rotation);
  return { x: r.x + frame.origin.x, y: r.y + frame.origin.y };
}

/** Everything within `d` of the segment a–b: a strip with round ends. */
function segmentZone(a: Point2, b: Point2, d: number): PolygonWithHoles[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const disc = (c: Point2): PolygonWithHoles => ({
    outer: Array.from({ length: ARC_SEGMENTS }, (_, k) => {
      const t = (2 * Math.PI * k) / ARC_SEGMENTS;
      // The polygon's flat sides sit at d, so the disc covers the full radius.
      const r = d / Math.cos(Math.PI / ARC_SEGMENTS);
      return snap({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
    }),
    holes: [],
  });
  if (len < 1e-9) return [disc(a)];
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const strip: PolygonWithHoles = {
    outer: [
      { x: a.x + n.x * d, y: a.y + n.y * d },
      { x: b.x + n.x * d, y: b.y + n.y * d },
      { x: b.x - n.x * d, y: b.y - n.y * d },
      { x: a.x - n.x * d, y: a.y - n.y * d },
    ].map(snap),
    holes: [],
  };
  return [strip, disc(a), disc(b)];
}

/** A polygon grown by `d` all round. */
export function grow(ring: Ring, d: number): MultiPolygon {
  const base: PolygonWithHoles = { outer: ring, holes: [] };
  if (d <= 0) return [base];
  return union([base, ...ring.flatMap((a, i) => segmentZone(a, ring[(i + 1) % ring.length], d))]);
}

/** Each edge's gap, as the ground within its setback of the edge. */
function gapZone(edge: SiteEdgeInfo): PolygonWithHoles[] {
  return edge.setback > 0 ? segmentZone(edge.a, edge.b, edge.setback) : [];
}

export interface Cutout {
  /** In the site's frame. */
  ring: Ring;
  /** How far the house must keep from it, m. */
  distance: number;
}

/** The site less every edge's gap and each cut-out with its distance. Can be empty, or in pieces. */
export function buildableArea(frame: SiteFrame, cutouts: readonly Cutout[] = []): MultiPolygon {
  const site: PolygonWithHoles = { outer: frame.ring, holes: [] };
  const clips = [...frame.edges.flatMap(gapZone), ...cutouts.flatMap((c) => grow(c.ring, c.distance))];
  const area = clips.length ? difference(site, clips) : [site];
  return area.filter((p) => multiPolygonArea([p]) > AREA_EPS);
}

/** The grid step for finding the largest rectangle: 0.5 m, coarser on very big sites so it stays quick. */
export function rectStep(area: MultiPolygon): number {
  return Math.max(0.5, Math.sqrt(multiPolygonArea(area) / 160_000));
}

/**
 * The largest-area rectangle, square to the site's frame, that fits in the
 * area: found on a grid of `step` metres, so it can be up to a step short of
 * the true largest on each side. Null when nothing fits.
 */
export function largestRect(area: MultiPolygon, step = rectStep(area)): Rect | null {
  let best: Rect | null = null;
  let bestCells = 0;
  for (const poly of area) {
    const box = rectFromPoints(poly.outer);
    const cols = Math.floor((box.maxX - box.minX) / step + 1e-9);
    const rows = Math.floor((box.maxY - box.minY) / step + 1e-9);
    if (cols < 1 || rows < 1) continue;
    // Which grid corners are inside; a cell is inside when its four corners are.
    const corner = Array.from({ length: rows + 1 }, (_, j) => Array.from({ length: cols + 1 }, (_, i) => onOrIn(poly, { x: box.minX + i * step, y: box.minY + j * step })));
    const heights = new Array<number>(cols).fill(0);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) heights[i] = corner[j][i] && corner[j][i + 1] && corner[j + 1][i] && corner[j + 1][i + 1] ? heights[i] + 1 : 0;
      // The largest rectangle under this row's histogram of inside cells.
      const stack: number[] = [];
      for (let i = 0; i <= cols; i++) {
        const h = i < cols ? heights[i] : 0;
        while (stack.length && heights[stack[stack.length - 1]] >= h) {
          const height = heights[stack.pop()!];
          const left = stack.length ? stack[stack.length - 1] + 1 : 0;
          if (height * (i - left) > bestCells) {
            bestCells = height * (i - left);
            best = { minX: box.minX + left * step, maxX: box.minX + i * step, minY: box.minY + (j + 1 - height) * step, maxY: box.minY + (j + 1) * step };
          }
        }
        stack.push(i);
      }
    }
  }
  // Corners inside can still miss a thin notch between them: step in until the rectangle really fits.
  for (let k = 0; best && k < 4; k++) {
    if (contains(area, rectRing(best))) return best;
    best = best.maxX - best.minX > 2 * step && best.maxY - best.minY > 2 * step ? { minX: best.minX + step, maxX: best.maxX - step, minY: best.minY + step, maxY: best.maxY - step } : null;
  }
  return null;
}

/** Inside the polygon or on its edge: a rectangle may run along the buildable area's edge. */
function onOrIn(poly: PolygonWithHoles, p: Point2): boolean {
  const onEdge = (ring: Ring) => distanceToRing(ring, p) <= 1e-6;
  return (pointInPolygon(poly, p) || onEdge(poly.outer)) && !poly.holes.some((h) => pointInPolygon({ outer: h, holes: [] }, p) && !onEdge(h));
}

export const rectRing = (r: Rect): Ring => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

/**
 * The planners' size limits: the largest rectangle less the check band on
 * every side, so a house sized to fit reads as meeting every gap rather than
 * sitting on the line.
 */
export function plotLimits(rect: Rect, band: number): PlotLimits {
  const r = (v: number) => Math.round(Math.max(0, v) * 100) / 100;
  return { maxWidth: r(rect.maxX - rect.minX - 2 * band), maxDepth: r(rect.maxY - rect.minY - 2 * band) };
}

/** Whether the ring lies wholly inside the area. */
export function contains(area: MultiPolygon, ring: Ring): boolean {
  if (!area.length) return false;
  return multiPolygonArea(difference({ outer: ring, holes: [] }, area)) <= AREA_EPS;
}

export interface Placement {
  x: number;
  y: number;
  /** Degrees anticlockwise. */
  rotation: number;
}

/** A footprint, in its own coordinates, put on the site. */
export function placeRing(footprint: Ring, placement: Placement): Ring {
  return footprint.map((p) => {
    const r = rotate(p, placement.rotation);
    return { x: r.x + placement.x, y: r.y + placement.y };
  });
}

/** The placement that centres the footprint, turned by `rotation`, on a point. */
export function centredOn(footprint: Ring, centre: Point2, rotation = 0): Placement {
  const box = rectFromPoints(footprint.map((p) => rotate(p, rotation)));
  return { x: centre.x - (box.minX + box.maxX) / 2, y: centre.y - (box.minY + box.maxY) / 2, rotation };
}

export interface PlacedHouse {
  placement: Placement;
  /** "kept": where the last house was; "centred": on the largest rectangle; "moved": the nearest spot that fits. */
  how: "kept" | "centred" | "moved";
}

/**
 * Where a house goes on the site. It stays where the last one was if it
 * fits there, else it's centred on the largest rectangle, else it takes the
 * nearest spot that fits. Null when it fits nowhere.
 */
export function placeHouse(area: MultiPolygon, footprint: Ring, previous?: Placement, rect: Rect | null = largestRect(area)): PlacedHouse | null {
  if (previous && contains(area, placeRing(footprint, previous))) return { placement: previous, how: "kept" };
  const rotation = previous?.rotation ?? 0;
  if (!rect) return null;
  const centre = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  const centred = centredOn(footprint, centre, rotation);
  if (contains(area, placeRing(footprint, centred))) return { placement: centred, how: "centred" };
  // The nearest spot that fits, searched outward from the centre.
  const box = area.reduce<Rect | null>((acc, p) => {
    const b = rectFromPoints(p.outer);
    return acc ? { minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY), maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY) } : b;
  }, null)!;
  const step = Math.max(0.5, Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 200);
  const offsets: Point2[] = [];
  for (let x = box.minX; x <= box.maxX + 1e-9; x += step) for (let y = box.minY; y <= box.maxY + 1e-9; y += step) offsets.push({ x: x - centre.x, y: y - centre.y });
  offsets.sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y));
  for (const o of offsets) {
    const p = { x: centred.x + o.x, y: centred.y + o.y, rotation };
    if (contains(area, placeRing(footprint, p))) return { placement: p, how: "moved" };
  }
  return null;
}

/** The edges whose gap a placed house reaches into, so a result can name them. */
export function crossedEdges(frame: SiteFrame, house: Ring): SiteEdgeInfo[] {
  const footprint: PolygonWithHoles = { outer: house, holes: [] };
  return frame.edges.filter((e) => gapZone(e).some((zone) => multiPolygonArea(intersection(footprint, zone)) > AREA_EPS));
}

/** Whether a placed house reaches outside the site itself. */
export function outsideSite(frame: SiteFrame, house: Ring): boolean {
  return multiPolygonArea(difference({ outer: house, holes: [] }, [{ outer: frame.ring, holes: [] }])) > AREA_EPS;
}
