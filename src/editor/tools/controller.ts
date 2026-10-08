import { applyCommand } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { deriveLevelGeometry, openingHostInterval, openingHostIntervals, type LevelGeometry } from "@/domain/geometry/derive";
import { EPS, roundToPrecision } from "@/domain/geometry/numeric";
import { axialParam, pointAtParam } from "@/domain/geometry/walls";
import { LIMITS } from "@/domain/plan/defaults";
import type { Id, Opening, Point2 } from "@/domain/plan/types";
import type { EditorActions, EditorStores, Selection, SnapIndicator } from "../state/stores";
import { newIdPrefix } from "../state/ids";
import { fitRect, panBy, pixelsToMetres, screenToWorld, zoomAt } from "../viewport/viewport";
import { hitOpeningEdge, hitTest, hitWall, hitWallEnd, roomAt } from "./hitTest";
import { snapPoint } from "./snapping";

/** Screen-space acquisition radius for snapping and picking. */
export const SNAP_RADIUS_PX = 8;
const DRAG_THRESHOLD_PX = 4;
/** Keeps a fitted plan clear of the floating toolbar, tool options, view controls and variation tray. */
/** Screen space kept clear of floating chrome when fitting: tool rail and floors left, inspector right, dock below. */
const FIT_INSETS = { top: 72, right: 400, bottom: 230, left: 160 };
const TRAY_HEIGHT = 96;
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
  | { kind: "pending"; downScreen: Point2; downWorld: Point2; target: Selection; end: "start" | "end" | null }
  | { kind: "drag-wall"; wallId: Id; horizontal: boolean; line: number; downWorld: Point2; prefix: string }
  | { kind: "drag-end"; wallId: Id; end: "start" | "end"; horizontal: boolean; fixed: Point2; prefix: string }
  | { kind: "drag-opening"; openingId: Id; grab: number; prefix: string }
  | { kind: "drag-opening-edge"; openingId: Id; edge: "start" | "end"; fixed: number; prefix: string };

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
  let spaceHeld = false;

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
    if (s.workspace !== "structure") {
      // Design works with rooms as whole objects; structure isn't editable here.
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
    if (selected?.kind === "wall" && level.walls[selected.id]?.role === "internal") {
      const end = hitWallEnd(geometry, selected.id, world, radius * 1.25);
      if (end) {
        gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target: selected, end };
        return;
      }
    }
    const target = hitTest(level, geometry, world, radius);
    actions.select(target);
    gesture = { kind: "pending", downScreen: input.screen, downWorld: world, target, end: null };
  }

  function startDrag(pending: Extract<Gesture, { kind: "pending" }>) {
    const { level, geometry } = context();
    const target = pending.target;
    if (!target) return null;
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
    },

    pointerMove(input: PointerInput) {
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
        const roomsOnly = tool === "room" || s.workspace !== "structure";
        const roomId = roomsOnly ? roomAt(level, geometry, world) : null;
        const hit: Selection = roomsOnly ? (roomId ? { kind: "room", id: roomId } : null) : hitTest(level, geometry, world, radius);
        const hover = session.getState().hover;
        if (hit?.id !== hover?.id || hit?.kind !== hover?.kind) session.setState({ hover: hit });
      } else if (tool === "wall") wallMove(world);
      else if (tool === "door" || tool === "window") openingMove(world, tool);
    },

    pointerUp() {
      const g = gesture;
      gesture = null;
      if (!g) return;
      if (g.kind === "pan") {
        session.setState({ panning: false });
        return;
      }
      if (g.kind === "drag-wall" || g.kind === "drag-end" || g.kind === "drag-opening" || g.kind === "drag-opening-edge") {
        actions.commitPreview();
        session.setState({ snap: null, drag: null });
      }
    },

    pointerLeave() {
      session.setState({ cursor: null, hover: null, snap: null, openingDraft: null });
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
      const insets = stores.project.getState().plans.length > 1 ? { ...base, bottom: base.bottom + TRAY_HEIGHT } : base;
      session.setState((s) => ({
        viewport: fitRect(s.viewport, { minX: r.minX - pad, minY: r.minY - pad * 0.4, maxX: r.maxX + pad * 0.4, maxY: r.maxY + pad }, insets),
      }));
    },
  };
}

export type ToolController = ReturnType<typeof createToolController>;
