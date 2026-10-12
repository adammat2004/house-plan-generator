"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconButton } from "@/components/ui/controls";
import { FitIcon, GridIcon, MagnetIcon, MinusIcon, PlusIcon } from "@/components/ui/icons";
import { editorStores, useSessionState } from "../../state/editor";

/*
 * The pannable board used by Room variations inside Refine. The Layouts step
 * is a plain page (ConceptBoard.tsx): wizard steps are pages, boards are for
 * the editor.
 */
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.6;

export interface BoardView {
  x: number;
  y: number;
  k: number;
}

/** Elements that take their own pointer input rather than panning the board. */
const INTERACTIVE = "button, a, input, select, textarea, summary, .board-card";

/**
 * Pan and zoom for a board of cards: wheel pans, pinch (or ctrl/⌘ + wheel)
 * zooms around the pointer, dragging empty space pans. `reserveRight` is
 * the width covered by a side panel, left out when fitting.
 */
export function usePanZoom(reserveRight: number) {
  const [view, setView] = useState<BoardView>({ x: 0, y: 0, k: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        setView((v) => {
          const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * Math.exp(-e.deltaY * 0.004)));
          return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const el = viewport.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  /** Everything in view at up to 100%, left of the side panel. */
  const fit = () => {
    const el = viewport.current;
    const box = content.current;
    if (!el || !box) return;
    const room = { w: el.clientWidth - reserveRight, h: el.clientHeight };
    // The content's padding keeps cards clear of the rail and header, so it stays at full size
    // when zoomed out; only the cards themselves scale to fit what's left.
    const style = getComputedStyle(box);
    const left = parseFloat(style.paddingLeft) || 0;
    const top = parseFloat(style.paddingTop) || 0;
    const k = Math.min(1, Math.max(MIN_ZOOM, Math.min((room.w - left) / (box.offsetWidth - left), (room.h - top) / (box.offsetHeight - top))));
    setView({ k, x: Math.max(left * (1 - k), (room.w - box.offsetWidth * k) / 2), y: top * (1 - k) });
  };

  const handlers = {
    onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
      if (e.button !== 0 && e.button !== 1) return;
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
      drag.current = { ...d, x: e.clientX, y: e.clientY };
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    },
    onPointerUp() {
      drag.current = null;
    },
    onPointerCancel() {
      drag.current = null;
    },
  };

  const viewportStyle = { backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` };
  const contentStyle = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` };
  return { view, viewport, content, handlers, viewportStyle, contentStyle, zoomBy, fit };
}

/** Bottom dock for a board: grid, (plan-only) snap, zoom and fit. */
export function BoardDock({ k, zoomBy, fit, reserveRight = 370 }: { k: number; zoomBy: (f: number) => void; fit: () => void; reserveRight?: number }) {
  const gridVisible = useSessionState((s) => s.settings.gridVisible);
  return (
    <div className="board-dock floating" role="toolbar" aria-label="Board" style={{ left: `calc((100% - ${reserveRight}px) / 2)` }}>
      <button
        type="button"
        className={`dock-btn${gridVisible ? " is-active" : ""}`}
        aria-pressed={gridVisible}
        onClick={() => editorStores.session.setState((s) => ({ settings: { ...s.settings, gridVisible: !s.settings.gridVisible } }))}
      >
        <GridIcon width={20} height={20} />
        <span>Grid</span>
      </button>
      <button type="button" className="dock-btn" aria-disabled="true" data-tooltip="Snapping applies when editing a plan" data-tooltip-side="top">
        <MagnetIcon width={20} height={20} />
        <span>Snap</span>
      </button>
      <span className="dock-divider" aria-hidden />
      <div className="dock-zoom">
        <IconButton label="Zoom out" tooltipSide="top" onClick={() => zoomBy(1 / 1.2)}>
          <MinusIcon />
        </IconButton>
        <span className="zoom-readout" data-testid="board-zoom">
          {Math.round(k * 100)}%
        </span>
        <IconButton label="Zoom in" tooltipSide="top" onClick={() => zoomBy(1.2)}>
          <PlusIcon />
        </IconButton>
      </div>
      <button type="button" className="btn btn-secondary dock-fit-outline" onClick={fit} data-testid="board-fit">
        <FitIcon width={18} height={18} /> Fit
      </button>
    </div>
  );
}
