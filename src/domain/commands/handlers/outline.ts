import { deriveLevelGeometry } from "../../geometry/derive";
import { analyzeEnvelope } from "../../geometry/envelope";
import { EPS, roundToPrecision } from "../../geometry/numeric";
import { checkOutlineRing, normalizeRing, outsideToAxis, SIDE_NORMAL } from "../../geometry/outline";
import type { Ring } from "../../geometry/polygons";
import { pointsEqual, rectFromPoints, roundPoint } from "../../geometry/vector";
import { axialParam, pointAtParam, pointInAxisInterior, pointOnAxis, wallAxis } from "../../geometry/walls";
import { LIMITS } from "../../plan/defaults";
import type { Id, Level, Point2, Wall } from "../../plan/types";
import { describeEntity } from "../describe";
import type { IdSource } from "../ids";
import { compensateOpenings, fail, removeOrphanVertices, requireFinite, requireLength } from "../ops";
import type { PlanCommand } from "../types";

type CreateOutline = Extract<PlanCommand, { type: "createOutline" }>;

/**
 * A fresh level whose envelope runs through the given wall centrelines,
 * counterclockwise from the canonical corner. Vertex ids are taken first,
 * then wall ids, in ring order.
 */
export function outlineLevel(previous: Level | null, axisRing: Ring, thickness: number, height: number, ids: IdSource): Level {
  const vertexIds = axisRing.map(() => ids.next("v"));
  const wallIds = axisRing.map(() => ids.next("wall"));
  const vertices: Level["vertices"] = {};
  vertexIds.forEach((id, i) => (vertices[id] = axisRing[i]));
  const walls: Record<Id, Wall> = {};
  wallIds.forEach((id, i) => {
    walls[id] = {
      id,
      startVertexId: vertexIds[i],
      endVertexId: vertexIds[(i + 1) % axisRing.length],
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
    furniture: {},
    envelope: { kind: "polygon", wallIds },
    rearWallId: null,
  };
}

/**
 * Builds a new level from an outline drawn on the outside faces, in any
 * orientation and from any corner. The outline's bounding box is moved to
 * the origin and wall centrelines are inset by half the external thickness.
 */
export function createOutline(previous: Level | null, cmd: CreateOutline, ids: IdSource): Level {
  const thickness = requireLength(cmd.externalThickness, "External wall thickness", LIMITS.minWallThickness, LIMITS.maxWallThickness);
  const height = requireLength(cmd.wallHeight, "Wall height", 1, LIMITS.maxWallHeight);
  if (!Array.isArray(cmd.outline) || cmd.outline.length < 4) fail("envelope-invalid", "The house outline needs at least four corners.");
  if (cmd.outline.length > LIMITS.maxOutlineEdges * 4) fail("envelope-invalid", `The house outline can have at most ${LIMITS.maxOutlineEdges} walls.`);
  const points = cmd.outline.map((p, i) => ({ x: requireFinite(p?.x, `Corner ${i + 1} x`), y: requireFinite(p?.y, `Corner ${i + 1} y`) }));
  const outside = normalizeRing(points);
  if (outside.length < 4) fail("envelope-invalid", "The house outline needs at least four corners.");
  const box = rectFromPoints(outside);
  if (box.maxX - box.minX > LIMITS.maxHouseSize + 1e-9) fail("invalid-value", `House width must be at most ${LIMITS.maxHouseSize} m.`);
  if (box.maxY - box.minY > LIMITS.maxHouseSize + 1e-9) fail("invalid-value", `House depth must be at most ${LIMITS.maxHouseSize} m.`);
  const placed = outside.map((p) => ({ x: p.x - box.minX, y: p.y - box.minY }));
  const axis = outsideToAxis(placed, thickness).map((p) => ({ x: roundToPrecision(p.x), y: roundToPrecision(p.y) }));
  const problem = checkOutlineRing(axis, thickness);
  if (problem) fail("envelope-invalid", problem.message);
  return outlineLevel(previous, axis, thickness, height, ids);
}

type MoveOutlineEdge = Extract<PlanCommand, { type: "moveOutlineEdge" }>;

/**
 * Pushes (outward > 0) or pulls (outward < 0) a stretch of an outline wall.
 * The whole wall moves when `from` and `to` are left out; a stretch from a
 * corner cuts a notch or fills one; a stretch in the middle makes a bay or
 * a recess, with a short step wall either side. Internal walls tee'd onto
 * the moving stretch stretch to follow, as with moveWall, and doors and
 * windows stay where they are in plan, or move with the stretch they are on.
 */
export function moveOutlineEdge(level: Level, cmd: MoveOutlineEdge, ids: IdSource): Level {
  const env = analyzeEnvelope(level);
  if (!env.ok) fail("envelope-invalid", env.message, env.wallIds);
  const index = level.envelope.wallIds.indexOf(cmd.wallId);
  if (index < 0) fail("not-found", "Only the house outline's walls can be pushed or pulled.", [cmd.wallId]);
  const wall = level.walls[cmd.wallId];
  const edge = env.info.edges[index];
  const len = edge.axis.length;
  const outward = roundToPrecision(requireFinite(cmd.outward, "Move distance"));
  if (Math.abs(outward) <= EPS) return level;
  const from = roundToPrecision(cmd.from ?? 0);
  const to = roundToPrecision(cmd.to ?? len);
  const step = LIMITS.minOutlineStep;
  if (from < -EPS || to > len + EPS || to - from < step - EPS) fail("invalid-value", `Choose a stretch of wall at least ${step * 1000} mm long.`, [wall.id]);
  if ((from > EPS && from < step - EPS) || (to < len - EPS && to > len - step + EPS)) {
    fail("invalid-value", `Leave at least ${step * 1000} mm of wall beside a step, or start it at the corner.`, [wall.id]);
  }
  const atStart = from <= EPS;
  const atEnd = to >= len - EPS;

  const geometry = deriveLevelGeometry(level);
  const axis = geometry.axes.get(wall.id)!;
  const normal = SIDE_NORMAL[edge.facing];
  const delta = { x: normal.x * outward, y: normal.y * outward };
  const along = (s: number): Point2 => roundPoint(pointAtParam(axis, s));
  const shift = (p: Point2): Point2 => roundPoint({ x: p.x + delta.x, y: p.y + delta.y });
  const label = (id: Id) => describeEntity(level, id);

  // A door or window can't straddle where a step starts.
  for (const o of Object.values(level.openings)) {
    if (o.wallId !== wall.id) continue;
    for (const cut of [atStart ? null : from, atEnd ? null : to]) {
      if (cut !== null && o.offset < cut + wall.thickness / 2 && o.offset + o.width > cut - wall.thickness / 2) {
        fail("opening-crosses-junction", `${label(o.id)} is where the step would start; move it or start the step elsewhere.`, [o.id, wall.id]);
      }
    }
  }

  // What moves: the stretch's corners, internal walls' ends on it, and internal walls running on along its line.
  const moving = new Set<Id>();
  if (atStart) moving.add(wall.startVertexId);
  if (atEnd) moving.add(wall.endVertexId);
  for (const [id, p] of Object.entries(level.vertices)) {
    if (!pointOnAxis(axis, p)) continue;
    const s = axialParam(axis, p);
    if (s > from + EPS && s < to - EPS) moving.add(id);
  }
  const chain = new Set<Id>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const w of Object.values(level.walls)) {
      if (w.role !== "internal" || chain.has(w.id)) continue;
      const a = geometry.axes.get(w.id);
      if (!a || a.orientation !== axis.orientation || !(moving.has(w.startVertexId) || moving.has(w.endVertexId))) continue;
      chain.add(w.id);
      grew = true;
      moving.add(w.startVertexId);
      moving.add(w.endVertexId);
      for (const [id, p] of Object.entries(level.vertices)) if (pointInAxisInterior(a, p)) moving.add(id);
    }
  }

  // Walls running along the stretch between its old and new lines are in the way.
  const lo = Math.min(axis.line, axis.line + (axis.orientation === "horizontal" ? delta.y : delta.x));
  const hi = Math.max(axis.line, axis.line + (axis.orientation === "horizontal" ? delta.y : delta.x));
  const [spanLo, spanHi] = [Math.min(along(from)[axis.orientation === "horizontal" ? "x" : "y"], along(to)[axis.orientation === "horizontal" ? "x" : "y"]), Math.max(along(from)[axis.orientation === "horizontal" ? "x" : "y"], along(to)[axis.orientation === "horizontal" ? "x" : "y"])];
  for (const other of geometry.axes.values()) {
    if (other.wallId === wall.id || chain.has(other.wallId) || other.orientation !== axis.orientation) continue;
    if (other.line <= lo + EPS || other.line >= hi - EPS) continue;
    if (Math.min(other.max, spanHi) - Math.max(other.min, spanLo) > EPS) {
      fail("move-blocked", `${label(other.wallId)} is in the way; walls can't pass through each other.`, [wall.id, other.wallId]);
    }
  }

  const vertices: Level["vertices"] = { ...level.vertices };
  for (const id of moving) vertices[id] = shift(level.vertices[id]);
  const vertexAt = (p: Point2): Id => {
    const existing = Object.entries(vertices).find(([, q]) => pointsEqual(q, p))?.[0];
    if (existing) return existing;
    const id = ids.next("v");
    vertices[id] = p;
    return id;
  };
  const vA = atStart ? null : vertexAt(along(from));
  const vA2 = atStart ? null : vertexAt(shift(along(from)));
  const vB2 = atEnd ? null : vertexAt(shift(along(to)));
  const vB = atEnd ? null : vertexAt(along(to));

  // The pieces in ring order; the longest of the original's pieces keeps its id.
  type Piece = { key: "a" | "stepA" | "s" | "stepB" | "b"; start: Id; end: Id; length: number };
  const pieces: Piece[] = [];
  if (!atStart) pieces.push({ key: "a", start: wall.startVertexId, end: vA!, length: from }, { key: "stepA", start: vA!, end: vA2!, length: Math.abs(outward) });
  pieces.push({ key: "s", start: atStart ? wall.startVertexId : vA2!, end: atEnd ? wall.endVertexId : vB2!, length: to - from });
  if (!atEnd) pieces.push({ key: "stepB", start: vB2!, end: vB!, length: Math.abs(outward) }, { key: "b", start: vB!, end: wall.endVertexId, length: len - to });
  const keeper = pieces.filter((p) => p.key === "a" || p.key === "s" || p.key === "b").reduce((best, p) => (p.length > best.length + EPS ? p : best));
  const idOf = new Map(pieces.map((p) => [p.key, p === keeper ? wall.id : ids.next("wall")]));
  const walls: Record<Id, Wall> = { ...level.walls };
  for (const p of pieces) walls[idOf.get(p.key)!] = { ...wall, id: idOf.get(p.key)!, startVertexId: p.start, endVertexId: p.end };
  const wallIds = [...level.envelope.wallIds];
  wallIds.splice(index, 1, ...pieces.map((p) => idOf.get(p.key)!));
  let next: Level = { ...level, vertices, walls, envelope: { ...level.envelope, wallIds } };

  // Attached walls stretch, but mustn't fold over or shrink to nothing. An outline
  // wall shrinking to exactly nothing is merged away below.
  for (const w of Object.values(level.walls)) {
    if (w.id === wall.id || chain.has(w.id) || !(moving.has(w.startVertexId) || moving.has(w.endVertexId))) continue;
    const before = geometry.axes.get(w.id)!;
    const after = wallAxis(next, next.walls[w.id]);
    if (w.role === "external" && after && after.length <= EPS) continue;
    const flipped = !after || before.dir.x * after.dir.x + before.dir.y * after.dir.y <= 0;
    if (flipped || after!.length < LIMITS.minWallLength - EPS) fail("move-collapses-wall", `Moving this far would collapse ${label(w.id)}.`, [wall.id, w.id]);
  }

  // Openings: those on neighbours keep their place in plan; those on the moved wall go with their piece.
  next = compensateOpenings(level, next);
  const openings = { ...next.openings };
  for (const o of Object.values(level.openings)) {
    if (o.wallId !== wall.id) continue;
    const end = o.offset + o.width;
    const piece = end <= from + EPS ? "a" : o.offset >= from - EPS && end <= to + EPS ? "s" : "b";
    const base = piece === "a" ? 0 : piece === "s" ? from : to;
    openings[o.id] = { ...o, wallId: idOf.get(piece)!, offset: roundToPrecision(o.offset - base) };
  }
  next = { ...next, openings };
  return normalizeOutline(next);
}

