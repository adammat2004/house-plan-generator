import { analyzeEnvelope } from "../../geometry/envelope";
import { EPS, formatMetres, roundToPrecision } from "../../geometry/numeric";
import { LIMITS } from "../../plan/defaults";
import type { Id, Level, Wall } from "../../plan/types";
import type { IdSource } from "../ids";
import { compensateOpenings, fail, requireLength } from "../ops";
import type { PlanCommand } from "../types";

type CreateFootprint = Extract<PlanCommand, { type: "createFootprint" }>;
type ResizeFootprint = Extract<PlanCommand, { type: "resizeFootprint" }>;

/**
 * Builds a new level with a rectangular envelope. Width and depth are
 * outside-face dimensions; the lower-left outside corner sits at the origin
 * and wall centrelines are inset by half the external thickness.
 */
export function createFootprint(previous: Level | null, cmd: CreateFootprint, ids: IdSource): Level {
  const thickness = requireLength(
    cmd.externalThickness,
    "External wall thickness",
    LIMITS.minWallThickness,
    LIMITS.maxWallThickness,
  );
  const minSize = roundToPrecision(2 * thickness + LIMITS.minHouseClearSpan);
  const width = requireLength(cmd.width, "House width", minSize, LIMITS.maxHouseSize);
  const depth = requireLength(cmd.depth, "House depth", minSize, LIMITS.maxHouseSize);
  const height = requireLength(cmd.wallHeight, "Wall height", 1, LIMITS.maxWallHeight);

  const half = thickness / 2;
  const corners = [
    { x: half, y: half },
    { x: roundToPrecision(width - half), y: half },
    { x: roundToPrecision(width - half), y: roundToPrecision(depth - half) },
    { x: half, y: roundToPrecision(depth - half) },
  ];
  const vertexIds = corners.map(() => ids.next("v"));
  const wallIds = corners.map(() => ids.next("wall")) as [Id, Id, Id, Id];
  const vertices: Level["vertices"] = {};
  vertexIds.forEach((id, i) => (vertices[id] = corners[i]));
  const walls: Record<Id, Wall> = {};
  wallIds.forEach((id, i) => {
    walls[id] = {
      id,
      startVertexId: vertexIds[i],
      endVertexId: vertexIds[(i + 1) % 4],
      role: "external",
      thickness,
      height,
    };
  });

  return {
    id: previous?.id ?? ids.next("level"),
    name: previous?.name ?? "Ground floor",
    elevation: previous?.elevation ?? 0,
    defaultWallHeight: height,
    vertices,
    walls,
    openings: {},
    rooms: {},
    envelope: { kind: "rectangle", wallIds },
    rearWallId: null,
  };
}

/**
 * Resizes the envelope keeping the lower-left outside corner fixed. Vertices
 * on the moving east/north wall line move with it, so attached internal
 * walls stretch; everything else keeps its coordinates.
 */
export function resizeFootprint(level: Level, cmd: ResizeFootprint): Level {
  const env = analyzeEnvelope(level);
  if (!env.ok) fail("envelope-invalid", env.message, env.wallIds);
  const { axisRect: r, outsideRect: o, thickness: t, sides } = env.info;
  const minWidth = roundToPrecision(t.west + t.east + LIMITS.minHouseClearSpan);
  const minDepth = roundToPrecision(t.south + t.north + LIMITS.minHouseClearSpan);

  let dx = 0;
  let dy = 0;
  if (cmd.width !== undefined) {
    const width = requireLength(cmd.width, "House width", minWidth, LIMITS.maxHouseSize);
    dx = roundToPrecision(o.minX + width - t.east / 2) - r.maxX;
  }
  if (cmd.depth !== undefined) {
    const depth = requireLength(cmd.depth, "House depth", minDepth, LIMITS.maxHouseSize);
    dy = roundToPrecision(o.minY + depth - t.north / 2) - r.maxY;
  }
  if (Math.abs(dx) <= EPS && Math.abs(dy) <= EPS) return level;

  const onEast = (x: number) => Math.abs(x - r.maxX) <= EPS;
  const onNorth = (y: number) => Math.abs(y - r.maxY) <= EPS;

  if (dx < -EPS) {
    checkShrink(level, "x", r.maxX + dx, t.east, onEast, sides.east, o.minX, "width");
  }
  if (dy < -EPS) {
    checkShrink(level, "y", r.maxY + dy, t.north, onNorth, sides.north, o.minY, "depth");
  }

  const vertices: Level["vertices"] = {};
  for (const [id, p] of Object.entries(level.vertices)) {
    vertices[id] = {
      x: onEast(p.x) ? roundToPrecision(p.x + dx) : p.x,
      y: onNorth(p.y) ? roundToPrecision(p.y + dy) : p.y,
    };
  }
  return compensateOpenings(level, { ...level, vertices });
}

/**
 * Refuses to shrink past internal geometry rather than scaling or deleting
 * it, and reports the smallest dimension that would work.
 */
function checkShrink(
  level: Level,
  axis: "x" | "y",
  newLine: number,
  movingThickness: number,
  onMovingLine: (v: number) => boolean,
  movingWallId: Id,
  outsideOrigin: number,
  dimension: "width" | "depth",
): void {
  let required = -Infinity;
  const blockers: Id[] = [];
  for (const wall of Object.values(level.walls)) {
    if (wall.role !== "internal") continue;
    const a = level.vertices[wall.startVertexId];
    const b = level.vertices[wall.endVertexId];
    const parallelToMoving = axis === "x" ? Math.abs(a.x - b.x) <= EPS : Math.abs(a.y - b.y) <= EPS;
    let need = -Infinity;
    if (parallelToMoving) {
      need = a[axis] + (wall.thickness + movingThickness) / 2;
    } else {
      for (const p of [a, b]) {
        if (!onMovingLine(p[axis])) need = Math.max(need, p[axis] + movingThickness / 2);
      }
      // A wall attached to the moving line must keep a usable length.
      const fixedEnd = onMovingLine(a[axis]) ? b : onMovingLine(b[axis]) ? a : null;
      if (fixedEnd) need = Math.max(need, fixedEnd[axis] + LIMITS.minWallLength);
    }
    if (need > newLine + EPS) blockers.push(wall.id);
    required = Math.max(required, need);
  }
  if (blockers.length > 0) {
    const minimum = Math.ceil((required + movingThickness / 2 - outsideOrigin) * 1000 - 1e-6) / 1000;
    fail(
      "shrink-conflict",
      `House ${dimension} can't be reduced below ${formatMetres(minimum)} without first moving internal walls.`,
      [movingWallId, ...blockers],
    );
  }
}
