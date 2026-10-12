import type { Id, Level, Opening, Point2 } from "../plan/types";
import { analyzeEnvelope, type EnvelopeResult } from "./envelope";
import { computeFaces, findFaceIndexContaining, type Face } from "./faces";
import { wallFootprints, type WallFootprint } from "./footprints";
import { EPS } from "./numeric";
import {
  difference,
  interiorPoint,
  multiPolygonArea,
  polygonArea,
  union,
  type MultiPolygon,
  type PolygonWithHoles,
} from "./polygons";
import { analyzeContacts, type ContactMap } from "./topology";
import { rectsOverlap } from "./vector";
import { pointAtParam, wallAxes, type WallAxis } from "./walls";

/**
 * Geometry derived from authoritative walls and vertices. Levels are
 * immutable and edits share unchanged records, so results are cached by the
 * identity of the walls, vertices and envelope records: renaming a room or
 * editing an opening never recomputes topology.
 */
export interface LevelGeometry {
  axes: Map<Id, WallAxis>;
  contacts: ContactMap;
  overlaps: Array<[Id, Id]>;
  footprints: Map<Id, WallFootprint>;
  envelope: EnvelopeResult;
  faces: Face[];
}

const geometryCache = new WeakMap<object, WeakMap<object, WeakMap<object, LevelGeometry>>>();

export function deriveLevelGeometry(level: Level): LevelGeometry {
  let byVertices = geometryCache.get(level.walls);
  if (!byVertices) geometryCache.set(level.walls, (byVertices = new WeakMap()));
  let byEnvelope = byVertices.get(level.vertices);
  if (!byEnvelope) byVertices.set(level.vertices, (byEnvelope = new WeakMap()));
  const cached = byEnvelope.get(level.envelope);
  if (cached) return cached;
  const axes = wallAxes(level);
  const { contacts, overlaps } = analyzeContacts(axes.values());
  const footprints = wallFootprints(axes, contacts);
  const geometry: LevelGeometry = {
    axes,
    contacts,
    overlaps,
    footprints,
    envelope: analyzeEnvelope(level),
    faces: overlaps.length === 0 ? computeFaces(axes, contacts) : [],
  };
  byEnvelope.set(level.envelope, geometry);
  return geometry;
}

/** A face with its clear floor polygon (axis face minus wall footprints). */
export interface RoomRegion {
  faceIndex: number;
  face: Face;
  clear: MultiPolygon;
  /** Internal clear floor area, m². */
  clearArea: number;
  labelPoint: Point2;
}

const regionCache = new WeakMap<LevelGeometry, RoomRegion[]>();

type ClearResult = Pick<RoomRegion, "clear" | "clearArea" | "labelPoint">;

/**
 * Clear-region results keyed by the exact face outline and the footprints
 * that touch it. During a drag only the faces next to the moving wall change,
 * so every other face is reused instead of re-running polygon booleans.
 */
const clearCache = new Map<string, ClearResult>();
const CLEAR_CACHE_LIMIT = 4000;

const ringKey = (ring: readonly Point2[]) => ring.map((p) => `${p.x},${p.y}`).join(";");

function clearRegion(face: Face, clips: WallFootprint[]): ClearResult {
  const key = `${[face.polygon.outer, ...face.polygon.holes].map(ringKey).join("|")}#${clips
    .map((c) => `${c.rect.minX},${c.rect.minY},${c.rect.maxX},${c.rect.maxY}`)
    .join(";")}`;
  const hit = clearCache.get(key);
  if (hit) return hit;
  const clear = difference(
    face.polygon,
    clips.map((c) => c.polygon),
  );
  const clearArea = multiPolygonArea(clear);
  const largest = clear.reduce<PolygonWithHoles | null>(
    (best, p) => (!best || polygonArea(p) > polygonArea(best) ? p : best),
    null,
  );
  const labelPoint = interiorPoint(largest && polygonArea(largest) > EPS ? largest : face.polygon);
  const result = { clear, clearArea, labelPoint };
  if (clearCache.size >= CLEAR_CACHE_LIMIT) clearCache.delete(clearCache.keys().next().value!);
  clearCache.set(key, result);
  return result;
}

export function deriveRoomRegions(level: Level): RoomRegion[] {
  const geometry = deriveLevelGeometry(level);
  const cached = regionCache.get(geometry);
  if (cached) return cached;
  const footprints = [...geometry.footprints.values()];
  const regions = geometry.faces.map((face, faceIndex) => {
    const clips = footprints.filter((fp) => rectsOverlap(fp.rect, face.bounds, 0));
    return { faceIndex, face, ...clearRegion(face, clips) };
  });
  regionCache.set(geometry, regions);
  return regions;
}

const massCache = new WeakMap<LevelGeometry, MultiPolygon>();

