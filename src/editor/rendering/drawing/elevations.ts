import { analyzeEnvelope, type EnvelopeSide } from "@/domain/geometry/envelope";
import type { PlanDocument, Point2 } from "@/domain/plan/types";
import { buildBuildingModel } from "../three/buildingModel";
import type { RoofForm, RoofPiece } from "../three/roofModel";

/**
 * The house's four elevations as flat drawings: each outside wall facing
 * the viewer as a rectangle, its doors and windows, and the roof's
 * silhouette, all in metres along the face (u) and up from the ground (z).
 * Pieces carry their distance from the viewer so a drawing can paint the
 * far ones first. No canvas here; the PDF draws them.
 */

export interface ElevationRect {
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  /** Distance from the viewer: smaller is nearer. */
  depth: number;
}

export interface Elevation {
  side: EnvelopeSide;
  title: string;
  walls: ElevationRect[];
  openings: Array<ElevationRect & { kind: "door" | "window" }>;
  /** Roof silhouettes, as closed outlines in (u, z). */
  roofs: Array<{ points: Array<{ u: number; z: number }>; depth: number }>;
  /** Flat roofs and parapets, as bands. */
  bands: ElevationRect[];
  /** Overall extent along the face and up. */
  extent: { u0: number; u1: number; top: number };
}

/** How each side is seen: u runs left to right as the viewer sees it, depth away from them. */
const VIEW: Record<EnvelopeSide, { u: (p: Point2) => number; d: (p: Point2) => number }> = {
  south: { u: (p) => p.x, d: (p) => p.y },
  north: { u: (p) => -p.x, d: (p) => -p.y },
  west: { u: (p) => -p.y, d: (p) => p.x },
  east: { u: (p) => p.y, d: (p) => -p.x },
};

const OPPOSITE: Record<EnvelopeSide, EnvelopeSide> = { north: "south", south: "north", east: "west", west: "east" };

/** The four sides named for the house: the front faces the street, the rear the garden. */
function sideTitles(front: EnvelopeSide): Record<EnvelopeSide, string> {
  const left: Record<EnvelopeSide, EnvelopeSide> = { south: "west", north: "east", east: "south", west: "north" };
  return {
    [front]: "Front elevation",
    [OPPOSITE[front]]: "Rear elevation",
    [left[front]]: "Left side elevation",
    [OPPOSITE[left[front]]]: "Right side elevation",
  } as Record<EnvelopeSide, string>;
}

/** The silhouette of one roof piece seen along the view: its height at each u is its highest over the depth. */
function pieceProfile(piece: RoofPiece, side: EnvelopeSide): Array<{ u: number; z: number }> {
  const r = piece.rect;
  const view = VIEW[side];
  // Which of the rect's sides run across the view (their distance varies with u) and which along it.
  const alongX = side === "south" || side === "north";
  const [uLoSide, uHiSide] = alongX ? (["minX", "maxX"] as const) : (["minY", "maxY"] as const);
  const [vLoSide, vHiSide] = alongX ? (["minY", "maxY"] as const) : (["minX", "maxX"] as const);
  const corners = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.maxY },
  ];
  const us = corners.map(view.u);
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const lo = r[uLoSide];
  const hi = r[uHiSide];
  const vExtent = r[vHiSide] - r[vLoSide];
  const vEaves = (piece.eaves[vLoSide] ? 1 : 0) + (piece.eaves[vHiSide] ? 1 : 0);
  const vMax = vEaves === 2 ? vExtent / 2 : vEaves === 1 ? vExtent : Infinity;
  // Distance in from the u-sides that have eaves, at a world coordinate along the u axis.
  const dU = (w: number) => Math.min(piece.eaves[uLoSide] ? w - lo : Infinity, piece.eaves[uHiSide] ? hi - w : Infinity);
  const height = (w: number) => {
    const d = Math.min(dU(w), vMax);
    return piece.z0 + piece.skirt + piece.slope * (Number.isFinite(d) ? Math.max(0, d) : 0);
  };
  // Where the outline can bend: the ends, the middle (a peak), and where the slope meets the ridge height.
  const ws = [lo, hi, (lo + hi) / 2, lo + vMax, hi - vMax].filter((w) => Number.isFinite(w) && w >= lo && w <= hi).sort((a, b) => a - b);
  // World coordinate along the axis → u as the viewer sees it (north and west views run the other way).
  const flip = side === "north" || side === "west";
  const toU = (w: number) => (flip ? -w : w);
  const top = [...new Set(ws.map((w) => Math.round(w * 1e6) / 1e6))].map((w) => ({ u: toU(w), z: height(w) })).sort((a, b) => a.u - b.u);
  return withoutStraights([{ u: u0, z: piece.z0 }, ...top, { u: u1, z: piece.z0 }]);
}

