"use client";

import { useEffect, useRef, useState } from "react";
import { assessHouse } from "@/domain/design/analysis";
import { levelOf, storeysWord } from "@/domain/plan/levels";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { editor, editorStores, useDocumentState, useSessionState } from "../../state/editor";
import { usePhoneLayout } from "../../components/shell/phone";
import { committedOrStaged } from "../../state/stores";
import { registerViewer } from "./registry";
import { HouseViewer, type ViewerState } from "./viewer";

/** Current store state, as the viewer needs it. */
function viewerState(): ViewerState {
  const s = editorStores.session.getState();
  const v = s.view3d;
  return {
    // An option on show is shown in 3D too; drags aren't (3D catches up when they're committed).
    plan: committedOrStaged(editorStores.documents.getState()),
    upTo: v.upTo,
    display: { roof: v.display.roof, cutaway: v.display.cutaway, dimensions: v.display.dimensions, landscape: v.display.landscape, furniture: v.display.furniture, site: editorStores.project.getState().site },
    appearance: editorStores.project.getState().appearance ?? DEFAULT_APPEARANCE,
    lighting: v.lighting,
    shadows: v.shadows,
    sunAzimuth: v.sunAzimuth,
    north: editorStores.project.getState().site?.north,
    ground: v.ground,
    sky: v.sky,
    selectedRoomId: s.selection?.kind === "room" ? s.selection.id : null,
  };
}

/**
 * Hosts the three.js viewer and keeps it in step with the plan, the
 * project's appearance and the 3D view settings. Clicking a floor selects
 * that room everywhere.
 */
export default function ThreeView({ active }: { active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<HouseViewer | null>(null);
  // While the plan is shown instead, the viewer waits: it catches up when it's shown again.
  const shown = useRef(active);
  const [failed, setFailed] = useState<string | null>(null);
  const camera = useSessionState((s) => s.view3d.camera);
  const cameraKey = useSessionState((s) => s.view3d.cameraKey);
  const interiorRoomId = useSessionState((s) => s.view3d.interiorRoomId);
  const panelOpen = useSessionState((s) => s.view3d.panelOpen);
  const phone = usePhoneLayout();
  // What a screen reader hears instead of the picture.
  const summary = useDocumentState((s) => {
    const a = assessHouse(s.history.present);
    return `A ${storeysWord(a.storeys ?? 1)} house of ${Math.round(a.totalArea)} m², with ${a.bedrooms} bedroom${a.bedrooms === 1 ? "" : "s"} and ${a.bathrooms} bathroom${a.bathrooms === 1 ? "" : "s"}, in 3D.`;
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let v: HouseViewer;
    try {
      v = new HouseViewer(el, (roomId) => {
        // A room picked in 3D is picked on the plan too, on its own floor.
        const level = roomId ? levelOf(editor.current(), roomId) : undefined;
        if (level) editor.setActiveLevel(level.id);
        editor.select(roomId ? { kind: "room", id: roomId } : null);
      });
    } catch (error) {
      // No WebGL (old browser, disabled GPU): explain rather than break the editor.
      queueMicrotask(() => setFailed((error as Error).message || "WebGL isn't available."));
      return;
    }
    viewer.current = v;
    v.update(viewerState());
    registerViewer(v);
    const sync = () => {
      if (shown.current) v.update(viewerState());
    };
    const unsubscribe = [editorStores.documents.subscribe(sync), editorStores.session.subscribe(sync), editorStores.project.subscribe(sync)];
    const observer = new ResizeObserver(() => v.resize());
    observer.observe(el);
    return () => {
      unsubscribe.forEach((u) => u());
      observer.disconnect();
      registerViewer(null);
      viewer.current = null;
      v.dispose();
    };
  }, []);

  useEffect(() => {
    shown.current = active;
    viewer.current?.setActive(active);
    if (active) {
      viewer.current?.update(viewerState());
      viewer.current?.resize();
    }
  }, [active]);

  useEffect(() => {
    viewer.current?.setCamera(camera, interiorRoomId);
  }, [camera, cameraKey, interiorRoomId]);

  useEffect(() => {
    // The settings panel floats over the left of the view: keep the house clear of it, measured as laid out
    // (its right edge plus the gutter). On phones it sits along the bottom instead.
    if (!panelOpen || phone) {
      viewer.current?.setInsets(0, 0);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>("[data-testid=present-panel]");
      const box = host.current?.getBoundingClientRect();
      const edge = panel?.getBoundingClientRect();
      const gutter = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gutter")) || 24;
      viewer.current?.setInsets(box && edge && edge.width ? Math.max(0, edge.right - box.left + gutter) : 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [panelOpen, phone]);

  if (failed) {
    return (
      <div className="three-host three-failed" role="alert" data-testid="three-unavailable">
        <strong>3D isn&rsquo;t available in this browser</strong>
        <span>It needs a newer browser, or graphics acceleration turned on in your browser&rsquo;s settings.</span>
        <button type="button" className="btn btn-secondary" onClick={() => editor.setShow3d(false)} data-testid="three-back-to-plan">
          Show the plan
        </button>
      </div>
    );
  }
  return <div ref={host} className="three-host" data-testid="three-view" aria-label={`${summary} Drag to orbit, scroll to zoom; in Walk, use the arrow or WASD keys.`} role="img" />;
}
