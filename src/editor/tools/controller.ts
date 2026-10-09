import { applyCommand } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { checkOutlineRing, normalizeRing, outsideToAxis } from "@/domain/geometry/outline";
import { deriveLevelGeometry, openingHostInterval, openingHostIntervals, type LevelGeometry } from "@/domain/geometry/derive";
import { EPS, roundToPrecision } from "@/domain/geometry/numeric";
import { axialParam, pointAtParam } from "@/domain/geometry/walls";
import { DEFAULT_HOUSE, LIMITS } from "@/domain/plan/defaults";
import type { Id, Opening, Point2 } from "@/domain/plan/types";
import type { EditorActions, EditorStores, Selection, SnapIndicator } from "../state/stores";
import { newIdPrefix } from "../state/ids";
import { fitRect, panBy, pixelsToMetres, screenToWorld, zoomAt } from "../viewport/viewport";
import { hitDesign, hitOpeningEdge, hitTest, hitWall, hitWallEnd, roomAt } from "./hitTest";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { hitFurniture, poseIsClear, snapFurniture, type FurniturePose } from "./furnitureSnap";
import { snapPoint } from "./snapping";

/** Screen-space acquisition radius for snapping and picking. */
export const SNAP_RADIUS_PX = 8;
const DRAG_THRESHOLD_PX = 4;
/** Keeps a fitted plan clear of the floating toolbar, tool options, view controls and variation tray. */
/** Screen space kept clear of floating chrome when fitting: tool rail and floors left, inspector right, dock below. */
const FIT_INSETS = { top: 72, right: 400, bottom: 230, left: 160 };
const TRAY_HEIGHT = 96;
/** Right edge of the furniture catalog, with a margin. */
const CATALOG_LEFT = 124 + 264 + 24;
/** The 2D plan beside (or instead of) the 3D view: rail on the left, floors and dock below. */
const PRESENT_INSETS = { top: 90, right: 48, bottom: 230, left: 130 };
const DESIGN_INSETS = { top: 80, right: 660, bottom: 200, left: 150 };
/** The brief panel covers the right of the canvas; the plan sits beside it. */
const BRIEF_INSETS = { top: 72, right: 560, bottom: 220, left: 120 };

export interface PointerInput {
  /** Pointer position in CSS pixels relative to the canvas. */
  screen: Point2;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
}

