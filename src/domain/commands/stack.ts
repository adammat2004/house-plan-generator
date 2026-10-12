import { deriveLevelGeometry } from "../geometry/derive";
import { analyzeEnvelope } from "../geometry/envelope";
import { EPS, roundToPrecision } from "../geometry/numeric";
import { whereIn, type EnvelopeSide } from "../geometry/outline";
import { difference, interiorPoint, polygonArea, polygonBounds, rectToPolygon, type PolygonWithHoles } from "../geometry/polygons";
import { staircasePlan, staircasesOf, stairSpan, stairsLabel } from "../geometry/stairs";
import type { Rect } from "../geometry/vector";
import { LIMITS } from "../plan/defaults";
import { replaceLevel, stackedElevations, storeyName } from "../plan/levels";
import type { Id, Level, PlanDocument } from "../plan/types";
import { describeEntity } from "./describe";
import { resizeFootprint } from "./handlers/footprint";
import { copyOutline } from "./handlers/levels";
import { moveOutlineEdge } from "./handlers/outline";
import { collectIds, type IdSource } from "./ids";
import { CommandFailure } from "./ops";
import type { PlanCommand, PlanIssue } from "./types";

/**
 * How the floors of a house fit together: each stands on the one below,
 * inside its outline. Edits to one floor's outline carry up to the floors
 * above where they would otherwise overhang.
 */

/** Overhang smaller than this (m²) is float noise. */
const OVERHANG_AREA = 1e-5;
/** How far a floor may sit from where the floors below put it, m. */
const STACK_TOLERANCE = 0.0005;

const floorWord = (index: number) => storeyName(index).toLowerCase();

/** Issues found on a floor other than the one being edited say which floor. */
export const onFloorIssues = (index: number, issues: PlanIssue[]): PlanIssue[] =>
  issues.map((issue) => ({ ...issue, message: `On the ${floorWord(index)}: ${issue.message}` }));

/** Runs an edit to another floor, saying which floor if it fails. */
function onFloor<T>(index: number, edit: () => T): T {
  try {
    return edit();
  } catch (error) {
    if (error instanceof CommandFailure) throw new CommandFailure(onFloorIssues(index, error.issues));
    throw error;
  }
}

const outsidePolygon = (level: Level): PolygonWithHoles | null => {
  const env = analyzeEnvelope(level);
  return env.ok ? { outer: env.info.outsideRing, holes: [] } : null;
};

/** Checks between floors; each floor on its own is checked by validateLevel. */
export function validateStack(doc: PlanDocument): PlanIssue[] {
  if (doc.levels.length > LIMITS.maxLevels) {
    return [{ code: "level-limit", message: `A house can have at most ${LIMITS.maxLevels} floors.`, entityIds: [] }];
  }
  if (doc.levels.length === 1 && !doc.staircases) return [];

  const owner = new Map<string, number>();
  for (const [i, level] of doc.levels.entries()) {
    for (const id of collectIds(level)) {
      const first = owner.get(id);
      if (first !== undefined && first !== i) {
        return [{ code: "invalid-structure", message: `The ${floorWord(first)} and the ${floorWord(i)} both use the id ${id}.`, entityIds: [id] }];
      }
      owner.set(id, i);
    }
  }
  for (const id of Object.keys(doc.staircases ?? {})) {
    if (owner.has(id)) return [{ code: "invalid-structure", message: `The stairs and something on the ${floorWord(owner.get(id)!)} both use the id ${id}.`, entityIds: [id] }];
  }

  const issues: PlanIssue[] = [];
  const elevations = stackedElevations(doc);
  doc.levels.forEach((level, i) => {
    if (i > 0 && Math.abs(level.elevation - elevations[i]) > STACK_TOLERANCE) {
      issues.push({
        code: "level-stack",
        message: `The ${floorWord(i)} should stand ${roundToPrecision(elevations[i])} m up, on the floor below, not ${level.elevation} m.`,
        entityIds: [level.id],
      });
    }
  });

  for (let i = 0; i + 1 < doc.levels.length; i++) {
    const level = doc.levels[i];
    const tall = Object.values(level.walls).find((w) => w.height > level.defaultWallHeight + EPS);
    if (tall) {
      issues.push({
        code: "level-stack",
        message: `${describeEntity(level, tall.id)} on the ${floorWord(i)} can be at most ${level.defaultWallHeight} m tall, the ceiling height, because the ${floorWord(i + 1)} stands on it.`,
        entityIds: [tall.id],
      });
    }
  }

  for (let i = 1; i < doc.levels.length; i++) {
    const upper = outsidePolygon(doc.levels[i]);
    const lower = outsidePolygon(doc.levels[i - 1]);
    if (!upper || !lower) continue;
    const over = difference(upper, [lower]).filter((piece) => polygonArea(piece) > OVERHANG_AREA);
    if (!over.length) continue;
    const biggest = over.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a));
    issues.push({
      code: "level-overhang",
      message: `The ${floorWord(i)} would overhang the ${floorWord(i - 1)} ${whereIn(polygonBounds(lower), interiorPoint(biggest))}.`,
      entityIds: [doc.levels[i].id],
    });
  }
  return [...issues, ...stairIssues(doc)];
}

