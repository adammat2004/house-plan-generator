import { deriveLevelGeometry, deriveRoomRegions, deriveWallMass, openingHostInterval, roomFaceIndices } from "@/domain/geometry/derive";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { formatArea } from "@/domain/geometry/numeric";
import type { MultiPolygon, Ring } from "@/domain/geometry/polygons";
import type { Rect } from "@/domain/geometry/vector";
import { pointAtParam, type WallAxis } from "@/domain/geometry/walls";
import { roomBounds } from "@/domain/design/analysis";
import type { FloorMaterial, Id, Level, Opening, Point2, RoomType } from "@/domain/plan/types";

/**
 * Pure derivation from a Level to drawable 2D primitives in world metres.
 * The Konva adapter maps these to the screen; nothing here is interactive.
 */
export interface RoomPrimitive {
  id: Id;
  name: string;
  type: RoomType;
  floorMaterial: FloorMaterial | null;
  targetArea: number | null;
  clear: MultiPolygon;
  areaLabel: string;
  clearArea: number;
  label: Point2;
  /** Clear-region bounds, used to decide whether a label fits on screen. */
  bounds: Rect;
}

export interface OpeningPrimitive {
  id: Id;
  kind: Opening["kind"];
  wallId: Id;
  /** Region of wall removed by the opening. */
  cut: Ring;
  jambs: Array<[Point2, Point2]>;
  /** Door leaf (hinge → open tip) and swing arc. */
  leaf?: [Point2, Point2];
  arc?: Point2[];
  /** Window frame outline and glazing lines. */
  frame?: Ring;
  glazing?: Array<[Point2, Point2]>;
}

export interface AxisPrimitive {
  wallId: Id;
  start: Point2;
  end: Point2;
  role: "external" | "internal";
  thickness: number;
  footprint: Ring;
}

export interface PlanScene {
  wallMass: MultiPolygon;
  rooms: RoomPrimitive[];
  openings: OpeningPrimitive[];
  axes: AxisPrimitive[];
  outsideRect: Rect | null;
  rearWallId: Id | null;
}

const sceneCache = new WeakMap<Level, PlanScene>();

export function buildPlanScene(level: Level): PlanScene {
  const cached = sceneCache.get(level);
  if (cached) return cached;
  const geometry = deriveLevelGeometry(level);
  const regions = deriveRoomRegions(level);
  const faceOfRoom = roomFaceIndices(level);
  const env = analyzeEnvelope(level);

  const rooms: RoomPrimitive[] = [];
  for (const room of Object.values(level.rooms)) {
    const region = regions[faceOfRoom.get(room.id) ?? -1];
    if (!region) continue;
    const points = region.clear.flatMap((p) => p.outer);
    const bounds = points.length ? boundsOf(points) : region.face.bounds;
    rooms.push({
      id: room.id,
      name: room.name,
      type: room.type,
      floorMaterial: room.floorMaterial ?? null,
      targetArea: room.targetArea ?? null,
      clear: region.clear,
      clearArea: region.clearArea,
      areaLabel: formatArea(region.clearArea),
      label: region.labelPoint,
      bounds,
    });
  }

  const openings: OpeningPrimitive[] = [];
  for (const opening of Object.values(level.openings)) {
    const axis = geometry.axes.get(opening.wallId);
    if (axis) openings.push(openingPrimitive(opening, axis));
  }

  const axes: AxisPrimitive[] = [];
  for (const axis of geometry.axes.values()) {
    const fp = geometry.footprints.get(axis.wallId);
    axes.push({
      wallId: axis.wallId,
      start: axis.start,
      end: axis.end,
      role: axis.wall.role,
      thickness: axis.wall.thickness,
      footprint: fp ? fp.polygon.outer : [],
    });
  }

  const scene: PlanScene = {
    wallMass: deriveWallMass(level),
    rooms,
    openings,
    axes,
    outsideRect: env.ok ? env.info.outsideRect : null,
    rearWallId: level.rearWallId,
  };
  sceneCache.set(level, scene);
  return scene;
}

