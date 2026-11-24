import { applyCommand, type PlanCommand } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { checkOutlineRing, normalizeRing, outsideToAxis } from "@/domain/geometry/outline";
import { deriveLevelGeometry, openingHostInterval, openingHostIntervals, type LevelGeometry } from "@/domain/geometry/derive";
import { EPS, roundToPrecision } from "@/domain/geometry/numeric";
import { axialParam, pointAtParam } from "@/domain/geometry/walls";
import { DEFAULT_HOUSE, LIMITS } from "@/domain/plan/defaults";
import { staircasePlan } from "@/domain/geometry/stairs";
import { groundLevel, levelIndex } from "@/domain/plan/levels";
import { sitePlot } from "@/domain/project/site";
import type { Id, Opening, Point2, Staircase } from "@/domain/plan/types";
import { activeLevelOf, inRefine, type EditorActions, type EditorStores, type Selection, type SnapIndicator } from "../state/stores";
import { newIdPrefix } from "../state/ids";
import { blendViewports, fitRect, panBy, pixelsToMetres, screenToWorld, zoomAt, type Insets, type Viewport } from "../viewport/viewport";
import type { Rect } from "@/domain/geometry/vector";
import { hitOpeningEdge, hitRefine, hitStairs, hitWall, hitWallEnd, roomAt } from "./hitTest";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { furnitureRect } from "@/domain/furniture/geometry";
import { roomEdgeHandles } from "@/domain/design/analysis";
import { hitFurniture, poseIsClear, snapFurniture, type FurniturePose } from "./furnitureSnap";
import { snapPoint } from "./snapping";

/** Screen-space acquisition radius for snapping and picking. */
export const SNAP_RADIUS_PX = 8;
const DRAG_THRESHOLD_PX = 4;
/** Fit's margins when there's no page to measure (tests). */
const DEFAULT_INSETS: Insets = { top: 72, right: 72, bottom: 72, left: 72 };

export interface PointerInput {
  /** Pointer position in CSS pixels relative to the canvas. */
  screen: Point2;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
}

type Gesture =
  | { kind: "pan"; last: Point2 }
  | {
      kind: "pending";
      downScreen: Point2;
      downWorld: Point2;
      target: Selection;
      end: "start" | "end" | null;
      corner?: number;
      alt?: boolean;
      /** Picked, not grabbed: dragging it does nothing. */
      held?: boolean;
      /** A corner of the selected piece of furniture: dragging it resizes the piece. */
      furnitureCorner?: Point2;
    }
  | { kind: "drag-wall"; wallId: Id; horizontal: boolean; line: number; downWorld: Point2; prefix: string }
  | { kind: "drag-end"; wallId: Id; end: "start" | "end"; horizontal: boolean; fixed: Point2; prefix: string }
  | { kind: "drag-opening"; openingId: Id; grab: number; prefix: string }
  | { kind: "drag-opening-edge"; openingId: Id; edge: "start" | "end"; fixed: number; prefix: string }
  | { kind: "drag-furniture"; furnitureId: Id; grab: Point2; rotation: FurniturePose["rotation"]; prefix: string }
  | { kind: "drag-furniture-size"; furnitureId: Id; anchor: Point2; quarter: boolean; prefix: string }
  | { kind: "drag-outline"; wallId: Id; normal: Point2; horizontal: boolean; line: number; downWorld: Point2; from?: number; to?: number; prefix: string }
  | { kind: "drag-corner"; wallId: Id; corner: Point2; dir: Point2; normal: Point2; length: number; prefix: string }
  | { kind: "drag-stairs"; staircaseId: Id; grab: Point2; prefix: string };

/** Width of the bay or recess an Alt-drag on an outside wall makes, m. */
const STEP_WIDTH = 3;

/** The outline corner under the pointer, as an index into the envelope ring. */
function hitOutlineCorner(level: Parameters<typeof analyzeEnvelope>[0], p: Point2, tolerance: number): number | null {
  const env = analyzeEnvelope(level);
  if (!env.ok) return null;
  let best: number | null = null;
  let bestD = tolerance;
  env.info.axisRing.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}

/**
 * Where a dragged opening lands: centred in its stretch of wall, flush with
 * a corner, or on the half-grid, in that order of preference.
 */
export function snapOpeningOffset(
  geometry: LevelGeometry,
  opening: Pick<Opening, "wallId" | "width">,
  raw: number,
  radius: number,
  grid: number | null,
): { offset: number; snap: SnapIndicator | null } {
  const axis = geometry.axes.get(opening.wallId);
  const free = { offset: Math.max(0, grid ? roundToPrecision(Math.round(raw / (grid / 2)) * (grid / 2)) : roundToPrecision(raw)), snap: null };
  if (!axis || grid === null) return free;
  const w = opening.width;
  const centre = raw + w / 2;
  const interval = openingHostIntervals(geometry, opening.wallId).find(([lo, hi]) => centre >= lo - radius && centre <= hi + radius);
  if (!interval) return free;
  const [lo, hi] = interval;
  const mid = (lo + hi) / 2;
  if (hi - lo >= w - EPS) {
    if (Math.abs(centre - mid) <= radius) return { offset: roundToPrecision(mid - w / 2), snap: { point: pointAtParam(axis, mid), kind: "centre" } };
    if (Math.abs(raw - lo) <= radius) return { offset: roundToPrecision(lo), snap: { point: pointAtParam(axis, lo), kind: "endpoint" } };
    if (Math.abs(raw + w - hi) <= radius) return { offset: roundToPrecision(hi - w), snap: { point: pointAtParam(axis, hi), kind: "endpoint" } };
  }
  return free;
}

/**
 * Translates pointer input into previews and commands. Holds only transient
 * gesture state; everything persistent goes through validated commands.
 */
export interface ToolControllerOptions {
  /** Space the floating chrome takes along each canvas edge (see viewport/chrome.ts). */
  insets?: () => Insets;
}