/** Union of all wall footprints: the solid wall mass drawn on the plan. */
export function deriveWallMass(level: Level): MultiPolygon {
  const geometry = deriveLevelGeometry(level);
  const cached = massCache.get(geometry);
  if (cached) return cached;
  const mass = union([...geometry.footprints.values()].map((f) => f.polygon));
  massCache.set(geometry, mass);
  return mass;
}

const cutCache = new WeakMap<LevelGeometry, WeakMap<object, MultiPolygon>>();

/**
 * The wall mass with every door and window cut out of its own wall, as a
 * plan draws it: floors run through doorways and windows sit in a real gap.
 * Openings stay clear of junctions (openingHostIntervals), so each cut is a
 * rectangle across one wall's thickness and no other wall fills it again.
 */
export function deriveWallMassCut(level: Level): MultiPolygon {
  const openings = Object.values(level.openings);
  if (!openings.length) return deriveWallMass(level);
  const geometry = deriveLevelGeometry(level);
  let byOpenings = cutCache.get(geometry);
  if (!byOpenings) cutCache.set(geometry, (byOpenings = new WeakMap()));
  const cached = byOpenings.get(level.openings);
  if (cached) return cached;
  const onWall = new Map<Id, Opening[]>();
  for (const o of openings) onWall.set(o.wallId, [...(onWall.get(o.wallId) ?? []), o]);
  const pieces: PolygonWithHoles[] = [];
  for (const fp of geometry.footprints.values()) {
    const cuts = onWall.get(fp.wallId);
    const axis = geometry.axes.get(fp.wallId);
    if (!cuts || !axis) {
      pieces.push(fp.polygon);
      continue;
    }
    // A hair wider than the wall, so no sliver is left along either face.
    const half = axis.wall.thickness / 2 + 0.001;
    const across = (s: number, side: number): Point2 => {
      const p = pointAtParam(axis, s);
      return { x: p.x + axis.normal.x * side, y: p.y + axis.normal.y * side };
    };
    const clips = cuts.map((o) => ({ outer: [across(o.offset, -half), across(o.offset + o.width, -half), across(o.offset + o.width, half), across(o.offset, half)], holes: [] }));
    pieces.push(...difference(fp.polygon, clips));
  }
  const mass = union(pieces);
  byOpenings.set(level.openings, mass);
  return mass;
}

/** Maps each room to the index of the face containing its seed (or -1). */
export function roomFaceIndices(level: Level): Map<Id, number> {
  const faces = deriveLevelGeometry(level).faces;
  const map = new Map<Id, number>();
  for (const room of Object.values(level.rooms)) map.set(room.id, findFaceIndexContaining(faces, room.seed));
  return map;
}

/**
 * Parts of a wall axis that can host an opening: the axis minus the zones
 * occupied by perpendicular walls at corners, tees and crossings.
 */
export function openingHostIntervals(geometry: LevelGeometry, wallId: Id): Array<[number, number]> {
  const axis = geometry.axes.get(wallId);
  if (!axis) return [];
  const blocked: Array<[number, number]> = [];
  for (const c of geometry.contacts.get(wallId) ?? []) {
    if (!c.perpendicular) continue;
    blocked.push([c.s - c.otherThickness / 2, c.s + c.otherThickness / 2]);
  }
  blocked.sort((a, b) => a[0] - b[0]);
  const intervals: Array<[number, number]> = [];
  let cursor = 0;
  for (const [lo, hi] of blocked) {
    if (lo > cursor + EPS) intervals.push([cursor, Math.min(lo, axis.length)]);
    cursor = Math.max(cursor, hi);
  }
  if (axis.length > cursor + EPS) intervals.push([cursor, axis.length]);
  return intervals.filter(([lo, hi]) => hi - lo > EPS);
}

/**
 * The host interval an opening sits in: the clear stretch of wall between
 * the corners or junctions on either side of it. Falls back to the whole
 * axis when the opening does not fit one (an invalid, unvalidated state).
 */
export function openingHostInterval(geometry: LevelGeometry, opening: Pick<Opening, "wallId" | "offset" | "width">): [number, number] | null {
  const axis = geometry.axes.get(opening.wallId);
  if (!axis) return null;
  const centre = opening.offset + opening.width / 2;
  const intervals = openingHostIntervals(geometry, opening.wallId);
  return (
    intervals.find(([lo, hi]) => opening.offset >= lo - EPS && opening.offset + opening.width <= hi + EPS) ??
    intervals.find(([lo, hi]) => centre >= lo && centre <= hi) ?? [0, axis.length]
  );
}

export interface OpeningPlacement {
  axis: WallAxis;
  start: Point2;
  end: Point2;
  /** Centre point of the opening on the wall axis. */
  centre: Point2;
}

export function openingPlacement(geometry: LevelGeometry, opening: Opening): OpeningPlacement | null {
  const axis = geometry.axes.get(opening.wallId);
  if (!axis) return null;
  return {
    axis,
    start: pointAtParam(axis, opening.offset),
    end: pointAtParam(axis, opening.offset + opening.width),
    centre: pointAtParam(axis, opening.offset + opening.width / 2),
  };
}
