import { analyzeEnvelope, type EnvelopeInfo } from "../../geometry/envelope";
import { EPS, formatMetres, roundToPrecision } from "../../geometry/numeric";
import { LIMITS } from "../../plan/defaults";
import type { Id, Level } from "../../plan/types";
import type { IdSource } from "../ids";
import { compensateOpenings, fail, requireLength } from "../ops";
import { outlineLevel } from "./outline";
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
  return outlineLevel(previous, corners, thickness, height, ids);
}

/**
 * Resizes the house's bounding box keeping its lower-left outside corner
 * fixed. Vertices on the easternmost or northernmost wall line move with it,
 * so attached walls stretch; everything else keeps its coordinates. For a
 * rectangle that is the whole east or north wall; for other shapes, every
 * outline wall on that line.
 */
export function resizeFootprint(level: Level, cmd: ResizeFootprint): Level {
  const env = analyzeEnvelope(level);
  if (!env.ok) fail("envelope-invalid", env.message, env.wallIds);
  const { axisRect: r, outsideRect: o, thickness: t } = env.info;
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
    checkShrink(level, env.info, "x", r.maxX + dx, onEast, o.minX, "width");
  }
  if (dy < -EPS) {
    checkShrink(level, env.info, "y", r.maxY + dy, onNorth, o.minY, "depth");
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
 * it, and reports the smallest dimension that would work. Outline walls
 * block too: a wall running onto the moving line must keep a usable step,
 * and the house must stay wide enough wherever it faces itself.
 */
function checkShrink(
  level: Level,
  env: EnvelopeInfo,
  axis: "x" | "y",
  newLine: number,
  onMovingLine: (v: number) => boolean,
  outsideOrigin: number,
  dimension: "width" | "depth",
): void {
  const movingSide = axis === "x" ? "east" : "north";
  const movingWallId = env.sides[movingSide];
  const movingThickness = env.thickness[movingSide];
  let required = -Infinity;
  const blockers: Id[] = [];
  const outlineBlockers: Id[] = [];
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
  for (const edge of env.edges) {
    const wall = level.walls[edge.wallId];
    const { start, end } = edge.axis;
    const along = axis === "x" ? Math.abs(start.y - end.y) <= EPS : Math.abs(start.x - end.x) <= EPS;
    let need = -Infinity;
    if (along) {
      // Runs onto the moving line: keep a usable step.
      const fixedEnd = onMovingLine(start[axis]) ? end : onMovingLine(end[axis]) ? start : null;
      if (fixedEnd) need = fixedEnd[axis] + LIMITS.minOutlineStep;
    } else if (!onMovingLine(start[axis]) && edge.facing !== movingSide) {
      // Faces back towards the moving line across the house: keep the house wide enough.
      const overlaps = env.edges.some((m) => {
        if (m.facing !== movingSide || !onMovingLine(m.axis.start[axis])) return false;
        const k = axis === "x" ? "y" : "x";
        const lo = Math.max(Math.min(m.axis.start[k], m.axis.end[k]), Math.min(start[k], end[k]));
        const hi = Math.min(Math.max(m.axis.start[k], m.axis.end[k]), Math.max(start[k], end[k]));
        return hi - lo > EPS;
      });
      if (overlaps) need = start[axis] + (wall.thickness + movingThickness) / 2 + LIMITS.minHouseClearSpan;
    }
    if (need > newLine + EPS) outlineBlockers.push(wall.id);
    required = Math.max(required, need);
  }
  if (blockers.length > 0 || outlineBlockers.length > 0) {
    const minimum = Math.ceil((required + movingThickness / 2 - outsideOrigin) * 1000 - 1e-6) / 1000;
    fail(
      "shrink-conflict",
      blockers.length > 0
        ? `House ${dimension} can't be reduced below ${formatMetres(minimum)} without first moving internal walls.`
        : `House ${dimension} can't be reduced below ${formatMetres(minimum)} without changing the house's shape.`,
      [movingWallId, ...blockers, ...outlineBlockers],
    );
  }
}