/** An outline without the points that lie on a straight line between their neighbours. */
function withoutStraights(points: Array<{ u: number; z: number }>): Array<{ u: number; z: number }> {
  return points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const a = points[i - 1];
    const b = points[i + 1];
    return Math.abs((p.u - a.u) * (b.z - a.z) - (p.z - a.z) * (b.u - a.u)) > 1e-9;
  });
}

/** All four elevations of a house; empty when the ground floor has no closed outline. */
export function buildElevations(plan: PlanDocument, roofForm: RoofForm | undefined, roofPitch?: number): Elevation[] {
  const ground = analyzeEnvelope(plan.levels[0]);
  if (!ground.ok) return [];
  const rear = (plan.levels[0].rearWallId && ground.info.sideOfWall[plan.levels[0].rearWallId]) || "north";
  const titles = sideTitles(OPPOSITE[rear]);
  const model = buildBuildingModel(plan, { cutaway: false, roof: true, dimensions: false, landscape: false, furniture: false, roofForm, roofPitch });
  const order: EnvelopeSide[] = [OPPOSITE[rear], rear, ...(["west", "east", "north", "south"] as const).filter((s) => s !== rear && s !== OPPOSITE[rear])];
  return order.map((side) => {
    const view = VIEW[side];
    const walls: ElevationRect[] = [];
    const openings: Elevation["openings"] = [];
    for (const level of plan.levels) {
      const env = analyzeEnvelope(level);
      if (!env.ok) continue;
      for (const edge of env.info.edges) {
        if (edge.facing !== side) continue;
        const wall = level.walls[edge.wallId];
        const ua = view.u(edge.outside.start);
        const ub = view.u(edge.outside.end);
        const depth = view.d(edge.outside.start);
        walls.push({ u0: Math.min(ua, ub), u1: Math.max(ua, ub), z0: level.elevation, z1: level.elevation + (wall?.height ?? level.defaultWallHeight), depth });
        if (!wall) continue;
        const a = level.vertices[wall.startVertexId];
        const b = level.vertices[wall.endVertexId];
        if (!a || !b) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len === 0) continue;
        const at = (t: number) => ({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
        for (const o of Object.values(level.openings)) {
          if (o.wallId !== wall.id) continue;
          const p = view.u(at(o.offset));
          const q = view.u(at(o.offset + o.width));
          const sill = o.kind === "window" ? o.sillHeight : 0;
          openings.push({ kind: o.kind, u0: Math.min(p, q), u1: Math.max(p, q), z0: level.elevation + sill, z1: level.elevation + sill + o.height, depth: depth - 0.01 });
        }
      }
    }
    const roofs = (model.roofs ?? []).map((piece) => ({
      points: pieceProfile(piece, side),
      depth: Math.min(view.d({ x: piece.rect.minX, y: piece.rect.minY }), view.d({ x: piece.rect.maxX, y: piece.rect.maxY })),
    }));
    // Flat roofs and their parapets: the slab and parapet boxes, seen side on.
    const bands: ElevationRect[] = [];
    for (const box of model.boxes) {
      if (box.kind !== "roof" && box.kind !== "parapet") continue;
      const c = Math.cos(box.angle);
      const s = Math.sin(box.angle);
      const hx = box.length / 2;
      const hy = box.depth / 2;
      const pts = [
        [-hx, -hy],
        [hx, -hy],
        [hx, hy],
        [-hx, hy],
      ].map(([x, y]) => ({ x: box.center.x + x * c - y * s, y: box.center.y + x * s + y * c }));
      const us = pts.map(view.u);
      bands.push({ u0: Math.min(...us), u1: Math.max(...us), z0: box.z0, z1: box.z0 + box.height, depth: Math.min(...pts.map(view.d)) });
    }
    const allU = [...walls.flatMap((w) => [w.u0, w.u1]), ...roofs.flatMap((r) => r.points.map((p) => p.u)), ...bands.flatMap((b) => [b.u0, b.u1])];
    const allZ = [...walls.map((w) => w.z1), ...roofs.flatMap((r) => r.points.map((p) => p.z)), ...bands.map((b) => b.z1)];
    return {
      side,
      title: titles[side],
      walls,
      openings,
      roofs,
      bands,
      extent: { u0: Math.min(...allU), u1: Math.max(...allU), top: Math.max(0, ...allZ) },
    };
  });
}
