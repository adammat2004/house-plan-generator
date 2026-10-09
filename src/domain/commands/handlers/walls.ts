import { deriveLevelGeometry } from "../../geometry/derive";
import { EPS, roundToPrecision } from "../../geometry/numeric";
import { connectedWallIds } from "../../geometry/topology";
import { pointsEqual, roundPoint } from "../../geometry/vector";
import { classifyOrientation, pointInAxisInterior, wallAxis } from "../../geometry/walls";
import { LIMITS } from "../../plan/defaults";
import type { Id, Level, Opening, Point2, Wall } from "../../plan/types";
import { describeEntity } from "../describe";
import type { IdSource } from "../ids";
import {
  compensateOpenings,
  fail,
  findVertexAt,
  removeOrphanVertices,
  requireFinite,
  requireLength,
  wallsUsingVertex,
} from "../ops";
import type { PlanCommand } from "../types";

type AddWall = Extract<PlanCommand, { type: "addWall" }>;
type MoveWall = Extract<PlanCommand, { type: "moveWall" }>;
type MoveWallEndpoint = Extract<PlanCommand, { type: "moveWallEndpoint" }>;
type UpdateWall = Extract<PlanCommand, { type: "updateWall" }>;

function requireWall(level: Level, wallId: Id): Wall {
  const wall = level.walls[wallId];
  if (!wall) fail("not-found", "That wall no longer exists.", [wallId]);
  return wall;
}

function requireInternal(wall: Wall, action: string): void {
  if (wall.role === "external") {
    fail(
      "envelope-locked",
      `External walls follow the house outline; change the house's size or shape instead of ${action}.`,
      [wall.id],
    );
  }
}

export function addWall(level: Level, cmd: AddWall, ids: IdSource): Level {
  const start = roundPoint({ x: requireFinite(cmd.start?.x, "Start x"), y: requireFinite(cmd.start?.y, "Start y") });
  const end = roundPoint({ x: requireFinite(cmd.end?.x, "End x"), y: requireFinite(cmd.end?.y, "End y") });
  const orientation = classifyOrientation(start, end);
  if (orientation === "degenerate") fail("zero-length-wall", "A wall needs two different end points.");
  if (orientation === "oblique") fail("non-orthogonal-wall", "Walls must be horizontal or vertical.");
  const thickness = requireLength(cmd.thickness, "Wall thickness", LIMITS.minWallThickness, LIMITS.maxWallThickness);
  const height = requireLength(cmd.height ?? level.defaultWallHeight, "Wall height", 1, LIMITS.maxWallHeight);

  let wallId = cmd.wallId;
  if (wallId !== undefined) {
    if (ids.isTaken(wallId)) fail("invalid-value", "A wall with that id already exists.", [wallId]);
    ids.reserve(wallId);
  } else wallId = ids.next("wall");

  const vertices = { ...level.vertices };
  const vertexFor = (p: Point2): Id => {
    const existing = findVertexAt({ ...level, vertices }, p);
    if (existing) return existing;
    const id = ids.next("v");
    vertices[id] = p;
    return id;
  };
  const startVertexId = vertexFor(start);
  const endVertexId = vertexFor(end);
  const wall: Wall = { id: wallId, startVertexId, endVertexId, role: "internal", thickness, height };
  return { ...level, vertices, walls: { ...level.walls, [wallId]: wall } };
}

/**
 * Internal walls continuing this wall's line through shared vertices; they
 * move as one straight wall. The chain stops at outline walls.
 */
function collinearChain(level: Level, wallId: Id): Set<Id> {
  const geometry = deriveLevelGeometry(level);
  const origin = geometry.axes.get(wallId)!;
  const chain = new Set<Id>([wallId]);
  const queue = [wallId];
  while (queue.length) {
    const current = level.walls[queue.pop()!];
    for (const vid of [current.startVertexId, current.endVertexId]) {
      for (const otherId of wallsUsingVertex(level, vid)) {
        if (chain.has(otherId) || level.walls[otherId].role === "external") continue;
        const axis = geometry.axes.get(otherId);
        if (axis && axis.orientation === origin.orientation && Math.abs(axis.line - origin.line) <= EPS) {
          chain.add(otherId);
          queue.push(otherId);
        }
      }
    }
  }
  return chain;
}

/**
 * Slides an internal wall perpendicular to its axis, together with any
 * collinear segments continuing it. Perpendicular walls attached at its ends
 * or along its length stretch or shorten with it. Moves that would break a
 * connection or collapse an attached wall are rejected.
 *
 * An end on a corner of the house outline (a wall running on from an inward
 * corner) leaves the corner on a new vertex, which must land on another wall.
 */