function boundsOf(points: Point2[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

const offsetPoint = (axis: WallAxis, s: number, side: number): Point2 => {
  const p = pointAtParam(axis, s);
  return { x: p.x + axis.normal.x * side, y: p.y + axis.normal.y * side };
};

export function openingPrimitive(opening: Pick<Opening, "id" | "kind" | "wallId" | "offset" | "width"> & Partial<Opening>, axis: WallAxis): OpeningPrimitive {
  const half = axis.wall.thickness / 2;
  const s0 = opening.offset;
  const s1 = opening.offset + opening.width;
  const cut: Ring = [offsetPoint(axis, s0, -half), offsetPoint(axis, s1, -half), offsetPoint(axis, s1, half), offsetPoint(axis, s0, half)];
  const jambs: Array<[Point2, Point2]> = [
    [offsetPoint(axis, s0, -half), offsetPoint(axis, s0, half)],
    [offsetPoint(axis, s1, -half), offsetPoint(axis, s1, half)],
  ];
  const base = { id: opening.id, kind: opening.kind, wallId: opening.wallId, cut, jambs };
  if (opening.kind === "door") {
    const hingeAtStart = (opening as { hinge?: string }).hinge !== "end";
    const sign = (opening as { swingSide?: string }).swingSide === "right" ? -1 : 1;
    const sh = hingeAtStart ? s0 : s1;
    const sl = hingeAtStart ? s1 : s0;
    const hinge = offsetPoint(axis, sh, sign * half);
    const closed = offsetPoint(axis, sl, sign * half);
    const n = { x: axis.normal.x * sign, y: axis.normal.y * sign };
    const open = { x: hinge.x + n.x * opening.width, y: hinge.y + n.y * opening.width };
    const a0 = Math.atan2(open.y - hinge.y, open.x - hinge.x);
    const a1 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const arc: Point2[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (sweep * i) / steps;
      arc.push({ x: hinge.x + Math.cos(a) * opening.width, y: hinge.y + Math.sin(a) * opening.width });
    }
    return { ...base, leaf: [hinge, open], arc };
  }
  const g = half * 0.3;
  return {
    ...base,
    frame: cut,
    glazing: [
      [offsetPoint(axis, s0, -g), offsetPoint(axis, s1, -g)],
      [offsetPoint(axis, s0, g), offsetPoint(axis, s1, g)],
    ],
  };
}

export const formatMm = (metres: number) => `${Math.round(metres * 1000)} mm`;

/** Dimension line in world coordinates with a screen-space offset. */
export interface DimensionPrimitive {
  key: string;
  a: Point2;
  b: Point2;
  /** Offset in CSS pixels along the left normal of a → b (in world orientation). */
  offsetPx: number;
  text: string;
  tone: "overall" | "selection";
}

export function buildDimensions(level: Level, selection: { kind: string; id: Id } | null): DimensionPrimitive[] {
  const dims: DimensionPrimitive[] = [];
  const env = analyzeEnvelope(level);
  if (env.ok) {
    const r = env.info.outsideRect;
    // a → b runs east along the north face; its left side (positive offset) is outside the house.
    dims.push({
      key: "overall-width",
      a: { x: r.minX, y: r.maxY },
      b: { x: r.maxX, y: r.maxY },
      offsetPx: 44,
      text: `${env.info.width.toFixed(3)} m`,
      tone: "overall",
    });
    // a → b runs south along the west face; its right side (negative offset) is outside.
    dims.push({
      key: "overall-depth",
      a: { x: r.minX, y: r.maxY },
      b: { x: r.minX, y: r.minY },
      offsetPx: -44,
      text: `${env.info.depth.toFixed(3)} m`,
      tone: "overall",
    });
  }
  if (!selection) return dims;
  const geometry = deriveLevelGeometry(level);
  if (selection.kind === "room") {
    // Clear width along the north face and clear depth down the east face, just inside the room.
    const b = roomBounds(level, selection.id);
    if (b) {
      dims.push({ key: "room-width", a: { x: b.minX, y: b.maxY }, b: { x: b.maxX, y: b.maxY }, offsetPx: -16, text: `${(b.maxX - b.minX).toFixed(3)} m`, tone: "selection" });
      dims.push({ key: "room-depth", a: { x: b.maxX, y: b.maxY }, b: { x: b.maxX, y: b.minY }, offsetPx: -16, text: `${(b.maxY - b.minY).toFixed(3)} m`, tone: "selection" });
    }
  } else if (selection.kind === "wall") {
    const axis = geometry.axes.get(selection.id);
    if (axis) {
      dims.push({
        key: "wall-length",
        a: axis.start,
        b: axis.end,
        offsetPx: 20,
        text: `${axis.length.toFixed(3)} m`,
        tone: "selection",
      });
    }
  } else if (selection.kind === "opening") {
    const opening = level.openings[selection.id];
    const axis = opening && geometry.axes.get(opening.wallId);
    if (opening && axis) {
      const s0 = opening.offset;
      const s1 = opening.offset + opening.width;
      dims.push({ key: "opening-width", a: pointAtParam(axis, s0), b: pointAtParam(axis, s1), offsetPx: 20, text: formatMm(opening.width), tone: "selection" });
      // Clearances to the corners or junctions either side, chained on the same line.
      const [lo, hi] = openingHostInterval(geometry, opening) ?? [0, axis.length];
      if (s0 - lo > 0.005) {
        dims.push({ key: "opening-gap-start", a: pointAtParam(axis, lo), b: pointAtParam(axis, s0), offsetPx: 20, text: formatMm(s0 - lo), tone: "selection" });
      }
      if (hi - s1 > 0.005) {
        dims.push({ key: "opening-gap-end", a: pointAtParam(axis, s1), b: pointAtParam(axis, hi), offsetPx: 20, text: formatMm(hi - s1), tone: "selection" });
      }
    }
  }
  return dims;
}
