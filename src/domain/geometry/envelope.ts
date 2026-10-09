import type { Id, Level, Point2 } from "../plan/types";
import { EPS } from "./numeric";
import {
  axisToOutside,
  checkOutlineRing,
  classifyOutline,
  offsetRing,
  outlineEdges,
  reflexVertices,
  type EnvelopeSide,
  type OutlineFamily,
} from "./outline";
import { ringSignedArea, type Ring } from "./polygons";
import { rectFromPoints, type Rect } from "./vector";
import { wallAxis } from "./walls";

export type { EnvelopeSide, OutlineFamily } from "./outline";

const SIDES: readonly EnvelopeSide[] = ["south", "east", "north", "west"];

export interface EnvelopeEdge {
  wallId: Id;
  index: number;
  facing: EnvelopeSide;
  /** Along the wall centreline, start to end. */
  axis: { start: Point2; end: Point2; length: number };
  /** Along the outside face, what overall dimension lines measure. */
  outside: { start: Point2; end: Point2; length: number };
  startCorner: "convex" | "reflex";
  endCorner: "convex" | "reflex";
}

/**
 * Derived description of the house outline: external walls forming a
 * closed, counterclockwise, right-angle polygon. Rectangle-era fields keep
 * their names and mean the bounding box, so framing, cameras and overall
 * dimensions work unchanged for any shape.
 */
export interface EnvelopeInfo {
  /** Bounding box of the wall centrelines. */
  axisRect: Rect;
  /** Bounding box of the outside faces. */
  outsideRect: Rect;
  /** Outside-face to outside-face dimensions of the bounding box. */
  width: number;
  depth: number;
  /** For each side, the longest wall facing it on the bounding box. */
  sides: Record<EnvelopeSide, Id>;
  /** Which way every external wall faces. */
  sideOfWall: Record<Id, EnvelopeSide>;
  /** Thickness of each side's main wall. */
  thickness: Record<EnvelopeSide, number>;
  /** The thickest external wall. */
  externalThickness: number;
  /** Wall centrelines, counterclockwise; corner i is where envelope wall i starts. */
  axisRing: Ring;
  outsideRing: Ring;
  insideRing: Ring;
  edges: EnvelopeEdge[];
  /** External walls facing each side, in ring order. */
  wallsFacing: Record<EnvelopeSide, Id[]>;
  isRectangle: boolean;
  family: OutlineFamily;
  reflexCount: number;
  /** Area inside the outside faces, m². */
  grossArea: number;
}

export type EnvelopeResult = { ok: true; info: EnvelopeInfo } | { ok: false; message: string; wallIds: Id[] };

const cache = new WeakMap<object, WeakMap<object, WeakMap<object, EnvelopeResult>>>();

/** Checks that the envelope walls form a valid house outline and describes it. Cached per level geometry. */
export function analyzeEnvelope(level: Level): EnvelopeResult {
  let byVertices = cache.get(level.walls);
  if (!byVertices) cache.set(level.walls, (byVertices = new WeakMap()));
  let byEnvelope = byVertices.get(level.vertices);
  if (!byEnvelope) byVertices.set(level.vertices, (byEnvelope = new WeakMap()));
  const hit = byEnvelope.get(level.envelope);
  if (hit) return hit;
  const result = analyze(level);
  byEnvelope.set(level.envelope, result);
  return result;
}

function analyze(level: Level): EnvelopeResult {
  const ids = level.envelope.wallIds;
  if (ids.length < 4) return { ok: false, message: "The house outline needs at least four walls.", wallIds: [...ids] };
  if (new Set(ids).size !== ids.length) return { ok: false, message: "The house outline must reference distinct walls.", wallIds: [...ids] };
  for (const id of ids) {
    const wall = level.walls[id];
    if (!wall) return { ok: false, message: `Envelope wall ${id} does not exist.`, wallIds: [id] };
    if (wall.role !== "external") return { ok: false, message: "Envelope walls must be external.", wallIds: [id] };
    const axis = wallAxis(level, wall);
    if (!axis || (axis.orientation !== "horizontal" && axis.orientation !== "vertical")) {
      return { ok: false, message: "Envelope walls must be horizontal or vertical.", wallIds: [id] };
    }
  }
  const n = ids.length;
  for (let i = 0; i < n; i++) {
    const a = level.walls[ids[i]];
    const b = level.walls[ids[(i + 1) % n]];
    if (a.endVertexId !== b.startVertexId) return { ok: false, message: "Envelope walls must connect end to start.", wallIds: [a.id, b.id] };
  }
  const axisRing: Ring = ids.map((id) => level.vertices[level.walls[id].startVertexId]);
  const thicknesses = ids.map((id) => level.walls[id].thickness);
  const problem = checkOutlineRing(axisRing, thicknesses);
  if (problem) return { ok: false, message: problem.message, wallIds: problem.edges.length ? problem.edges.map((i) => ids[i]) : [...ids] };

  const outsideRing = axisToOutside(axisRing, thicknesses);
  const insideRing = offsetRing(axisRing, thicknesses.map((t) => -t / 2));
  const edges = outlineEdges(axisRing);
  const outsideEdges = outlineEdges(outsideRing);
  const reflex = new Set(reflexVertices(axisRing));
  const axisRect = rectFromPoints(axisRing);
  const outsideRect = rectFromPoints(outsideRing);

  const sideOfWall: Record<Id, EnvelopeSide> = {};
  const wallsFacing: Record<EnvelopeSide, Id[]> = { south: [], east: [], north: [], west: [] };
  for (const e of edges) {
    sideOfWall[ids[e.index]] = e.facing;
    wallsFacing[e.facing].push(ids[e.index]);
  }
  const boxLine: Record<EnvelopeSide, number> = { south: axisRect.minY, east: axisRect.maxX, north: axisRect.maxY, west: axisRect.minX };
  const sides = {} as Record<EnvelopeSide, Id>;
  const thickness = {} as Record<EnvelopeSide, number>;
  for (const side of SIDES) {
    let best: (typeof edges)[number] | null = null;
    for (const e of edges) {
      if (e.facing !== side || Math.abs(e.line - boxLine[side]) > EPS) continue;
      if (!best || e.length > best.length + EPS) best = e;
    }
    // Every side of the bounding box carries at least one wall facing out of it.
    sides[side] = ids[best!.index];
    thickness[side] = level.walls[sides[side]].thickness;
  }

  return {
    ok: true,
    info: {
      axisRect,
      outsideRect,
      width: outsideRect.maxX - outsideRect.minX,
      depth: outsideRect.maxY - outsideRect.minY,
      sides,
      sideOfWall,
      thickness,
      externalThickness: Math.max(...thicknesses),
      axisRing,
      outsideRing,
      insideRing,
      edges: edges.map((e) => ({
        wallId: ids[e.index],
        index: e.index,
        facing: e.facing,
        axis: { start: e.start, end: e.end, length: e.length },
        outside: { start: outsideEdges[e.index].start, end: outsideEdges[e.index].end, length: outsideEdges[e.index].length },
        startCorner: reflex.has(e.index) ? "reflex" : "convex",
        endCorner: reflex.has((e.index + 1) % n) ? "reflex" : "convex",
      })),
      wallsFacing,
      isRectangle: n === 4,
      family: classifyOutline(axisRing),
      reflexCount: reflex.size,
      grossArea: ringSignedArea(outsideRing),
    },
  };
}