export function moveWall(level: Level, cmd: MoveWall, ids: IdSource): Level {
  const wall = requireWall(level, cmd.wallId);
  requireInternal(wall, "dragging them");
  const delta = roundToPrecision(requireFinite(cmd.delta, "Move distance"));
  if (Math.abs(delta) <= EPS) return level;

  const geometry = deriveLevelGeometry(level);
  const axis = geometry.axes.get(wall.id);
  if (!axis || (axis.orientation !== "horizontal" && axis.orientation !== "vertical")) {
    fail("non-orthogonal-wall", "Only horizontal or vertical walls can be moved.", [wall.id]);
  }
  const horizontal = axis.orientation === "horizontal";
  const shift = (p: Point2): Point2 =>
    horizontal ? { x: p.x, y: roundToPrecision(p.y + delta) } : { x: roundToPrecision(p.x + delta), y: p.y };

  const chain = collinearChain(level, wall.id);
  const chainAxes = [...chain].map((id) => geometry.axes.get(id)!);

  // A sliding wall may not pass through a parallel wall lying across its path.
  const from = axis.line;
  const to = axis.line + delta;
  for (const other of geometry.axes.values()) {
    if (chain.has(other.wallId) || other.orientation !== axis.orientation) continue;
    const between = delta > 0 ? other.line > from + EPS && other.line < to - EPS : other.line < from - EPS && other.line > to + EPS;
    if (!between) continue;
    const overlapsSpan = chainAxes.some((a) => Math.min(a.max, other.max) - Math.max(a.min, other.min) > EPS);
    if (overlapsSpan) {
      fail("move-blocked", `${describeEntity(level, other.wallId)} is in the way; walls can't pass through each other.`, [
        wall.id,
        other.wallId,
      ]);
    }
  }
  const onOutline = (vid: Id) => wallsUsingVertex(level, vid).some((id) => level.walls[id].role === "external");
  const moving = new Set<Id>();
  const detached = new Map<Id, Id>();
  for (const id of chain) {
    for (const vid of [level.walls[id].startVertexId, level.walls[id].endVertexId]) {
      if (!onOutline(vid)) moving.add(vid);
      else if (!detached.has(vid)) detached.set(vid, "");
    }
  }
  for (const [id, p] of Object.entries(level.vertices)) {
    if (moving.has(id) || detached.has(id) || !chainAxes.some((a) => pointInAxisInterior(a, p))) continue;
    if (onOutline(id)) fail("envelope-locked", "This move would reshape an external wall.", [wall.id]);
    moving.add(id);
  }

  const attached = new Set<Id>();
  for (const vid of moving) {
    for (const otherId of wallsUsingVertex(level, vid)) {
      if (chain.has(otherId)) continue;
      if (level.walls[otherId].role === "external") {
        fail("envelope-locked", "This move would reshape an external wall.", [wall.id, otherId]);
      }
      attached.add(otherId);
    }
  }

  const vertices = { ...level.vertices };
  for (const vid of moving) vertices[vid] = shift(level.vertices[vid]);
  // Ends leaving an outline corner get a new vertex; ends landing on one join it.
  const repoint = new Map<Id, Id>();
  for (const vid of detached.keys()) {
    const target = shift(level.vertices[vid]);
    const existing = Object.entries(vertices).find(([id, p]) => !moving.has(id) && pointsEqual(p, target))?.[0];
    const id = existing ?? ids.next("v");
    vertices[id] = target;
    detached.set(vid, id);
  }
  for (const vid of moving) {
    const corner = Object.keys(level.vertices).find((id) => !moving.has(id) && onOutline(id) && pointsEqual(level.vertices[id], vertices[vid]));
    if (!corner) continue;
    repoint.set(vid, corner);
    delete vertices[vid];
  }
  let walls = level.walls;
  const detachedWalls = new Set<Id>();
  if (detached.size || repoint.size) {
    walls = { ...level.walls };
    for (const w of Object.values(level.walls)) {
      const own = chain.has(w.id) ? detached : null;
      const start = repoint.get(w.startVertexId) ?? own?.get(w.startVertexId);
      const end = repoint.get(w.endVertexId) ?? own?.get(w.endVertexId);
      if (!start && !end) continue;
      walls[w.id] = { ...w, startVertexId: start ?? w.startVertexId, endVertexId: end ?? w.endVertexId };
      if (own && (own.has(w.startVertexId) || own.has(w.endVertexId))) detachedWalls.add(w.id);
    }
  }
  const next: Level = { ...level, vertices, walls };

  for (const otherId of attached) {
    const before = geometry.axes.get(otherId)!;
    const after = wallAxis(next, next.walls[otherId]);
    const flipped = !after || after.length <= EPS || before.dir.x * after.dir.x + before.dir.y * after.dir.y <= 0;
    if (flipped || after.length < LIMITS.minWallLength - EPS) {
      fail(
        "move-collapses-wall",
        `Moving this far would collapse ${describeEntity(level, otherId)}.`,
        [wall.id, otherId],
      );
    }
  }

  const compensated = removeOrphanVertices(compensateOpenings(level, next));
  const nextContacts = deriveLevelGeometry(compensated).contacts;
  const lost: Id[] = [];
  for (const id of chain) {
    const after = connectedWallIds(nextContacts, id);
    for (const other of connectedWallIds(geometry.contacts, id)) {
      if (chain.has(other) || after.has(other) || lost.includes(other)) continue;
      // An end that left an outline corner only has to land on some wall.
      if (detachedWalls.has(id) && level.walls[other].role === "external") continue;
      lost.push(other);
    }
  }
  if (lost.length > 0) {
    fail(
      "move-disconnects",
      `Moving this far would disconnect the wall from ${lost.map((id) => describeEntity(level, id)).join(", ")}.`,
      [wall.id, ...lost],
    );
  }
  for (const id of detachedWalls) {
    const w = compensated.walls[id];
    for (const end of ["start", "end"] as const) {
      if (!detached.has(level.walls[id][end === "start" ? "startVertexId" : "endVertexId"])) continue;
      const vid = end === "start" ? w.startVertexId : w.endVertexId;
      const shared = wallsUsingVertex(compensated, vid).length > 1;
      const touching = (nextContacts.get(id) ?? []).some((c) => c.thisEnd === end);
      if (!shared && !touching) {
        fail("move-disconnects", `Moving this far would leave ${describeEntity(level, id)} with a free end.`, [wall.id, id]);
      }
    }
  }
  return compensated;
}

