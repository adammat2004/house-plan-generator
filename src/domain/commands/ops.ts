import { EPS, roundToPrecision } from "../geometry/numeric";
import { dot, pointKey, pointsEqual, sub } from "../geometry/vector";
import { pointAtParam, wallAxis } from "../geometry/walls";
import type { Id, Level, Opening, Point2 } from "../plan/types";
import type { IssueCode, PlanIssue } from "./types";

/** Thrown inside command handlers; converted to a failed CommandResult. */
export class CommandFailure extends Error {
  constructor(readonly issues: PlanIssue[]) {
    super(issues.map((i) => i.message).join(" "));
  }
}

export function fail(code: IssueCode, message: string, entityIds: Id[] = []): never {
  throw new CommandFailure([{ code, message, entityIds }]);
}

export function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("invalid-value", `${label} must be a number.`);
  return value;
}

/** Validates a length and rounds it to the committed edit precision. */
export function requireLength(value: unknown, label: string, min: number, max: number): number {
  const v = roundToPrecision(requireFinite(value, label));
  if (v < min - EPS) fail("invalid-value", `${label} must be at least ${formatLimit(min)}.`);
  if (v > max + EPS) fail("invalid-value", `${label} must be at most ${formatLimit(max)}.`);
  return v;
}

function formatLimit(v: number): string {
  return v < 1 ? `${Math.round(v * 1000)} mm` : `${v} m`;
}

export function findVertexAt(level: Level, p: Point2, exclude?: Id): Id | null {
  const key = pointKey(p);
  for (const [id, v] of Object.entries(level.vertices)) {
    if (id === exclude) continue;
    if (pointKey(v) === key || pointsEqual(v, p)) return id;
  }
  return null;
}

export function removeOrphanVertices(level: Level): Level {
  const used = new Set<Id>();
  for (const w of Object.values(level.walls)) {
    used.add(w.startVertexId);
    used.add(w.endVertexId);
  }
  const ids = Object.keys(level.vertices);
  if (ids.every((id) => used.has(id))) return level;
  const vertices: Level["vertices"] = {};
  for (const id of ids) if (used.has(id)) vertices[id] = level.vertices[id];
  return { ...level, vertices };
}

/**
 * Keeps hosted openings fixed in plan space when their wall's start vertex
 * moves along the wall (e.g. stretching or trimming from the start end).
 * Perpendicular movement of the whole wall carries openings with it.
 */
export function compensateOpenings(previous: Level, next: Level): Level {
  let changed = false;
  const openings: Record<Id, Opening> = {};
  for (const opening of Object.values(next.openings)) {
    openings[opening.id] = opening;
    const before = previous.walls[opening.wallId];
    const after = next.walls[opening.wallId];
    if (!before || !after) continue;
    const prevStart = previous.vertices[before.startVertexId];
    const nextStart = next.vertices[after.startVertexId];
    if (!prevStart || !nextStart || pointsEqual(prevStart, nextStart)) continue;
    const prevAxis = wallAxis(previous, before);
    const nextAxis = wallAxis(next, after);
    if (!prevAxis || !nextAxis || nextAxis.length <= EPS) continue;
    const world = pointAtParam(prevAxis, opening.offset);
    const offset = roundToPrecision(dot(sub(world, nextAxis.start), nextAxis.dir));
    if (Math.abs(offset - opening.offset) > EPS) {
      openings[opening.id] = { ...opening, offset };
      changed = true;
    }
  }
  return changed ? { ...next, openings } : next;
}

export function wallsUsingVertex(level: Level, vertexId: Id): Id[] {
  return Object.values(level.walls)
    .filter((w) => w.startVertexId === vertexId || w.endVertexId === vertexId)
    .map((w) => w.id);
}