/**
 * Tidies the outline after an edit: drops outline walls that shrank to
 * nothing, merges the straight runs either side (the longer keeps its id,
 * and the other's doors and windows move onto it), and starts the ring at
 * its canonical corner.
 */
export function normalizeOutline(level: Level): Level {
  let next = level;
  for (let guard = 0; guard < 128; guard++) {
    const ids = next.envelope.wallIds;
    const n = ids.length;
    const lengthOf = (id: Id) => {
      const w = next.walls[id];
      const a = next.vertices[w.startVertexId];
      const b = next.vertices[w.endVertexId];
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const gone = ids.findIndex((id) => lengthOf(id) <= EPS);
    if (gone >= 0) {
      const id = ids[gone];
      const hosted = Object.values(next.openings).find((o) => o.wallId === id);
      if (hosted) fail("move-collapses-wall", `${describeEntity(next, hosted.id)} is on a wall that would disappear.`, [hosted.id, id]);
      const w = next.walls[id];
      const walls = { ...next.walls };
      delete walls[id];
      // The next wall starts where this one started; anything using the end vertex joins it too.
      for (const other of Object.values(walls)) {
        if (other.startVertexId === w.endVertexId || other.endVertexId === w.endVertexId) {
          walls[other.id] = {
            ...other,
            startVertexId: other.startVertexId === w.endVertexId ? w.startVertexId : other.startVertexId,
            endVertexId: other.endVertexId === w.endVertexId ? w.startVertexId : other.endVertexId,
          };
        }
      }
      next = removeOrphanVertices({ ...next, walls, envelope: { ...next.envelope, wallIds: ids.filter((x) => x !== id) }, rearWallId: next.rearWallId === id ? null : next.rearWallId });
      continue;
    }
    // Merge straight runs left by a removed step.
    let merged = false;
    for (let i = 0; i < n && !merged; i++) {
      const a = next.walls[ids[i]];
      const b = next.walls[ids[(i + 1) % n]];
      const p = next.vertices[a.startVertexId];
      const q = next.vertices[a.endVertexId];
      const r = next.vertices[b.endVertexId];
      const straight = (Math.abs(p.x - q.x) <= EPS && Math.abs(q.x - r.x) <= EPS) || (Math.abs(p.y - q.y) <= EPS && Math.abs(q.y - r.y) <= EPS);
      if (!straight) continue;
      const la = Math.hypot(q.x - p.x, q.y - p.y);
      const lb = Math.hypot(r.x - q.x, r.y - q.y);
      const keepA = la >= lb - EPS;
      const keep = keepA ? a : b;
      const drop = keepA ? b : a;
      const merged_: Wall = { ...keep, startVertexId: a.startVertexId, endVertexId: b.endVertexId };
      const dirX = Math.sign(r.x - p.x);
      const dirY = Math.sign(r.y - p.y);
      const openings = { ...next.openings };
      for (const o of Object.values(next.openings)) {
        if (o.wallId !== keep.id && o.wallId !== drop.id) continue;
        const host = next.walls[o.wallId];
        const s = next.vertices[host.startVertexId];
        const world = { x: s.x + dirX * o.offset, y: s.y + dirY * o.offset };
        openings[o.id] = { ...o, wallId: keep.id, offset: roundToPrecision(Math.abs(world.x - p.x) + Math.abs(world.y - p.y)) };
      }
      const walls = { ...next.walls, [keep.id]: merged_ };
      delete walls[drop.id];
      const wallIds = ids.filter((x) => x !== drop.id);
      next = removeOrphanVertices({ ...next, walls, openings, envelope: { ...next.envelope, wallIds }, rearWallId: next.rearWallId === drop.id ? keep.id : next.rearWallId });
      merged = true;
    }
    if (!merged) break;
  }
  // Start the ring at its canonical corner, as createOutline does.
  const ids = next.envelope.wallIds;
  const ring = ids.map((id) => next.vertices[next.walls[id].startVertexId]);
  const canonical = normalizeRing(ring)[0];
  const start = ring.findIndex((p) => pointsEqual(p, canonical));
  if (start > 0) next = { ...next, envelope: { ...next.envelope, wallIds: [...ids.slice(start), ...ids.slice(0, start)] } };
  if (next.rearWallId && !next.walls[next.rearWallId]) next = { ...next, rearWallId: null };
  return next;
}