/**
 * Extends or trims an internal wall by moving one end along its axis. An
 * end shared with other walls detaches from them; landing on an existing
 * vertex joins to it.
 */
export function moveWallEndpoint(level: Level, cmd: MoveWallEndpoint, ids: IdSource): Level {
  const wall = requireWall(level, cmd.wallId);
  requireInternal(wall, "editing their ends");
  const axis = wallAxis(level, wall);
  if (!axis || (axis.orientation !== "horizontal" && axis.orientation !== "vertical")) {
    fail("non-orthogonal-wall", "Only horizontal or vertical walls can be edited.", [wall.id]);
  }
  const position = roundToPrecision(requireFinite(cmd.position, "End position"));
  const target: Point2 = axis.orientation === "horizontal" ? { x: position, y: axis.line } : { x: axis.line, y: position };
  const key = cmd.end === "start" ? "startVertexId" : "endVertexId";
  const vertexId = wall[key];
  const current = level.vertices[vertexId];
  if (Math.abs(current.x - target.x) <= EPS && Math.abs(current.y - target.y) <= EPS) return level;

  const vertices = { ...level.vertices };
  let newVertexId = findVertexAt(level, target, vertexId);
  if (!newVertexId) {
    const sharedWith = wallsUsingVertex(level, vertexId).filter((id) => id !== wall.id);
    if (sharedWith.length === 0) {
      newVertexId = vertexId;
      vertices[vertexId] = target;
    } else {
      newVertexId = ids.next("v");
      vertices[newVertexId] = target;
    }
  }
  const updated: Wall = { ...wall, [key]: newVertexId };
  let next: Level = { ...level, vertices, walls: { ...level.walls, [wall.id]: updated } };

  const after = wallAxis(next, updated);
  if (!after || after.length <= EPS || after.dir.x * axis.dir.x + after.dir.y * axis.dir.y <= 0) {
    fail("move-collapses-wall", "A wall end can't be moved past its other end.", [wall.id]);
  }
  next = removeOrphanVertices(next);
  return compensateOpenings(level, next);
}

export function updateWall(level: Level, cmd: UpdateWall): Level {
  const wall = requireWall(level, cmd.wallId);
  let updated = wall;
  if (cmd.thickness !== undefined) {
    if (wall.role === "external") {
      fail("envelope-locked", "External wall thickness is set when the house is created.", [wall.id]);
    }
    const thickness = requireLength(cmd.thickness, "Wall thickness", LIMITS.minWallThickness, LIMITS.maxWallThickness);
    if (thickness !== wall.thickness) updated = { ...updated, thickness };
  }
  if (cmd.height !== undefined) {
    const height = requireLength(cmd.height, "Wall height", 1, LIMITS.maxWallHeight);
    if (height !== wall.height) updated = { ...updated, height };
  }
  if (updated === wall) return level;
  return { ...level, walls: { ...level.walls, [wall.id]: updated } };
}

/** Deletes an internal wall together with its hosted openings. */
export function deleteWall(level: Level, wallId: Id): Level {
  const wall = requireWall(level, wallId);
  if (wall.role === "external") {
    fail("envelope-locked", "External walls can't be deleted; they make up the house outline.", [wall.id]);
  }
  const walls = { ...level.walls };
  delete walls[wall.id];
  const openings: Record<Id, Opening> = {};
  for (const o of Object.values(level.openings)) if (o.wallId !== wall.id) openings[o.id] = o;
  return removeOrphanVertices({ ...level, walls, openings });
}