/** Area (m²) below which stairs only touch something. */
const TOUCH = 1e-6;

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));

/** How much of a rectangle lies outside the floor inside the outline. */
const outside = (r: Rect, inside: PolygonWithHoles) => difference(rectToPolygon(r), [inside]).reduce((sum, p) => sum + polygonArea(p), 0);

/** A wall standing in any of the rectangles. */
function wallIn(level: Level, rects: readonly Rect[]): Id | null {
  for (const footprint of deriveLevelGeometry(level).footprints.values()) {
    if (rects.some((r) => overlap(r, footprint.rect) > TOUCH)) return footprint.wallId;
  }
  return null;
}

/**
 * Stairs fit every floor they serve: inside the house, clear of walls, with
 * floor to step onto at the bottom and off at the top, and clear of other
 * stairs.
 */
function stairIssues(doc: PlanDocument): PlanIssue[] {
  const all = staircasesOf(doc);
  if (!all.length) return [];
  const issues: PlanIssue[] = [];
  const placed: Array<{ id: Id; from: number; to: number; footprint: Rect[] }> = [];
  for (const s of all) {
    const name = all.length > 1 ? stairsLabel(doc, s.id) : "The stairs";
    const lower = all.length > 1 ? name : "the stairs";
    const span = stairSpan(doc, s);
    if (!span) {
      issues.push({ code: "stairs-invalid", message: `${name} don't go up from one floor to another.`, entityIds: [s.id] });
      continue;
    }
    const plan = staircasePlan(doc, s);
    for (let k = span.from; k <= span.to; k++) {
      const level = doc.levels[k];
      const where = `on the ${floorWord(k)}`;
      const env = analyzeEnvelope(level);
      if (!env.ok) continue;
      const inside: PolygonWithHoles = { outer: env.info.insideRing, holes: [] };
      if (plan.footprint.some((r) => outside(r, inside) > TOUCH)) {
        issues.push({ code: "stairs-blocked", message: `${name} would stick out of the house ${where}.`, entityIds: [s.id] });
        break;
      }
      const wall = wallIn(level, plan.footprint);
      if (wall) {
        issues.push({ code: "stairs-blocked", message: `${name} run into ${describeEntity(level, wall)} ${where}.`, entityIds: [s.id, wall] });
        break;
      }
      const blocked = (zone: Rect) => outside(zone, inside) > TOUCH || wallIn(level, [zone]) !== null;
      if (k < span.to && blocked(plan.departure)) {
        issues.push({ code: "stairs-blocked", message: `There's no room to step onto ${lower} ${where}.`, entityIds: [s.id] });
        break;
      }
      if (k > span.from && blocked(plan.arrival)) {
        issues.push({ code: "stairs-blocked", message: `There's no room to step off ${lower} ${where}.`, entityIds: [s.id] });
        break;
      }
    }
    for (const other of placed) {
      if (other.to < span.from || other.from > span.to) continue;
      if (plan.footprint.some((r) => other.footprint.some((o) => overlap(r, o) > TOUCH))) {
        issues.push({ code: "stairs-blocked", message: `${stairsLabel(doc, other.id)} and ${stairsLabel(doc, s.id)} overlap.`, entityIds: [other.id, s.id] });
      }
    }
    placed.push({ id: s.id, ...span, footprint: plan.footprint });
  }
  return issues;
}

/** A straight stretch of an outline wall, in plan coordinates. */
interface Stretch {
  horizontal: boolean;
  /** y for a horizontal stretch, x for a vertical one. */
  line: number;
  lo: number;
  hi: number;
  facing: EnvelopeSide;
}

type MoveOutlineEdge = Extract<PlanCommand, { type: "moveOutlineEdge" }>;

/** The stretch of wall a moveOutlineEdge moves, before it moves. */
function stretchOf(level: Level, cmd: MoveOutlineEdge): Stretch | null {
  const env = analyzeEnvelope(level);
  const edge = env.ok ? env.info.edges.find((e) => e.wallId === cmd.wallId) : undefined;
  if (!edge) return null;
  const { start, end, length } = edge.axis;
  const horizontal = Math.abs(start.y - end.y) <= EPS;
  const at = (s: number) => (horizontal ? start.x + Math.sign(end.x - start.x) * s : start.y + Math.sign(end.y - start.y) * s);
  const a = at(roundToPrecision(cmd.from ?? 0));
  const b = at(roundToPrecision(cmd.to ?? length));
  return { horizontal, line: horizontal ? start.y : start.x, lo: Math.min(a, b), hi: Math.max(a, b), facing: edge.facing };
}