export function createToolController(stores: EditorStores, actions: EditorActions, options: ToolControllerOptions = {}) {
  const { documents, session } = stores;
  const insets = options.insets ?? (() => DEFAULT_INSETS);
  let gesture: Gesture | null = null;
  let chainStart: Point2 | null = null;
  /** Corners of the outline being drawn, on the outside faces. */
  let outlinePoints: Point2[] = [];
  let spaceHeld = false;
  /** Alt (Option) places and drags furniture without snapping. */
  let altHeld = false;

  /** The floor being edited, in the committed plan. */
  const editedLevel = () => activeLevelOf(documents.getState().history.present, session.getState().activeLevelId);
  /** A command checked without committing acts on the floor being edited, as dispatched ones do. */
  const onFloor = <T extends PlanCommand>(command: T): T =>
    documents.getState().history.present.levels.length > 1 ? { ...command, levelId: editedLevel().id } : command;

  const context = () => {
    const level = editedLevel();
    const s = session.getState();
    const radius = pixelsToMetres(s.viewport, SNAP_RADIUS_PX);
    return {
      level,
      geometry: deriveLevelGeometry(level),
      session: s,
      radius,
      grid: s.settings.snapEnabled ? s.settings.gridSize : null,
    };
  };

  const toWorld = (screen: Point2) => screenToWorld(session.getState().viewport, screen);

  const snapTo = (v: number, grid: number | null) => (grid ? roundToPrecision(Math.round(v / grid) * grid) : roundToPrecision(v));

  /** Stairs under the pointer win over the room they stand in. */
  const preferStairs = (hit: Selection, world: Point2): Selection => {
    if (hit && hit.kind !== "room") return hit;
    const id = hitStairs(documents.getState().history.present, editedLevel().id, world);
    return id ? { kind: "stairs", id } : hit;
  };

  /** Where stairs land: a side pulled flush against a wall face within reach, else the foot on the grid. */
  function snapStairsFoot(s: Staircase, foot: Point2): Point2 {
    const { level, radius, grid } = context();
    const b = staircasePlan(documents.getState().history.present, { ...s, foot: { x: 0, y: 0 } }).bounds;
    const at = { minX: b.minX + foot.x, maxX: b.maxX + foot.x, minY: b.minY + foot.y, maxY: b.maxY + foot.y };
    let dx: number | null = null;
    let dy: number | null = null;
    // Stairs settle against a wall from a little further away than points snap.
    let bestX = radius * 3;
    let bestY = radius * 3;
    for (const { rect: r } of deriveLevelGeometry(level).footprints.values()) {
      if (Math.min(at.maxY, r.maxY) - Math.max(at.minY, r.minY) > 0) {
        for (const d of [r.maxX - at.minX, r.minX - at.maxX]) if (Math.abs(d) < bestX) [bestX, dx] = [Math.abs(d), d];
      }
      if (Math.min(at.maxX, r.maxX) - Math.max(at.minX, r.minX) > 0) {
        for (const d of [r.maxY - at.minY, r.minY - at.maxY]) if (Math.abs(d) < bestY) [bestY, dy] = [Math.abs(d), d];
      }
    }
    return { x: dx !== null ? roundToPrecision(foot.x + dx) : snapTo(foot.x, grid), y: dy !== null ? roundToPrecision(foot.y + dy) : snapTo(foot.y, grid) };
  }

  /** A guide along a wall's new line, across the whole floor. */
  const guideAcross = (horizontal: boolean, at: number) => {
    const env = analyzeEnvelope(editedLevel());
    const r = env.ok ? env.info.outsideRect : { minX: at - 10, minY: at - 10, maxX: at + 10, maxY: at + 10 };
    const reach = 1;
    return horizontal ? { a: { x: r.minX - reach, y: at }, b: { x: r.maxX + reach, y: at } } : { a: { x: at, y: r.minY - reach }, b: { x: at, y: r.maxY + reach } };
  };

  // ── Gliding view ───────────────────────────────────────────────────────
  // Zoom and fit from buttons and keys move the view over 200 ms (DESIGN.md: motion only where it shows
  // where you've gone). Reduced motion, and any touch of the plan, makes it jump straight there.
  let glide: number | null = null;
  const stopGlide = () => {
    if (glide !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(glide);
    glide = null;
  };
  const glideTo = (target: Viewport, animate: boolean) => {
    stopGlide();
    const reduced = typeof window === "undefined" || typeof requestAnimationFrame !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduced) {
      session.setState({ viewport: target });
      return;
    }
    const from = session.getState().viewport;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 200);
      const eased = 1 - Math.pow(1 - t, 3);
      // The view may have been resized meanwhile: blend towards the target at the current size.
      const size = session.getState().viewport;
      session.setState({ viewport: t < 1 ? blendViewports({ ...from, width: size.width, height: size.height }, { ...target, width: size.width, height: size.height }, eased) : target });
      glide = t < 1 ? requestAnimationFrame(step) : null;
    };
    glide = requestAnimationFrame(step);
  };

  // ── Select tool ────────────────────────────────────────────────────────
  /**
   * What Select picks under the pointer in Refine. Walls and doors are picked
   * on their own width plus a little, so a click just inside a room picks the
   * room; furniture only when it's on show.
   */
  function refineHit(world: Point2): Selection {
    const { level, geometry, session: s, radius } = context();
    const furnitureId = s.view === "furnished" ? hitFurniture(level, world, radius * 0.5) : null;
    return preferStairs(hitRefine(level, geometry, world, radius * 0.5, furnitureId), world);
  }

  function selectDown(input: PointerInput) {
    const { level, geometry, session: s, radius } = context();
    const world = toWorld(input.screen);
    if (!inRefine(s)) {
      // Outside Refine the plan is for looking at: clicks pick rooms, drags pan.
      const roomId = roomAt(level, geometry, world);
      const target: Selection = roomId ? { kind: "room", id: roomId } : null;
      actions.select(target);
      gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target, end: null };
      return;
    }
    const selected = s.selection;
    // A picked room's edge grips move its walls; the room stays picked, so its sizes show as they change.
    if (selected?.kind === "room" && level.rooms[selected.id]) {
      const grip = roomEdgeHandles(level, selected.id).find((h) => Math.hypot(h.point.x - world.x, h.point.y - world.y) <= radius * 1.6);
      if (grip) {
        gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target: { kind: "wall", id: grip.wallId }, end: null };
        return;
      }
    }
    // A picked piece of furniture resizes from its corners.
    if (selected?.kind === "furniture" && level.furniture[selected.id] && s.view === "furnished") {
      const r = furnitureRect(level.furniture[selected.id]);
      const corners = [
        { x: r.minX, y: r.minY },
        { x: r.maxX, y: r.minY },
        { x: r.maxX, y: r.maxY },
        { x: r.minX, y: r.maxY },
      ];
      const i = corners.findIndex((c) => Math.hypot(c.x - world.x, c.y - world.y) <= radius * 1.4);
      if (i >= 0) {
        gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target: selected, end: null, furnitureCorner: corners[(i + 2) % 4] };
        return;
      }
    }
    if (selected?.kind === "opening" && level.openings[selected.id]) {
      const edge = hitOpeningEdge(level, geometry, selected.id, world, radius);
      if (edge) {
        gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target: selected, end: edge };
        return;
      }
    }
    // The outline's corners can be dragged once the house or one of its outside walls is selected.
    const outlineSelected = selected?.kind === "house" || (selected?.kind === "wall" && level.walls[selected.id]?.role === "external");
    if (outlineSelected) {
      const corner = hitOutlineCorner(level, world, radius * 1.25);
      if (corner !== null) {
        gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target: selected, end: null, corner };
        return;
      }
    }
    if (selected?.kind === "wall" && level.walls[selected.id]?.role === "internal") {
      const end = hitWallEnd(geometry, selected.id, world, radius * 1.25);
      if (end) {
        gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target: selected, end };
        return;
      }
    }
    const target = refineHit(world);
    // An outside wall moves the whole side of the house, so it drags only once it's selected (or with Alt, for a bay).
    const held = target?.kind === "wall" && level.walls[target.id]?.role === "external" && !input.altKey && !(selected?.kind === "wall" && selected.id === target.id);
    actions.select(target);
    gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target, end: null, alt: input.altKey, held };
  }

  function startDrag(pending: Extract<Gesture, { kind: "pending" }>) {
    const { level, geometry } = context();
    const target = pending.target;
    if (pending.held) return null;
    if (pending.furnitureCorner && target?.kind === "furniture") {
      const item = level.furniture[target.id];
      if (!item) return null;
      return { kind: "drag-furniture-size" as const, furnitureId: item.id, anchor: pending.furnitureCorner, quarter: item.rotation === 90 || item.rotation === 270, prefix: newIdPrefix() };
    }
    if (pending.corner !== undefined) {
      // A corner drags the start of the wall leaving it: pulled in it cuts a notch, pushed out it fills one.
      const env = analyzeEnvelope(level);
      if (!env.ok) return null;
      const edge = env.info.edges[pending.corner];
      const { start, end, length } = edge.axis;
      const dir = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      const normal = edge.facing === "north" ? { x: 0, y: 1 } : edge.facing === "south" ? { x: 0, y: -1 } : edge.facing === "east" ? { x: 1, y: 0 } : { x: -1, y: 0 };
      return { kind: "drag-corner" as const, wallId: edge.wallId, corner: start, dir, normal, length, prefix: newIdPrefix() };
    }
    if (!target) return null;
    if (target.kind === "wall" && level.walls[target.id]?.role === "external") {
      const env = analyzeEnvelope(level);
      const edge = env.ok ? env.info.edges.find((e) => e.wallId === target.id) : undefined;
      const axis = geometry.axes.get(target.id);
      if (!edge || !axis) return null;
      const normal = edge.facing === "north" ? { x: 0, y: 1 } : edge.facing === "south" ? { x: 0, y: -1 } : edge.facing === "east" ? { x: 1, y: 0 } : { x: -1, y: 0 };
      let range: { from?: number; to?: number } = {};
      if (pending.alt) {
        // A bay or recess centred on where the wall was grabbed, kept clear of the corners or reaching them.
        const step = LIMITS.minOutlineStep;
        const s = axialParam(axis, pending.downWorld);
        let from = roundToPrecision(Math.max(0, s - STEP_WIDTH / 2));
        let to = roundToPrecision(Math.min(axis.length, from + STEP_WIDTH));
        from = roundToPrecision(Math.max(0, to - STEP_WIDTH));
        if (from < step) from = 0;
        if (axis.length - to < step) to = axis.length;
        if (to - from < axis.length - EPS) range = { from, to };
      }
      return { kind: "drag-outline" as const, wallId: target.id, normal, horizontal: axis.orientation === "horizontal", line: axis.line, downWorld: pending.downWorld, ...range, prefix: newIdPrefix() };
    }
    if (target.kind === "wall") {
      const wall = level.walls[target.id];
      const axis = geometry.axes.get(target.id);
      if (!wall || !axis || wall.role !== "internal") return null;
      const horizontal = axis.orientation === "horizontal";
      if (pending.end) {
        return {
          kind: "drag-end" as const,
          wallId: wall.id,
          end: pending.end,
          horizontal,
          fixed: pending.end === "start" ? axis.end : axis.start,
          prefix: newIdPrefix(),
        };
      }
      return { kind: "drag-wall" as const, wallId: wall.id, horizontal, line: axis.line, downWorld: pending.downWorld, prefix: newIdPrefix() };
    }
    if (target.kind === "stairs") {
      const s = documents.getState().history.present.staircases?.[target.id];
      if (!s) return null;
      return { kind: "drag-stairs" as const, staircaseId: s.id, grab: { x: pending.downWorld.x - s.foot.x, y: pending.downWorld.y - s.foot.y }, prefix: newIdPrefix() };
    }
    if (target.kind === "furniture") {
      const item = level.furniture[target.id];
      if (!item) return null;
      return {
        kind: "drag-furniture" as const,
        furnitureId: item.id,
        grab: { x: pending.downWorld.x - item.position.x, y: pending.downWorld.y - item.position.y },
        rotation: item.rotation,
        prefix: newIdPrefix(),
      };
    }
    if (target.kind === "opening") {
      const opening = level.openings[target.id];
      const axis = opening && geometry.axes.get(opening.wallId);
      if (!opening || !axis) return null;
      if (pending.end) {
        return {
          kind: "drag-opening-edge" as const,
          openingId: opening.id,
          edge: pending.end,
          fixed: pending.end === "start" ? opening.offset + opening.width : opening.offset,
          prefix: newIdPrefix(),
        };
      }
      return {
        kind: "drag-opening" as const,
        openingId: opening.id,
        grab: axialParam(axis, pending.downWorld) - opening.offset,
        prefix: newIdPrefix(),
      };
    }
    return null;
  }

  function dragMove(world: Point2) {
    const { level, geometry, radius, grid } = context();
    if (!gesture) return;
    if (gesture.kind === "drag-wall") {
      const raw = gesture.line + (gesture.horizontal ? world.y - gesture.downWorld.y : world.x - gesture.downWorld.x);
      // Align with existing vertices first, then the grid.
      let target = snapTo(raw, grid);
      let kind: "endpoint" | "grid" | "free" = grid ? "grid" : "free";
      let bestD = radius;
      const wall = level.walls[gesture.wallId];
      for (const [vid, p] of Object.entries(level.vertices)) {
        if (vid === wall.startVertexId || vid === wall.endVertexId) continue;
        const v = gesture.horizontal ? p.y : p.x;
        if (Math.abs(v - raw) < bestD) {
          bestD = Math.abs(v - raw);
          target = v;
          kind = "endpoint";
        }
      }
      const axis = geometry.axes.get(gesture.wallId)!;
      const mid = { x: (axis.start.x + axis.end.x) / 2, y: (axis.start.y + axis.end.y) / 2 };
      session.setState({
        snap: { point: gesture.horizontal ? { x: mid.x, y: target } : { x: target, y: mid.y }, kind },
        guides: kind === "endpoint" ? [guideAcross(gesture.horizontal, target)] : [],
      });
      actions.preview({ type: "moveWall", wallId: gesture.wallId, delta: roundToPrecision(target - gesture.line), idPrefix: gesture.prefix });
    } else if (gesture.kind === "drag-end") {
      const snapped = snapPoint(level, geometry, world, {
        radius,
        grid,
        from: gesture.fixed,
        lock: gesture.horizontal ? "horizontal" : "vertical",
      });
      session.setState({ snap: { point: snapped.point, kind: snapped.kind } });
      actions.preview({
        type: "moveWallEndpoint",
        wallId: gesture.wallId,
        end: gesture.end,
        position: gesture.horizontal ? snapped.point.x : snapped.point.y,
        idPrefix: gesture.prefix,
      });
    } else if (gesture.kind === "drag-opening") {
      const opening = level.openings[gesture.openingId];
      const axis = opening && geometry.axes.get(opening.wallId);
      if (!opening || !axis) return;
      const placed = snapOpeningOffset(geometry, opening, axialParam(axis, world) - gesture.grab, radius, grid);
      session.setState({ snap: placed.snap });
      actions.preview({ type: "updateOpening", openingId: opening.id, changes: { offset: placed.offset }, idPrefix: gesture.prefix });
    } else if (gesture.kind === "drag-furniture-size") {
      const item = level.furniture[gesture.furnitureId];
      if (!item) return;
      // The opposite corner stays put; sizes land on 10 mm (or the grid, when snapping), never under 200 mm.
      const step = grid ? Math.min(grid, 0.05) : 0.01;
      const min = 0.2;
      const along = (v: number, a: number) => Math.sign(v - a || 1) * Math.max(min, snapTo(Math.abs(v - a), step));
      const dx = along(world.x, gesture.anchor.x);
      const dy = along(world.y, gesture.anchor.y);
      const w = Math.abs(dx);
      const d = Math.abs(dy);
      const position = { x: roundToPrecision(gesture.anchor.x + dx / 2), y: roundToPrecision(gesture.anchor.y + dy / 2) };
      session.setState({ snap: null });
      actions.preview({
        type: "updateFurniture",
        furnitureId: item.id,
        changes: { position, width: roundToPrecision(gesture.quarter ? d : w), depth: roundToPrecision(gesture.quarter ? w : d) },
        idPrefix: gesture.prefix,
      });
    } else if (gesture.kind === "drag-stairs") {
      const s = documents.getState().history.present.staircases?.[gesture.staircaseId];
      if (!s) return;
      const foot = snapStairsFoot(s, { x: world.x - gesture.grab.x, y: world.y - gesture.grab.y });
      actions.preview({ type: "updateStairs", staircaseId: s.id, changes: { foot }, idPrefix: gesture.prefix });
    } else if (gesture.kind === "drag-furniture") {
      const item = level.furniture[gesture.furnitureId];
      if (!item) return;
      const raw = { ...item, rotation: gesture.rotation, position: { x: world.x - gesture.grab.x, y: world.y - gesture.grab.y } };
      const placed = snapFurniture(level, raw, { radius, grid: altHeld ? null : grid });
      session.setState({ snap: placed.snap });
      actions.preview({ type: "updateFurniture", furnitureId: item.id, changes: { position: placed.pose.position, rotation: placed.pose.rotation }, idPrefix: gesture.prefix });
    } else if (gesture.kind === "drag-outline") {
      // Out along the wall's normal; the new line snaps to other corners and walls, then the grid.
      const sign = gesture.horizontal ? gesture.normal.y : gesture.normal.x;
      const raw = gesture.line + (gesture.horizontal ? world.y - gesture.downWorld.y : world.x - gesture.downWorld.x);
      // The outside face lands on the grid, so outside dimensions stay round.
      const face = (level.walls[gesture.wallId]?.thickness ?? 0) / 2;
      let target = roundToPrecision(snapTo(raw + sign * face, grid) - sign * face);
      let kind: "endpoint" | "grid" | "free" = grid ? "grid" : "free";
      let bestD = radius;
      for (const p of Object.values(level.vertices)) {
        const v = gesture.horizontal ? p.y : p.x;
        if (Math.abs(v - gesture.line) < EPS) continue;
        if (Math.abs(v - raw) < bestD) [bestD, target, kind] = [Math.abs(v - raw), v, "endpoint"];
      }
      const axis = geometry.axes.get(gesture.wallId);
      if (axis) {
        const mid = pointAtParam(axis, ((gesture.from ?? 0) + (gesture.to ?? axis.length)) / 2);
        session.setState({ snap: { point: gesture.horizontal ? { x: mid.x, y: target } : { x: target, y: mid.y }, kind }, guides: kind === "endpoint" ? [guideAcross(gesture.horizontal, target)] : [] });
      }
      const outward = roundToPrecision((target - gesture.line) * sign);
      actions.preview({ type: "moveOutlineEdge", wallId: gesture.wallId, outward, ...(gesture.from !== undefined ? { from: gesture.from, to: gesture.to } : {}), idPrefix: gesture.prefix });
    } else if (gesture.kind === "drag-corner") {
      const v = { x: world.x - gesture.corner.x, y: world.y - gesture.corner.y };
      const step = LIMITS.minOutlineStep;
      const along = snapTo(v.x * gesture.dir.x + v.y * gesture.dir.y, grid);
      const outward = snapTo(v.x * gesture.normal.x + v.y * gesture.normal.y, grid);
      const to = Math.min(Math.max(along, step), gesture.length);
      const whole = gesture.length - to < step;
      session.setState({ snap: { point: { x: gesture.corner.x + gesture.dir.x * to + gesture.normal.x * outward, y: gesture.corner.y + gesture.dir.y * to + gesture.normal.y * outward }, kind: grid ? "grid" : "free" } });
      actions.preview({ type: "moveOutlineEdge", wallId: gesture.wallId, outward, ...(whole ? {} : { from: 0, to: roundToPrecision(to) }), idPrefix: gesture.prefix });
    } else if (gesture.kind === "drag-opening-edge") {
      const opening = level.openings[gesture.openingId];
      const axis = opening && geometry.axes.get(opening.wallId);
      if (!opening || !axis) return;
      const raw = axialParam(axis, world);
      let s = snapTo(raw, grid ? grid / 2 : null);
      let snap: SnapIndicator | null = null;
      const interval = grid ? openingHostInterval(geometry, opening) : null;
      for (const end of interval ?? []) {
        if (Math.abs(raw - end) <= radius) {
          s = roundToPrecision(end);
          snap = { point: pointAtParam(axis, end), kind: "endpoint" };
        }
      }
      const min = LIMITS.minOpeningWidth;
      const offset = gesture.edge === "start" ? roundToPrecision(Math.max(0, Math.min(s, gesture.fixed - min))) : gesture.fixed;
      const width = gesture.edge === "start" ? roundToPrecision(gesture.fixed - offset) : roundToPrecision(Math.max(min, s - gesture.fixed));
      session.setState({ snap });
      actions.preview({ type: "updateOpening", openingId: opening.id, changes: { offset, width }, idPrefix: gesture.prefix });
    }
  }

  // ── Outline tool ───────────────────────────────────────────────────────
  /** Grid, the draft's own corners, and straight across or up from the last corner. */
  function outlineSnap(world: Point2): Point2 {
    const { radius, grid } = context();
    let p = { x: snapTo(world.x, grid), y: snapTo(world.y, grid) };
    for (const q of outlinePoints) {
      if (Math.abs(q.x - world.x) <= radius) p = { ...p, x: q.x };
      if (Math.abs(q.y - world.y) <= radius) p = { ...p, y: q.y };
    }
    const last = outlinePoints[outlinePoints.length - 1];
    if (last) p = Math.abs(world.x - last.x) >= Math.abs(world.y - last.y) ? { x: p.x, y: last.y } : { x: last.x, y: p.y };
    return { x: roundToPrecision(p.x), y: roundToPrecision(p.y) };
  }

  const outsideThickness = () => {
    const env = analyzeEnvelope(editedLevel());
    return env.ok ? env.info.externalThickness : DEFAULT_HOUSE.externalThickness;
  };

  /** Why this ring of outside corners wouldn't make a house, or null. */
  function outlineProblem(ring: Point2[]): string | null {
    // A wall running back over the one before it would be tidied away silently, so refuse it.
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [a, b, c] = [ring[(i - 1 + n) % n], ring[i], ring[(i + 1) % n]];
      const back = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < -EPS && Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) <= EPS;
      if (back) return "The outline doubles back on itself; each wall must turn a corner.";
    }
    const outside = normalizeRing(ring);
    if (outside.length < 4) return "An outline needs at least four corners.";
    const t = outsideThickness();
    const axis = outsideToAxis(outside, t).map((p) => ({ x: roundToPrecision(p.x), y: roundToPrecision(p.y) }));
    return checkOutlineRing(axis, t)?.message ?? null;
  }

  /** The draft closed back to its first corner, with one more corner if the last isn't in line with the first. */
  function closedOutline(points: Point2[]): Point2[] | null {
    if (points.length < 3) return null;
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) <= EPS || Math.abs(first.y - last.y) <= EPS) return points;
    const options = [{ x: last.x, y: first.y }, { x: first.x, y: last.y }].map((corner) => [...points, corner]);
    return options.find((ring) => !outlineProblem(ring)) ?? options[0];
  }

  function showOutline(cursor: Point2 | null) {
    if (!outlinePoints.length) {
      session.setState({ outlineDraft: null });
      return;
    }
    const ring = closedOutline(cursor ? [...outlinePoints, cursor] : outlinePoints);
    session.setState({ outlineDraft: { points: outlinePoints, cursor, problem: ring ? outlineProblem(ring) : null } });
  }

  function outlineMove(world: Point2) {
    const p = outlineSnap(world);
    session.setState({ snap: { point: p, kind: context().grid ? "grid" : "free" } });
    showOutline(p);
  }

  function outlineDown(world: Point2) {
    const { radius } = context();
    const p = outlineSnap(world);
    const first = outlinePoints[0];
    if (first && outlinePoints.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= radius * 1.5) {
      finishOutline();
      return;
    }
    const last = outlinePoints[outlinePoints.length - 1];
    if (last && Math.abs(last.x - p.x) <= EPS && Math.abs(last.y - p.y) <= EPS) return;
    outlinePoints = [...outlinePoints, p];
    showOutline(p);
  }

  /** Builds the drawn outline as the house, asking first when it would replace rooms. */
  function finishOutline() {
    const ring = closedOutline(outlinePoints);
    if (!ring) {
      actions.notify("info", "Click at least three corners, then the first corner again or Enter to finish.");
      return;
    }
    const problem = outlineProblem(ring);
    if (problem) {
      actions.notify("error", problem);
      return;
    }
    outlinePoints = [];
    session.setState({ outlineDraft: null, snap: null });
    const level = editedLevel();
    const furnished = Object.values(level.walls).some((w) => w.role === "internal") || Object.keys(level.openings).length > 0 || Object.keys(level.furniture).length > 0;
    if (furnished) session.setState({ outlineConfirm: { outline: ring } });
    else replaceOutline(ring);
  }

  function replaceOutline(outline: Point2[]) {
    const level = editedLevel();
    const result = actions.dispatch({ type: "createOutline", outline, externalThickness: outsideThickness(), wallHeight: level.defaultWallHeight, idPrefix: newIdPrefix() });
    session.setState({ outlineConfirm: null });
    if (!result.ok) return;
    actions.setTool("select");
    actions.select(null);
  }

  // ── Wall tool ──────────────────────────────────────────────────────────
  function wallMove(world: Point2) {
    const { level, geometry, radius, grid, session: s } = context();
    const snapped = snapPoint(level, geometry, world, { radius, grid, from: chainStart ?? undefined });
    session.setState({ snap: { point: snapped.point, kind: snapped.kind } });
    if (!chainStart) {
      session.setState({ wallDraft: null });
      return;
    }
    const result = applyCommand(
      documents.getState().history.present,
      onFloor({ type: "addWall", start: chainStart, end: snapped.point, thickness: s.settings.internalThickness, idPrefix: "draft" }),
    );
    session.setState({
      wallDraft: { start: chainStart, end: snapped.point, valid: result.ok },
    });
  }

  function wallDown(world: Point2) {
    const { level, geometry, radius, grid, session: s } = context();
    const snapped = snapPoint(level, geometry, world, { radius, grid, from: chainStart ?? undefined });
    if (!chainStart) {
      chainStart = snapped.point;
      session.setState({ wallDraft: { start: chainStart, end: chainStart, valid: false } });
      return;
    }
    if (Math.abs(snapped.point.x - chainStart.x) <= EPS && Math.abs(snapped.point.y - chainStart.y) <= EPS) return;
    const result = actions.dispatch({
      type: "addWall",
      start: chainStart,
      end: snapped.point,
      thickness: s.settings.internalThickness,
    });
    if (result.ok) {
      const wallId = result.createdIds.find((id) => result.document.levels.some((l) => l.walls[id]));
      if (wallId) actions.select({ kind: "wall", id: wallId });
      chainStart = snapped.point;
      session.setState({ wallDraft: { start: chainStart, end: chainStart, valid: false } });
    }
  }

  // ── Door / window tools ────────────────────────────────────────────────
  function buildOpening(world: Point2, kind: "door" | "window", id: Id): { opening: Opening; message: string | null } | null {
    const { geometry, radius, grid, session: s } = context();
    const wallId = hitWall(geometry, world, radius);
    if (!wallId) return null;
    const axis = geometry.axes.get(wallId)!;
    const preset = kind === "door" ? s.settings.door : s.settings.window;
    const width = Math.min(preset.width, Math.max(0.2, axis.length - 0.1));
    const centre = axialParam(axis, world);
    let offset = snapTo(centre - width / 2, grid ? grid / 2 : null);
    // Nudge into the host interval under the cursor, if the preset fits there.
    const interval = openingHostIntervals(geometry, wallId).find(([lo, hi]) => centre >= lo - radius && centre <= hi + radius);
    if (interval && interval[1] - interval[0] >= width - EPS) {
      offset = Math.min(Math.max(offset, interval[0]), interval[1] - width);
      offset = roundToPrecision(offset);
    }
    offset = Math.max(0, offset);
    const opening: Opening =
      kind === "door"
        ? { id, wallId, kind, offset, width, height: s.settings.door.height, hinge: "start", swingSide: "left" }
        : { id, wallId, kind, offset, width, height: s.settings.window.height, sillHeight: s.settings.window.sillHeight };
    const result = applyCommand(documents.getState().history.present, { type: "addOpening", opening });
    return { opening, message: result.ok ? null : result.issues[0]?.message ?? "Can't place here." };
  }

  function openingMove(world: Point2, kind: "door" | "window") {
    const built = buildOpening(world, kind, "draft-opening");
    if (!built) {
      session.setState({ openingDraft: null, snap: null });
      return;
    }
    session.setState({
      openingDraft: {
        wallId: built.opening.wallId,
        kind,
        offset: built.opening.offset,
        width: built.opening.width,
        valid: built.message === null,
        message: built.message,
      },
      snap: null,
    });
  }

  function openingDown(world: Point2, kind: "door" | "window") {
    const id = `${newIdPrefix()}-${kind}`;
    const built = buildOpening(world, kind, id);
    if (!built) {
      actions.notify("info", `Click on a wall to place a ${kind}.`);
      return;
    }
    const result = actions.dispatch({ type: "addOpening", opening: built.opening });
    if (result.ok) actions.select({ kind: "opening", id });
  }

  // ── Furniture tool ─────────────────────────────────────────────────────
  /** The piece the tool would place with its centre at the pointer, settled against a wall when close. */
  function furnitureAt(world: Point2) {
    const { level, radius, grid, session: s } = context();
    const { kind, rotation } = s.settings.furniture;
    const spec = FURNITURE_CATALOG[kind];
    return snapFurniture(level, { kind, position: world, rotation, width: spec.width, depth: spec.depth }, { radius, grid: altHeld ? null : grid });
  }

  function furnitureMove(world: Point2) {
    const { level } = context();
    const placed = furnitureAt(world);
    session.setState({
      furnitureDraft: { item: { ...placed.pose, height: FURNITURE_CATALOG[placed.pose.kind].height }, clear: poseIsClear(level, placed.pose) },
      snap: placed.snap,
    });
  }

  function furnitureDown(world: Point2) {
    const { level } = context();
    const { pose } = furnitureAt(world);
    if (!roomAt(level, deriveLevelGeometry(level), pose.position)) {
      actions.notify("info", "Place furniture inside a room.");
      return;
    }
    const id = `${newIdPrefix()}-furniture`;
    const result = actions.dispatch({ type: "addFurniture", item: { ...pose, id, height: FURNITURE_CATALOG[pose.kind].height } });
    if (result.ok) actions.select({ kind: "furniture", id });
  }

  // ── Stairs tool ────────────────────────────────────────────────────────
  /** Stairs from the floor on show up to the next (from the top floor, up from the one below), centred on the pointer. */
  function stairsAt(world: Point2, id = "draft-stairs"): Staircase | null {
    const doc = documents.getState().history.present;
    if (doc.levels.length < 2) return null;
    const i = levelIndex(doc, editedLevel().id);
    const [from, to] = i + 1 < doc.levels.length ? [i, i + 1] : [i - 1, i];
    const st = session.getState().settings.stairs;
    const base: Staircase = {
      id,
      fromLevelId: doc.levels[from].id,
      toLevelId: doc.levels[to].id,
      shape: st.shape,
      ...(st.shape === "straight" ? {} : { turn: st.turn }),
      foot: { x: 0, y: 0 },
      rotation: st.rotation,
      width: st.width,
      going: st.going,
    };
    const b = staircasePlan(doc, base).bounds;
    return { ...base, foot: snapStairsFoot(base, { x: world.x - (b.minX + b.maxX) / 2, y: world.y - (b.minY + b.maxY) / 2 }) };
  }

  function stairsMove(world: Point2) {
    const staircase = stairsAt(world);
    if (!staircase) return;
    const result = applyCommand(documents.getState().history.present, { type: "addStairs", staircase });
    session.setState({ stairsDraft: { staircase, valid: result.ok, message: result.ok ? null : (result.issues[0]?.message ?? null) } });
  }

  function stairsDown(world: Point2) {
    const staircase = stairsAt(world, `${newIdPrefix()}-stairs`);
    if (!staircase) {
      actions.notify("info", "Add a floor first; stairs go up to it.");
      return;
    }
    const result = actions.dispatch({ type: "addStairs", staircase });
    if (!result.ok) return;
    actions.setTool("select");
    actions.select({ kind: "stairs", id: staircase.id });
  }

  // ── Erase ──────────────────────────────────────────────────────────────
  /** True while the pointer is down with the Erase tool: rooms it crosses are marked. */
  let erasing = false;

  function eraseAt(world: Point2) {
    const { level, geometry } = context();
    const roomId = roomAt(level, geometry, world);
    if (!roomId) return;
    const erased = session.getState().erased;
    // Pinned rooms and halls stay as they are: rooms are laid out again around the hall.
    const room = level.rooms[roomId];
    if (erased.includes(roomId) || !room || room.locked || room.type === "hall") return;
    session.setState({ erased: [...erased, roomId] });
  }

  // ── Public handlers ────────────────────────────────────────────────────
  return {
    pointerDown(input: PointerInput) {
      stopGlide();
      const tool = session.getState().tool;
      const { workspace } = session.getState();
      // Map and Requirements show the plan for reference, and an option on show isn't the plan: dragging pans.
      const reference = workspace === "brief" || workspace === "site" || !!documents.getState().staged;
      if (input.button === 1 || (input.button === 0 && (spaceHeld || reference))) {
        gesture = { kind: "pan", last: input.screen };
        session.setState({ panning: true });
        return;
      }
      if (input.button === 2) {
        if (tool === "wall") this.cancel();
        return;
      }
      if (input.button !== 0) return;
      const world = toWorld(input.screen);
      // Putting a camera down for a render: where it stands, then what it looks at.
      const pick = session.getState().cameraPick;
      if (pick) {
        const { level, geometry } = context();
        if (!pick.eye) {
          if (!roomAt(level, geometry, world)) actions.notify("info", "Put the camera down inside a room.");
          else session.setState({ cameraPick: { eye: world } });
          return;
        }
        const roomId = roomAt(level, geometry, pick.eye)!;
        session.setState((s) => ({ cameraPick: null, cameraSpots: [{ id: `spot-${Date.now()}`, roomId, eye: pick.eye!, look: world }, ...s.cameraSpots].slice(0, 6) }));
        return;
      }
      if (tool === "select") selectDown(input);
      else if (tool === "wall") wallDown(world);
      else if (tool === "room") {
        const { level, geometry } = context();
        const roomId = roomAt(level, geometry, world);
        actions.select(roomId ? { kind: "room", id: roomId } : null);
        if (roomId) session.setState((s) => ({ roomNameFocus: (s.roomNameFocus ?? 0) + 1, panels: { ...s.panels, inspectorCollapsed: false } }));
        else actions.notify("info", "Click inside an enclosed room to edit it.");
      } else if (tool === "door" || tool === "window") openingDown(world, tool);
      else if (tool === "furniture") furnitureDown(world);
      else if (tool === "stairs") stairsDown(world);
      else if (tool === "outline") outlineDown(world);
      else if (tool === "erase") {
        erasing = true;
        eraseAt(world);
      }
    },

    pointerMove(input: PointerInput) {
      altHeld = input.altKey;
      const world = toWorld(input.screen);
      session.setState({ cursor: world });
      if (gesture?.kind === "pan") {
        const dx = input.screen.x - gesture.last.x;
        const dy = input.screen.y - gesture.last.y;
        gesture.last = input.screen;
        session.setState((s) => ({ viewport: panBy(s.viewport, dx, dy), viewportFitted: false }));
        return;
      }
      if (gesture?.kind === "pending") {
        const moved = Math.hypot(input.screen.x - gesture.downScreen.x, input.screen.y - gesture.downScreen.y);
        if (moved < DRAG_THRESHOLD_PX) return;
        if (session.getState().readOnly || !inRefine(session.getState())) {
          // Phones, and the plan outside Refine, look but don't edit: dragging pans instead of moving anything.
          gesture = { kind: "pan", last: input.screen };
          session.setState({ panning: true });
          return;
        }
        gesture = startDrag(gesture);
        if (!gesture) return;
        session.setState({ drag: gesture.kind as Exclude<Gesture["kind"], "pan" | "pending"> });
      }
      if (gesture) {
        dragMove(world);
        return;
      }
      const tool = session.getState().tool;
      if (session.getState().workspace === "brief" || session.getState().workspace === "site") return;
      if (tool === "erase") {
        if (erasing) eraseAt(world);
        const { level, geometry } = context();
        const roomId = roomAt(level, geometry, world);
        if (roomId !== session.getState().hover?.id) session.setState({ hover: roomId ? { kind: "room", id: roomId } : null });
        return;
      }
      if (tool === "select" || tool === "room") {
        const { level, geometry, session: s } = context();
        let hit: Selection;
        if (tool === "select" && inRefine(s)) hit = refineHit(world);
        else {
          const roomId = roomAt(level, geometry, world);
          hit = roomId ? { kind: "room", id: roomId } : null;
        }
        const hover = session.getState().hover;
        if (hit?.id !== hover?.id || hit?.kind !== hover?.kind) session.setState({ hover: hit });
      } else if (tool === "wall") wallMove(world);
      else if (tool === "door" || tool === "window") openingMove(world, tool);
      else if (tool === "furniture") furnitureMove(world);
      else if (tool === "stairs") stairsMove(world);
      else if (tool === "outline") outlineMove(world);
    },

    finishOutline,

    /** Takes back the last corner of the outline being drawn. */
    undoOutlineCorner() {
      outlinePoints = outlinePoints.slice(0, -1);
      showOutline(session.getState().outlineDraft?.cursor ?? null);
    },

    /** Builds a drawn outline the user has confirmed should replace the house. */
    confirmOutline(confirmed: boolean) {
      const pending = session.getState().outlineConfirm;
      if (!pending) return;
      if (confirmed) replaceOutline(pending.outline);
      else session.setState({ outlineConfirm: null });
    },

    pointerUp() {
      erasing = false;
      const g = gesture;
      gesture = null;
      if (!g) return;
      if (g.kind === "pan") {
        session.setState({ panning: false });
        return;
      }
      if (g.kind !== "pending") {
        actions.commitPreview();
        session.setState({ snap: null, drag: null, guides: [] });
      }
    },

    pointerLeave() {
      session.setState({ cursor: null, hover: null, snap: null, openingDraft: null, furnitureDraft: null, stairsDraft: null });
    },

    /** Escape: cancel the active gesture, then the wall chain, then the selection. */
    cancel(): boolean {
      if (gesture && gesture.kind !== "pan") {
        gesture = null;
        actions.cancelPreview();
        session.setState({ snap: null, drag: null, guides: [] });
        return true;
      }
      if (chainStart) {
        chainStart = null;
        session.setState({ wallDraft: null });
        return true;
      }
      if (outlinePoints.length) {
        outlinePoints = [];
        session.setState({ outlineDraft: null });
        return true;
      }
      if (session.getState().selection) {
        actions.select(null);
        return true;
      }
      return false;
    },

    /** Called when the tool changes so no half-finished gesture survives. */
    reset() {
      if (gesture && gesture.kind !== "pan") actions.cancelPreview();
      if (session.getState().drag) session.setState({ drag: null });
      gesture = null;
      erasing = false;
      chainStart = null;
      outlinePoints = [];
      if (session.getState().outlineDraft) session.setState({ outlineDraft: null });
    },

    isGestureActive: () => gesture !== null && gesture.kind !== "pan",

    setSpaceHeld(held: boolean) {
      spaceHeld = held;
    },

    /**
     * Scrolling pans the plan, as in Figma and Miro; with Ctrl or ⌘ held (a
     * trackpad pinch arrives that way too) it zooms about the pointer.
     */
    wheel(screen: Point2, deltaX: number, deltaY: number, zoom: boolean) {
      stopGlide();
      if (zoom) {
        // A pinch sends small steps, a mouse wheel big ones: both should feel the same.
        const factor = Math.exp(-deltaY * (Math.abs(deltaY) < 30 ? 0.012 : 0.0025));
        session.setState((s) => ({ viewport: zoomAt(s.viewport, screen, factor), viewportFitted: false }));
      } else session.setState((s) => ({ viewport: panBy(s.viewport, -deltaX, -deltaY), viewportFitted: false }));
    },

    /** Two-finger zoom and pan on touch screens: scales about the fingers' midpoint, then follows it. */
    pinch(center: Point2, factor: number, dx: number, dy: number) {
      stopGlide();
      session.setState((s) => ({ viewport: panBy(zoomAt(s.viewport, center, factor), dx, dy), viewportFitted: false }));
    },

    /** Zooms about the middle of the view; `glide` animates it (the zoom buttons and keys). */
    zoomBy(factor: number, glide = false) {
      const v = session.getState().viewport;
      glideTo(zoomAt(v, { x: v.width / 2, y: v.height / 2 }, factor), glide);
      session.setState({ viewportFitted: false });
    },

    /** Refits the plan when the furniture catalog would cover part of the house. */
    revealBesideCatalog() {
      const level = editedLevel();
      const env = analyzeEnvelope(level);
      if (!env.ok || session.getState().tool !== "furniture") return;
      const { viewport } = session.getState();
      const left = env.info.outsideRect.minX * viewport.scale + viewport.offsetX;
      if (left < insets().left) this.fitPlan();
    },

    /** Zooms to a part of the plan (a room, say), clear of the floating chrome; `glide` animates it. */
    zoomTo(rect: Rect, glide = false) {
      glideTo(fitRect(session.getState().viewport, rect, insets()), glide);
      session.setState({ viewportFitted: false });
    },

    /** Shows the whole plan. `glide` animates it (the Fit button and F); fits the editor makes itself are instant. */
    fitPlan(glide = false) {
      // The ground floor holds every floor above it.
      const level = groundLevel(documents.getState().history.present);
      const env = analyzeEnvelope(level);
      if (!env.ok) return;
      const r = env.info.outsideRect;
      // On Map, the whole plot when there is one.
      const rear = (level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
      const plot = session.getState().workspace === "site" ? sitePlot(r, rear, stores.project.getState().site) : null;
      // Leave room for the overall dimension lines (north and west) and the GARDEN / STREET labels (either end).
      const pad = 1.2;
      const frame = plot ? { minX: Math.min(plot.minX, r.minX) - 0.6, minY: Math.min(plot.minY, r.minY) - 0.6, maxX: Math.max(plot.maxX, r.maxX) + 0.6, maxY: Math.max(plot.maxY, r.maxY) + 0.6 } : { minX: r.minX - pad, minY: r.minY - pad, maxX: r.maxX + pad * 0.4, maxY: r.maxY + pad };
      const viewport = fitRect(session.getState().viewport, frame, insets());
      glideTo(viewport, glide);
      session.setState({ viewportFitted: true, fitScale: viewport.scale });
    },
  };
}

export type ToolController = ReturnType<typeof createToolController>;
