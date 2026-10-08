"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/controls";
import { ExpandIcon, FitIcon, GridIcon, MagnetIcon, MinusIcon, NorthArrowIcon, PlusIcon, RedoIcon, ShrinkIcon, UndoIcon } from "@/components/ui/icons";
import { editor, editorStores, useDocumentState, useSessionState } from "../../state/editor";
import { toolController } from "../../tools/instance";

const toggle = (key: "snapEnabled" | "gridVisible") =>
  editorStores.session.setState((s) => ({ settings: { ...s.settings, [key]: !s.settings[key] } }));

/** Bottom-centre dock: drawing aids, history and fit. */
export function CanvasDock() {
  const snapEnabled = useSessionState((s) => s.settings.snapEnabled);
  const gridVisible = useSessionState((s) => s.settings.gridVisible);
  const canUndo = useDocumentState((s) => s.history.past.length > 0 && !s.preview);
  const canRedo = useDocumentState((s) => s.history.future.length > 0 && !s.preview);
  return (
    <div className="canvas-dock floating" role="toolbar" aria-label="Canvas">
      <button type="button" className={`dock-btn${gridVisible ? " is-active" : ""}`} aria-pressed={gridVisible} onClick={() => toggle("gridVisible")} data-testid="toggle-grid">
        <GridIcon width={20} height={20} />
        <span>Grid</span>
      </button>
      <button type="button" className={`dock-btn${snapEnabled ? " is-active" : ""}`} aria-pressed={snapEnabled} onClick={() => toggle("snapEnabled")} data-testid="toggle-snap">
        <MagnetIcon width={20} height={20} />
        <span>Snap</span>
      </button>
      <span className="dock-divider" aria-hidden />
      <IconButton label="Undo" tooltipSide="top" disabled={!canUndo} onClick={() => editor.undo()} data-testid="dock-undo">
        <UndoIcon width={20} height={20} />
      </IconButton>
      <IconButton label="Redo" tooltipSide="top" disabled={!canRedo} onClick={() => editor.redo()} data-testid="dock-redo">
        <RedoIcon width={20} height={20} />
      </IconButton>
      <button type="button" className="btn btn-primary dock-fit" data-tooltip="Fit plan  F" data-tooltip-side="top" onClick={() => toolController.fitPlan()} data-testid="fit-plan">
        <FitIcon width={18} height={18} /> Fit
      </button>
    </div>
  );
}

/** Bottom-right: north, zoom and full screen. */
export function ViewControls() {
  const scale = useSessionState((s) => s.viewport.scale);
  const fullscreen = useFullscreen();
  return (
    <div className="view-controls">
      <div className="north-badge floating" role="img" aria-label="North is up">
        <span aria-hidden>N</span>
        <NorthArrowIcon width={18} height={18} />
      </div>
      <div className="zoom-pill floating" role="group" aria-label="Zoom">
        <IconButton label="Zoom out" shortcut="−" tooltipSide="top" onClick={() => toolController.zoomBy(1 / 1.25)}>
          <MinusIcon />
        </IconButton>
        <span className="zoom-readout" aria-live="polite" data-testid="zoom-readout">
          {Math.round(scale)} px/m
        </span>
        <IconButton label="Zoom in" shortcut="+" tooltipSide="top" onClick={() => toolController.zoomBy(1.25)}>
          <PlusIcon />
        </IconButton>
      </div>
      <IconButton
        label={fullscreen ? "Exit full screen" : "Full screen"}
        tooltipSide="top"
        className="floating fullscreen-btn"
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.().catch(() => editor.notify("info", "Full screen isn't available in this browser."));
        }}
        data-testid="toggle-fullscreen"
      >
        {fullscreen ? <ShrinkIcon /> : <ExpandIcon />}
      </IconButton>
    </div>
  );
}

function useFullscreen() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const update = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  return on;
}