/** Moves every part of this floor's outline lying on the stretch, as the floor below's moved. */
function moveStretch(level: Level, stretch: Stretch, outward: number, ids: IdSource): Level {
  let next = level;
  for (let guard = 0; guard < LIMITS.maxOutlineEdges; guard++) {
    const env = analyzeEnvelope(next);
    if (!env.ok) return next;
    const hit = env.info.edges.find((e) => {
      const { start, end } = e.axis;
      const horizontal = Math.abs(start.y - end.y) <= EPS;
      if (e.facing !== stretch.facing || horizontal !== stretch.horizontal) return false;
      if (Math.abs((horizontal ? start.y : start.x) - stretch.line) > EPS) return false;
      const [s0, s1] = horizontal ? [start.x, end.x] : [start.y, end.y];
      return Math.min(Math.max(s0, s1), stretch.hi) - Math.max(Math.min(s0, s1), stretch.lo) > EPS;
    });
    if (!hit) return next;
    const { start, end, length } = hit.axis;
    const [s0, s1] = stretch.horizontal ? [start.x, end.x] : [start.y, end.y];
    const lo = Math.max(Math.min(s0, s1), stretch.lo);
    const hi = Math.min(Math.max(s0, s1), stretch.hi);
    const from = roundToPrecision(s1 > s0 ? lo - s0 : s0 - hi);
    const to = roundToPrecision(s1 > s0 ? hi - s0 : s0 - lo);
    const whole = from <= EPS && to >= length - EPS;
    next = moveOutlineEdge(next, { type: "moveOutlineEdge", wallId: hit.wallId, outward, ...(whole ? {} : { from, to }) }, ids);
  }
  return next;
}

/**
 * Carries an edit to floor `index` up to the floors above it:
 * - pulling an outline wall in pulls in the walls lying on it above, which
 *   would otherwise overhang; pushing out changes only this floor, which is
 *   how a single-storey extension is made;
 * - resizing the house resizes every floor sitting flush with the moved side;
 * - a floor given a new outline gets the floors above rebuilt as copies of it.
 * `fresh` collects the floors rebuilt from nothing.
 */
export function carryUp(before: PlanDocument, after: PlanDocument, index: number, command: PlanCommand, ids: IdSource, fresh: Set<Id>): PlanDocument {
  let doc = after;
  switch (command.type) {
    case "createFootprint":
    case "createOutline": {
      const source = after.levels[index];
      for (let j = index + 1; j < doc.levels.length; j++) {
        const old = doc.levels[j];
        const base = { id: old.id, name: old.name, elevation: old.elevation, defaultWallHeight: old.defaultWallHeight, floorThickness: old.floorThickness };
        doc = replaceLevel(doc, j, copyOutline(source, base, ids));
        fresh.add(old.id);
      }
      return doc;
    }
    case "moveOutlineEdge": {
      const outward = roundToPrecision(command.outward);
      if (!(outward < 0)) return doc;
      const stretch = stretchOf(before.levels[index], command);
      if (!stretch) return doc;
      for (let j = index + 1; j < doc.levels.length; j++) {
        const level = doc.levels[j];
        const moved = onFloor(j, () => moveStretch(level, stretch, outward, ids));
        if (moved === level) break;
        doc = replaceLevel(doc, j, moved);
      }
      return doc;
    }
    case "resizeFootprint": {
      const was = analyzeEnvelope(before.levels[index]);
      const now = analyzeEnvelope(after.levels[index]);
      if (!was.ok || !now.ok) return doc;
      const dx = now.info.axisRect.maxX - was.info.axisRect.maxX;
      const dy = now.info.axisRect.maxY - was.info.axisRect.maxY;
      for (let j = index + 1; j < doc.levels.length; j++) {
        const level = doc.levels[j];
        const env = analyzeEnvelope(level);
        if (!env.ok) break;
        const { axisRect: r, outsideRect: o } = env.info;
        const width = Math.abs(dx) > EPS && Math.abs(r.maxX - was.info.axisRect.maxX) <= EPS ? roundToPrecision(o.maxX - o.minX + dx) : undefined;
        const depth = Math.abs(dy) > EPS && Math.abs(r.maxY - was.info.axisRect.maxY) <= EPS ? roundToPrecision(o.maxY - o.minY + dy) : undefined;
        if (width === undefined && depth === undefined) break;
        doc = replaceLevel(doc, j, onFloor(j, () => resizeFootprint(level, { type: "resizeFootprint", width, depth })));
      }
      return doc;
    }
    case "setRearWall":
      return matchRearWalls(doc, index);
    default:
      return doc;
  }
}

/** The garden side is one fact about the house: every floor's rear wall faces the way floor `index`'s does. */
export function matchRearWalls(doc: PlanDocument, index: number): PlanDocument {
  const source = doc.levels[index];
  const env = analyzeEnvelope(source);
  const side = source.rearWallId && env.ok ? env.info.sideOfWall[source.rearWallId] : undefined;
  let next = doc;
  doc.levels.forEach((level, j) => {
    if (j === index) return;
    const e = analyzeEnvelope(level);
    const wallId = side && e.ok ? e.info.sides[side] : null;
    if (level.rearWallId !== wallId) next = replaceLevel(next, j, { ...level, rearWallId: wallId });
  });
  return next;
}
