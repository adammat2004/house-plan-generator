"use client";

import { IconButton } from "@/components/ui/controls";
import { FitIcon, MinusIcon, PlusIcon, RedoIcon, UndoIcon } from "@/components/ui/icons";
import { editor, editorStores, useDocumentState, useSessionState } from "../../state/editor";
import { only3d } from "../../state/stores";
import { toolController } from "../../tools/instance";
import { aim } from "../present/actions";

/** Turns the grid or snapping on or off (from the tool rail's More menu). */
export const toggleSetting = (key: "snapEnabled" | "gridVisible") =>
  editorStores.session.setState((s) => ({ settings: { ...s.settings, [key]: !s.settings[key] } }));

/** Zoom as a percentage of what Fit chose, so 100% always means "the whole plan". */
function useZoomPercent(): number {
  const scale = useSessionState((s) => s.viewport.scale);
  const fitScale = useSessionState((s) => s.fitScale);
  return Math.round((scale / (fitScale ?? scale)) * 100);
}

/** The pill under the plan: history, then zoom and fit (or, over the 3D view, putting the camera back). */
export function CanvasDock() {
  const covered = useSessionState(only3d);
  const canUndo = useDocumentState((s) => s.history.past.length > 0 && !s.preview);
  const canRedo = useDocumentState((s) => s.history.future.length > 0 && !s.preview);
  // Phones look but don't edit, so there's nothing to undo.
  const readOnly = useSessionState((s) => s.readOnly);
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  return (
    <div className="canvas-dock floating" role="toolbar" aria-label={covered ? "3D view" : "Plan view"}>
      {!readOnly && (
        <>
          <IconButton label="Undo" shortcut={`${mod}Z`} tooltipSide="top" disabled={!canUndo} onClick={() => editor.undo()} data-testid="undo">
            <UndoIcon width={20} height={20} />
          </IconButton>
          <IconButton label="Redo" shortcut={`${mod}⇧Z`} tooltipSide="top" disabled={!canRedo} onClick={() => editor.redo()} data-testid="redo">
            <RedoIcon width={20} height={20} />
          </IconButton>
          <span className="dock-divider" aria-hidden />
        </>
      )}
      {covered ? (
        <button type="button" className="btn btn-ghost dock-fit" onClick={() => aim("orbit")} data-testid="three-reset">
          <FitIcon width={18} height={18} /> Reset view
        </button>
      ) : (
        <PlanZoom />
      )}
    </div>
  );
}

function PlanZoom() {
  const zoom = useZoomPercent();
  return (
    <>
      <IconButton label="Zoom out" shortcut="−" tooltipSide="top" onClick={() => toolController.zoomBy(1 / 1.25, true)}>
        <MinusIcon width={20} height={20} />
      </IconButton>
      <span className="zoom-readout" aria-live="polite" data-testid="zoom-readout">
        {zoom}%
      </span>
      <IconButton label="Zoom in" shortcut="+" tooltipSide="top" onClick={() => toolController.zoomBy(1.25, true)}>
        <PlusIcon width={20} height={20} />
      </IconButton>
      <span className="dock-divider" aria-hidden />
      <button type="button" className="btn btn-ghost dock-fit" data-tooltip="Show the whole plan  F" data-tooltip-side="top" onClick={() => toolController.fitPlan(true)} data-testid="fit-plan">
        <FitIcon width={18} height={18} /> Fit
      </button>
    </>
  );
}
