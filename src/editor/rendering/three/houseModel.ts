import { deriveLevelGeometry, deriveRoomRegions, roomFaceIndices } from "@/domain/geometry/derive";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { outlineEdges, reflexVertices, SIDE_NORMAL, slabPartition } from "@/domain/geometry/outline";
import type { PolygonWithHoles, Ring } from "@/domain/geometry/polygons";
import type { Rect } from "@/domain/geometry/vector";
import { pointAtParam, type WallAxis } from "@/domain/geometry/walls";
import type { FloorMaterial, Furniture, Id, Level, Point2, RoomType } from "@/domain/plan/types";
import type { Site } from "@/domain/project/site";
import { buildGarden, type Garden } from "../scene/garden";
import { furnitureBoxes, type FurnitureTone } from "./furnitureModel";

/**
 * The house as plain 3D data, derived from a plan level: wall pieces around
 * every door and window, glass, door leaves, floors, roof and site. World
 * metres with the plan's x and y and z up. No WebGL here, so it can be
 * tested; the three.js adapter turns it into meshes.
 */

/** An upright box: `length` along `angle` (radians, plan CCW from +x), `depth` across it, `height` up from `z0`. */
export interface Box {
  kind: "wall" | "lintel" | "sill" | "frame" | "door" | "glass" | "roof" | "parapet" | "furniture" | "slab" | "stair" | "balustrade";
  center: Point2;
  z0: number;
  length: number;
  depth: number;
  height: number;
  angle: number;
  wallId?: Id;
  /** For external wall pieces: the outward unit normal in plan, so the outside face can take the exterior finish. */
  outward?: Point2;
  /** For furniture: what it's made of, and which piece it belongs to. */
  tone?: FurnitureTone;
  furnitureId?: Id;
}

export interface FloorPiece {
  roomId: Id;
  name: string;
  type: RoomType;
  material: FloorMaterial | null;
  /** The clear floor: usually one polygon, more if walls pinch the room apart. */
  polygons: PolygonWithHoles[];
  label: Point2;
  area: number;
  bounds: Rect;
  /** Height of the floor, for upper floors of a house of several (absent at ground level). */
  z?: number;
  levelId?: Id;
}

export interface DimensionLabel {
  text: string;
  at: Point2;
  z: number;
  /** Room labels carry the area under the name. */
  kind?: "dimension" | "room";
  detail?: string;
}

export interface HouseModel {
  boxes: Box[];
  floors: FloorPiece[];
  /** Bounding box of the outline's outside faces, or null if the plan has none. */
  outside: Rect | null;
  /** The outline's outside faces, or null. */
  outline: Ring | null;
  /** Rectangles tiling the outline's outside faces: the roof slabs, and the ceilings under them. */
  slabs: Rect[];
  /** Height of the tallest wall as built (before cutaway). */
  wallHeight: number;
  labels: DimensionLabel[];
  /** The garden round the house, when the landscape is on. */
  site: Garden | null;
  /** For a house of several floors: each floor's ceiling, at its height (absent otherwise: ceilings sit under `slabs` at `wallHeight`). */
  ceilings?: Array<{ rect: Rect; z: number }>;
  /** Each piece of furniture, for drawing from its 3D model where there is one; its boxes above are the fallback. */
  furniture?: FurniturePlacement[];
}

export interface FurniturePlacement {
  item: Furniture;
  /** The floor it stands on, m. */
  z: number;
  /** In a cutaway, nothing rises more than this above its floor. */
  cap: number;
}

export interface HouseModelOptions {
  /** Cut every wall down to this height to see in ("dollhouse"). */
  cutaway: boolean;
  roof: boolean;
  dimensions: boolean;
  landscape: boolean;
  furniture: boolean;
  /** Name and area floating over each room. */
  roomLabels?: boolean;
  /** The plot the garden fills, when the project has one. */
  site?: Site;
}

export const CUTAWAY_HEIGHT = 1.2;
const FRAME = 0.05;
const GLASS = 0.02;
export const ROOF_SLAB = 0.25;
const PARAPET = 0.3;
export const PARAPET_THICKNESS = 0.15;
const DOOR_OPEN = Math.PI / 6;

const cache = new WeakMap<Level, Map<string, HouseModel>>();

export function buildHouseModel(level: Level, options: HouseModelOptions): HouseModel {
  const key = JSON.stringify(options);
  const cached = cache.get(level)?.get(key);
  if (cached) return cached;
  const model = build(level, options);
  if (!cache.has(level)) cache.set(level, new Map());
  cache.get(level)!.set(key, model);
  return model;
}

