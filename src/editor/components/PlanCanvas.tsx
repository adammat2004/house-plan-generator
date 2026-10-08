"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlanStage } from "../rendering/konva/PlanStage";
import { editorStores, useSessionState } from "../state/editor";
import { toolController } from "../tools/instance";
import type { PointerInput } from "../tools/controller";
import { resizeViewport } from "../viewport/viewport";

const CURSORS = {
  select: "default",
  wall: "crosshair",
  room: "pointer",
  door: "copy",
  window: "copy",
} as const;

/**
 * Hosts the Konva stage and turns DOM pointer events into tool input.
 * Pointer moves are coalesced to one update per animation frame.
 */
export default function PlanCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const tool = useSessionState((s) => s.tool);
  const panning = useSessionState((s) => s.panning);
  const pendingMove = useRef<PointerInput | null>(null);
  const frame = useRef<number | null>(null);
  const fitted = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setSize({ width, height });
      editorStores.session.setState((s) => ({ viewport: resizeViewport(s.viewport, width, height) }));
      if (!fitted.current && width > 0 && height > 0) {
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
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      toolController.wheel({ x: e.clientX - rect.left, y: e.clientY - rect.top }, delta);
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
      style={{ cursor: panning ? "grabbing" : CURSORS[tool] }}
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
        flushMove();
        const i = input(e);
        toolController.pointerMove(i);
        toolController.pointerDown(i);
      }}
      onPointerMove={(e) => {
        pendingMove.current = input(e);
        if (frame.current === null) {
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            flushMove();
          });
        }
      }}
      onPointerUp={(e) => {
        pendingMove.current = input(e);
        flushMove();
        toolController.pointerUp();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
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