type Gesture =
  | { kind: "pan"; last: Point2 }
  | { kind: "pending"; downScreen: Point2; downWorld: Point2; target: Selection; end: "start" | "end" | null; corner?: number; alt?: boolean }
  | { kind: "drag-wall"; wallId: Id; horizontal: boolean; line: number; downWorld: Point2; prefix: string }
  | { kind: "drag-end"; wallId: Id; end: "start" | "end"; horizontal: boolean; fixed: Point2; prefix: string }
  | { kind: "drag-opening"; openingId: Id; grab: number; prefix: string }
  | { kind: "drag-opening-edge"; openingId: Id; edge: "start" | "end"; fixed: number; prefix: string }
  | { kind: "drag-furniture"; furnitureId: Id; grab: Point2; rotation: FurniturePose["rotation"]; prefix: string }
  | { kind: "drag-outline"; wallId: Id; normal: Point2; horizontal: boolean; line: number; downWorld: Point2; from?: number; to?: number; prefix: string }
  | { kind: "drag-corner"; wallId: Id; corner: Point2; dir: Point2; normal: Point2; length: number; prefix: string };

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
export function createToolController(stores: EditorStores, actions: EditorActions) {
  const { documents, session } = stores;
  let gesture: Gesture | null = null;
  let chainStart: Point2 | null = null;
  /** Corners of the outline being drawn, on the outside faces. */
  let outlinePoints: Point2[] = [];
  let spaceHeld = false;
  /** Alt (Option) places and drags furniture without snapping. */
  let altHeld = false;

  const context = () => {
    const level = documents.getState().history.present.levels[0];
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

  // ── Select tool ────────────────────────────────────────────────────────
  function selectDown(input: PointerInput) {
    const { level, geometry, session: s, radius } = context();
    const world = toWorld(input.screen);
    if (s.workspace === "design") {
      // Rooms and furniture as whole objects; inside walls, doors and windows can be dragged, the outline can't.
      const target = hitDesign(level, geometry, world, radius, hitFurniture(level, world, radius * 0.5));
      // Clicking a wall selects the room on that side; dragging it moves the wall.
      const roomId = target?.kind === "wall" ? roomAt(level, geometry, world) : null;
      actions.select(target?.kind === "wall" ? (roomId ? { kind: "room", id: roomId } : null) : target);
      gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target, end: null };
      return;
    }
    if (s.workspace !== "structure") {
      const roomId = roomAt(level, geometry, world);
      const target: Selection = roomId ? { kind: "room", id: roomId } : null;
      actions.select(target);
      gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target, end: null };
      return;
    }
    const selected = s.selection;
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
    const target = hitTest(level, geometry, world, radius);
    actions.select(target);
    gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target, end: null, alt: input.altKey };
  }

  function startDrag(pending: Extract<Gesture, { kind: "pending" }>) {
    const { level, geometry } = context();
    const target = pending.target;
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
        session.setState({ snap: { point: gesture.horizontal ? { x: mid.x, y: target } : { x: target, y: mid.y }, kind } });
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
    const env = analyzeEnvelope(documents.getState().history.present.levels[0]);
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
    const level = documents.getState().history.present.levels[0];
    const furnished = Object.values(level.walls).some((w) => w.role === "internal") || Object.keys(level.openings).length > 0 || Object.keys(level.furniture).length > 0;
    if (furnished) session.setState({ outlineConfirm: { outline: ring } });
    else replaceOutline(ring);
  }

  function replaceOutline(outline: Point2[]) {
    const level = documents.getState().history.present.levels[0];
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
    const result = applyCommand(documents.getState().history.present, {
      type: "addWall",
      start: chainStart,
      end: snapped.point,
      thickness: s.settings.internalThickness,
      idPrefix: "draft",
    });
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
      const wallId = result.createdIds.find((id) => result.document.levels[0].walls[id]);
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

  // ── Public handlers ────────────────────────────────────────────────────
  return {
    pointerDown(input: PointerInput) {
      const tool = session.getState().tool;
      // The brief shows the plan for reference only: dragging pans it.
      const briefing = session.getState().workspace === "brief";
      if (input.button === 1 || (input.button === 0 && (spaceHeld || briefing))) {
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
      else if (tool === "outline") outlineDown(world);
    },

    pointerMove(input: PointerInput) {
      altHeld = input.altKey;
      const world = toWorld(input.screen);
      session.setState({ cursor: world });
      if (gesture?.kind === "pan") {
        const dx = input.screen.x - gesture.last.x;
        const dy = input.screen.y - gesture.last.y;
        gesture.last = input.screen;
        session.setState((s) => ({ viewport: panBy(s.viewport, dx, dy) }));
        return;
      }
      if (gesture?.kind === "pending") {
        const moved = Math.hypot(input.screen.x - gesture.downScreen.x, input.screen.y - gesture.downScreen.y);
        if (moved < DRAG_THRESHOLD_PX) return;
        gesture = startDrag(gesture);
        if (!gesture) return;
        session.setState({ drag: gesture.kind as Exclude<Gesture["kind"], "pan" | "pending"> });
      }
      if (gesture) {
        dragMove(world);
        return;
      }
      const tool = session.getState().tool;
      if (session.getState().workspace === "brief") return;
      if (tool === "select" || tool === "room") {
        const { level, geometry, radius, session: s } = context();
        const designing = tool === "select" && s.workspace === "design";
        const roomsOnly = tool === "room" || s.workspace !== "structure";
        const roomId = roomsOnly && !designing ? roomAt(level, geometry, world) : null;
        const hit: Selection = designing
          ? hitDesign(level, geometry, world, radius, hitFurniture(level, world, radius * 0.5))
          : roomsOnly
            ? roomId
              ? { kind: "room", id: roomId }
              : null
            : hitTest(level, geometry, world, radius);
        const hover = session.getState().hover;
        if (hit?.id !== hover?.id || hit?.kind !== hover?.kind) session.setState({ hover: hit });
      } else if (tool === "wall") wallMove(world);
      else if (tool === "door" || tool === "window") openingMove(world, tool);
      else if (tool === "furniture") furnitureMove(world);
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
      const g = gesture;
      gesture = null;
      if (!g) return;
      if (g.kind === "pan") {
        session.setState({ panning: false });
        return;
      }
      if (g.kind === "drag-wall" || g.kind === "drag-end" || g.kind === "drag-opening" || g.kind === "drag-opening-edge" || g.kind === "drag-furniture" || g.kind === "drag-outline" || g.kind === "drag-corner") {
        actions.commitPreview();
        session.setState({ snap: null, drag: null });
      }
    },

    pointerLeave() {
      session.setState({ cursor: null, hover: null, snap: null, openingDraft: null, furnitureDraft: null });
    },

    /** Escape: cancel the active gesture, then the wall chain, then the selection. */
    cancel(): boolean {
      if (gesture && gesture.kind !== "pan") {
        gesture = null;
        actions.cancelPreview();
        session.setState({ snap: null, drag: null });
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
      chainStart = null;
      outlinePoints = [];
      if (session.getState().outlineDraft) session.setState({ outlineDraft: null });
    },

    isGestureActive: () => gesture !== null && gesture.kind !== "pan",

    setSpaceHeld(held: boolean) {
      spaceHeld = held;
    },

    wheel(screen: Point2, deltaY: number) {
      const factor = Math.exp(-deltaY * 0.0015);
      session.setState((s) => ({ viewport: zoomAt(s.viewport, screen, factor) }));
    },

    zoomBy(factor: number) {
      session.setState((s) => ({
        viewport: zoomAt(s.viewport, { x: s.viewport.width / 2, y: s.viewport.height / 2 }, factor),
      }));
    },

    /** Refits the plan when the furniture catalog would cover part of the house. */
    revealBesideCatalog() {
      const level = documents.getState().history.present.levels[0];
      const env = analyzeEnvelope(level);
      if (!env.ok || session.getState().tool !== "furniture") return;
      const { viewport } = session.getState();
      const left = env.info.outsideRect.minX * viewport.scale + viewport.offsetX;
      if (left < CATALOG_LEFT) this.fitPlan();
    },

    fitPlan() {
      const level = documents.getState().history.present.levels[0];
      const env = analyzeEnvelope(level);
      if (!env.ok) return;
      const r = env.info.outsideRect;
      // Leave room for the overall dimension lines (north and west).
      const pad = 1.2;
      const { workspace, designer } = session.getState();
      // In Designs the room card and the AI Designer sit side by side on the right.
      const base =
        workspace === "brief" ? BRIEF_INSETS
        : workspace === "present" ? PRESENT_INSETS
        : workspace === "design" && designer.panelOpen ? DESIGN_INSETS
        : FIT_INSETS;
      const trayed = stores.project.getState().plans.length > 1 ? { ...base, bottom: base.bottom + TRAY_HEIGHT } : base;
      // The furniture catalog sits beside the tool rail.
      const insets = session.getState().tool === "furniture" ? { ...trayed, left: Math.max(trayed.left, CATALOG_LEFT) } : trayed;
      session.setState((s) => ({
        viewport: fitRect(s.viewport, { minX: r.minX - pad, minY: r.minY - pad * 0.4, maxX: r.maxX + pad * 0.4, maxY: r.maxY + pad }, insets),
      }));
    },
  };
}

export type ToolController = ReturnType<typeof createToolController>;
