"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlanStage } from "../rendering/konva/PlanStage";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { editor, editorStores, useSessionState } from "../state/editor";
import { inRefine, type SessionState } from "../state/stores";
import { toolController } from "../tools/instance";
import type { PointerInput } from "../tools/controller";
import { resizeViewport } from "../viewport/viewport";

const CURSORS = {
  select: "default",
  wall: "crosshair",
  outline: "crosshair",
  room: "pointer",
  door: "copy",
  window: "copy",
  furniture: "copy",
  stairs: "copy",
} as const;

/**
 * What the pointer says it can do with what's under it, with Select: walls
 * that drag show which way they move, things that can be picked up show a
 * hand (a closed one while dragging), rooms show they can be picked, and
 * outside Refine the plan shows it can be moved.
 */
function cursorOver(s: SessionState): string {
  if (s.drag) return "grabbing";
  if (!inRefine(s) || s.readOnly) return s.workspace === "design" && s.designView === "plan" ? "default" : "grab";
  const h = s.hover;
  if (!h) return "default";
  if (h.kind === "furniture" || h.kind === "stairs" || h.kind === "opening") return "grab";
  if (h.kind === "wall") {
    const level = editor.activeLevel();
    const wall = level.walls[h.id];
    const axis = wall && deriveLevelGeometry(level).axes.get(h.id);
    // An outside wall moves once it's picked; until then it's picked like anything else.
    if (!axis || (wall.role === "external" && !(s.selection?.kind === "wall" && s.selection.id === h.id))) return "pointer";
    return axis.orientation === "horizontal" ? "row-resize" : "col-resize";
  }
  return "pointer";
}

/**
 * Hosts the Konva stage and turns DOM pointer events into tool input.
 * Pointer moves are coalesced to one update per animation frame.
 */
export default function PlanCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const tool = useSessionState((s) => s.tool);
  const panning = useSessionState((s) => s.panning);
  const pointing = useSessionState(cursorOver);
  const pendingMove = useRef<PointerInput | null>(null);
  const frame = useRef<number | null>(null);
  const fitted = useRef(false);
  // Touch points by pointer id; two at once is a pinch, which zooms and pans instead of editing.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; mid: { x: number; y: number } } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setSize({ width, height });
      editorStores.session.setState((s) => ({ viewport: resizeViewport(s.viewport, width, height) }));
      if (width > 0 && height > 0 && (!fitted.current || editorStores.session.getState().viewportFitted)) {
        fitted.current = true;
        toolController.fitPlan();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const line = e.deltaMode === 1 ? 16 : 1;
      // Shift + wheel scrolls sideways on mice that only scroll up and down.
      const [dx, dy] = e.shiftKey && !e.deltaX ? [e.deltaY, 0] : [e.deltaX, e.deltaY];
      toolController.wheel({ x: e.clientX - rect.left, y: e.clientY - rect.top }, dx * line, dy * line, e.ctrlKey || e.metaKey);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const input = (e: ReactPointerEvent<HTMLDivElement>): PointerInput => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      screen: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    };
  };

  const pinchState = () => {
    const [a, b] = [...touches.current.values()];
    return { distance: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  /** Tracks a touch point; returns true while two fingers are pinching. */
  const trackTouch = (e: ReactPointerEvent<HTMLDivElement>, phase: "down" | "move" | "up") => {
    if (e.pointerType !== "touch") return false;
    const { screen } = input(e);
    if (phase === "up") {
      touches.current.delete(e.pointerId);
      const wasPinching = pinch.current !== null;
      if (touches.current.size < 2) pinch.current = null;
      return wasPinching;
    }
    if (phase === "move" && !touches.current.has(e.pointerId)) return false;
    touches.current.set(e.pointerId, screen);
    if (touches.current.size !== 2) return false;
    const now = pinchState();
    if (pinch.current) toolController.pinch(now.mid, now.distance / pinch.current.distance, now.mid.x - pinch.current.mid.x, now.mid.y - pinch.current.mid.y);
    else {
      // The second finger turns whatever the first one started into a pinch.
      pendingMove.current = null;
      toolController.reset();
      editorStores.session.setState({ panning: false });
    }
    pinch.current = now;
    return true;
  };

  const flushMove = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const move = pendingMove.current;
    pendingMove.current = null;
    if (move) toolController.pointerMove(move);
  };

  return (
    <div
      ref={ref}
      className="plan-canvas"
      role="application"
      aria-label="Floor plan canvas. Use the tool rail or keyboard shortcuts to edit; the plan contents list offers keyboard access to walls, openings and rooms."
      tabIndex={0}
      data-testid="plan-canvas"
      style={{ cursor: panning ? "grabbing" : tool === "select" ? pointing : CURSORS[tool] }}
      onContextMenu={(e) => e.preventDefault()}
      // Focus is managed in onPointerDown; the default mousedown focus would
      // steal focus from inspector fields that tools focus deliberately.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button === 1) e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        if (document.activeElement instanceof HTMLElement && document.activeElement !== e.currentTarget) {
          document.activeElement.blur();
        }
        e.currentTarget.focus({ preventScroll: true });
        if (trackTouch(e, "down")) return;
        flushMove();
        const i = input(e);
        toolController.pointerMove(i);
        toolController.pointerDown(i);
      }}
      onPointerMove={(e) => {
        if (trackTouch(e, "move")) return;
        pendingMove.current = input(e);
        if (frame.current === null) {
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            flushMove();
          });
        }
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (trackTouch(e, "up")) return;
        pendingMove.current = input(e);
        flushMove();
        toolController.pointerUp();
      }}
      onPointerCancel={(e) => {
        trackTouch(e, "up");
        toolController.cancel();
        toolController.pointerUp();
      }}
      onPointerLeave={() => {
        pendingMove.current = null;
        toolController.pointerLeave();
      }}
    >
      {size.width > 0 && size.height > 0 && <PlanStage width={size.width} height={size.height} />}
    </div>
  );
}