function build(level: Level, options: HouseModelOptions): HouseModel {
  const geometry = deriveLevelGeometry(level);
  const env = analyzeEnvelope(level);
  const outside = env.ok ? env.info.outsideRect : null;
  const boxes: Box[] = [];
  let wallHeight = level.defaultWallHeight;

  for (const axis of geometry.axes.values()) {
    wallHeight = Math.max(wallHeight, axis.wall.height);
    wallPieces(level, axis, options, boxes);
  }

  // Floors: the clear region of every room.
  const regions = deriveRoomRegions(level);
  const faceOf = roomFaceIndices(level);
  const floors: FloorPiece[] = [];
  for (const room of Object.values(level.rooms)) {
    const region = regions[faceOf.get(room.id) ?? -1];
    if (!region) continue;
    const points = region.clear.flatMap((p) => p.outer);
    if (!points.length) continue;
    floors.push({
      roomId: room.id,
      name: room.name,
      type: room.type,
      material: room.floorMaterial ?? null,
      polygons: region.clear,
      label: region.labelPoint,
      area: region.clearArea,
      bounds: {
        minX: Math.min(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxX: Math.max(...points.map((p) => p.x)),
        maxY: Math.max(...points.map((p) => p.y)),
      },
    });
  }

  const furniture: FurniturePlacement[] = [];
  if (options.furniture) {
    const cap = options.cutaway ? CUTAWAY_HEIGHT : Infinity;
    for (const item of Object.values(level.furniture)) {
      boxes.push(...furnitureBoxes(item, cap));
      furniture.push({ item, z: 0, cap });
    }
  }

  // A flat roof with a parapet, sitting on the walls.
  const outline = env.ok ? env.info.outsideRing : null;
  const slabs = outline ? slabPartition(outline) : [];
  if (options.roof && outside && outline && !options.cutaway) {
    if (env.ok && env.info.isRectangle) {
      const cx = (outside.minX + outside.maxX) / 2;
      const cy = (outside.minY + outside.maxY) / 2;
      const w = outside.maxX - outside.minX;
      const d = outside.maxY - outside.minY;
      boxes.push({ kind: "roof", center: { x: cx, y: cy }, z0: wallHeight, length: w, depth: d, height: ROOF_SLAB, angle: 0 });
      const t = PARAPET_THICKNESS;
      const top = wallHeight + ROOF_SLAB;
      boxes.push(
        { kind: "parapet", center: { x: cx, y: outside.maxY - t / 2 }, z0: top, length: w, depth: t, height: PARAPET, angle: 0 },
        { kind: "parapet", center: { x: cx, y: outside.minY + t / 2 }, z0: top, length: w, depth: t, height: PARAPET, angle: 0 },
        { kind: "parapet", center: { x: outside.minX + t / 2, y: cy }, z0: top, length: d - 2 * t, depth: t, height: PARAPET, angle: Math.PI / 2 },
        { kind: "parapet", center: { x: outside.maxX - t / 2, y: cy }, z0: top, length: d - 2 * t, depth: t, height: PARAPET, angle: Math.PI / 2 },
      );
    } else {
      for (const r of slabs) {
        boxes.push({
          kind: "roof",
          center: { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 },
          z0: wallHeight,
          length: r.maxX - r.minX,
          depth: r.maxY - r.minY,
          height: ROOF_SLAB,
          angle: 0,
        });
      }
      boxes.push(...parapets(outline, wallHeight + ROOF_SLAB));
    }
  }

  const labels: DimensionLabel[] = [];
  if (options.dimensions && env.ok && outside) {
    const z = (options.cutaway ? CUTAWAY_HEIGHT : wallHeight) + 0.4;
    labels.push(
      { text: `${env.info.width.toFixed(3)} m`, at: { x: (outside.minX + outside.maxX) / 2, y: outside.maxY + 0.6 }, z },
      { text: `${env.info.depth.toFixed(3)} m`, at: { x: outside.minX - 0.6, y: (outside.minY + outside.maxY) / 2 }, z },
    );
  }

  if (options.roomLabels) {
    const z = (options.cutaway ? CUTAWAY_HEIGHT : wallHeight) + 0.15;
    for (const floor of floors) {
      if (floor.type === "hall" || floor.area < 2.5) continue;
      labels.push({ kind: "room", text: floor.name, detail: `${floor.area.toFixed(1)} m²`, at: floor.label, z });
    }
  }

  return { boxes, floors, outside, outline, slabs, wallHeight, labels, site: options.landscape && outside ? buildGarden(level, options.site) : null, furniture };
}

/**
 * A parapet just inside every outside face. Horizontal runs take the outward
 * corners and reach across the inward ones; vertical runs stop short of the
 * outward corners, so the strips meet without overlapping or leaving gaps.
 */
export function parapets(outline: Ring, z0: number): Box[] {
  const t = PARAPET_THICKNESS;
  const n = outline.length;
  const reflex = new Set(reflexVertices(outline));
  return outlineEdges(outline).map((e) => {
    const forward = e.horizontal ? e.end.x > e.start.x : e.end.y > e.start.y;
    const loReflex = reflex.has(forward ? e.index : (e.index + 1) % n);
    const hiReflex = reflex.has(forward ? (e.index + 1) % n : e.index);
    const lo = e.horizontal ? e.min - (loReflex ? t : 0) : e.min + (loReflex ? 0 : t);
    const hi = e.horizontal ? e.max + (hiReflex ? t : 0) : e.max - (hiReflex ? 0 : t);
    const inward = SIDE_NORMAL[e.facing];
    const across = e.line - (e.horizontal ? inward.y : inward.x) * (t / 2);
    const mid = (lo + hi) / 2;
    return {
      kind: "parapet",
      center: e.horizontal ? { x: mid, y: across } : { x: across, y: mid },
      z0,
      length: hi - lo,
      depth: t,
      height: PARAPET,
      angle: e.horizontal ? 0 : Math.PI / 2,
    };
  });
}

/** Solid wall between openings, sills and lintels around them, and the glass and doors in them. */
function wallPieces(level: Level, axis: WallAxis, options: HouseModelOptions, out: Box[]) {
  const wall = axis.wall;
  const full = wall.height;
  const height = options.cutaway ? Math.min(full, CUTAWAY_HEIGHT) : full;
  const angle = Math.atan2(axis.dir.y, axis.dir.x);
  const t = wall.thickness;
  const external = wall.role === "external";
  const env = external ? analyzeEnvelope(level) : null;
  // External walls run counterclockwise, so the outside is to the right of the axis.
  const outward = external && env?.ok ? { x: -axis.normal.x, y: -axis.normal.y } : undefined;
  const piece = (kind: Box["kind"], s0: number, s1: number, z0: number, z1: number, depth = t, offset = 0) => {
    if (s1 - s0 < 1e-4 || z1 - z0 < 1e-4) return;
    const mid = pointAtParam(axis, (s0 + s1) / 2);
    out.push({
      kind,
      center: { x: mid.x + axis.normal.x * offset, y: mid.y + axis.normal.y * offset },
      z0,
      length: s1 - s0,
      depth,
      height: z1 - z0,
      angle,
      wallId: wall.id,
      ...(outward && (kind === "wall" || kind === "lintel" || kind === "sill") ? { outward } : {}),
    });
  };

  const openings = Object.values(level.openings)
    .filter((o) => o.wallId === wall.id)
    .sort((a, b) => a.offset - b.offset);
  // Runs extend half a thickness past each end so corners and junctions close up.
  let cursor = -t / 2;
  for (const o of openings) {
    const s0 = Math.max(o.offset, 0);
    const s1 = Math.min(o.offset + o.width, axis.length);
    piece("wall", cursor, s0, 0, height);
    cursor = Math.max(cursor, s1);
    const bottom = o.kind === "window" ? o.sillHeight : 0;
    const top = Math.min(bottom + o.height, full);
    if (o.kind === "window") {
      piece("sill", s0, s1, 0, Math.min(bottom, height));
      if (bottom < height) {
        const paneTop = Math.min(top, height);
        piece("glass", s0 + FRAME, s1 - FRAME, bottom + FRAME, paneTop - (paneTop === top ? FRAME : 0), GLASS);
        piece("frame", s0, s1, bottom, bottom + FRAME, t * 0.6);
        if (paneTop === top) piece("frame", s0, s1, top - FRAME, top, t * 0.6);
        piece("frame", s0, s0 + FRAME, bottom, paneTop, t * 0.6);
        piece("frame", s1 - FRAME, s1, bottom, paneTop, t * 0.6);
      }
    } else {
      // The door leaf, a little open, hinged at its jamb and swinging to its side.
      const hingeAtStart = o.hinge !== "end";
      const hinge = pointAtParam(axis, hingeAtStart ? s0 : s1);
      const side = o.swingSide === "right" ? -1 : 1;
      const along = hingeAtStart ? 1 : -1;
      const toward = { x: axis.dir.x * along, y: axis.dir.y * along };
      const n = { x: axis.normal.x * side, y: axis.normal.y * side };
      const d = { x: toward.x * Math.cos(DOOR_OPEN) + n.x * Math.sin(DOOR_OPEN), y: toward.y * Math.cos(DOOR_OPEN) + n.y * Math.sin(DOOR_OPEN) };
      const w = s1 - s0;
      const base = { x: hinge.x + n.x * (t / 2), y: hinge.y + n.y * (t / 2) };
      out.push({
        kind: "door",
        center: { x: base.x + (d.x * w) / 2, y: base.y + (d.y * w) / 2 },
        z0: 0,
        length: w,
        depth: 0.04,
        height: Math.min(o.height, height),
        angle: Math.atan2(d.y, d.x),
        wallId: wall.id,
      });
    }
    piece("lintel", s0, s1, top, height);
  }
  piece("wall", cursor, axis.length + t / 2, 0, height);
}
