"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { editor, editorStores, useSessionState } from "../../state/editor";
import { registerViewer } from "./registry";
import { HouseViewer, type ViewerState } from "./viewer";

/** Current store state, as the viewer needs it. */
function viewerState(): ViewerState {
  const s = editorStores.session.getState();
  const v = s.view3d;
  return {
    level: editorStores.documents.getState().history.present.levels[0],
    display: { roof: v.display.roof, cutaway: v.display.cutaway, dimensions: v.display.dimensions, landscape: v.display.landscape },
    appearance: editorStores.project.getState().appearance ?? DEFAULT_APPEARANCE,
    lighting: v.lighting,
    shadows: v.shadows,
    sunAzimuth: v.sunAzimuth,
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
  const [failed, setFailed] = useState<string | null>(null);
  const camera = useSessionState((s) => s.view3d.camera);
  const cameraKey = useSessionState((s) => s.view3d.cameraKey);
  const interiorRoomId = useSessionState((s) => s.view3d.interiorRoomId);
  const panelOpen = useSessionState((s) => s.view3d.panelOpen);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let v: HouseViewer;
    try {
      v = new HouseViewer(el, (roomId) => editor.select(roomId ? { kind: "room", id: roomId } : null));
    } catch (error) {
      // No WebGL (old browser, disabled GPU): explain rather than break the editor.
      queueMicrotask(() => setFailed((error as Error).message || "WebGL isn't available."));
      return;
    }
    viewer.current = v;
    v.update(viewerState());
    registerViewer(v);
    const sync = () => v.update(viewerState());
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
    viewer.current?.setActive(active);
    if (active) viewer.current?.resize();
  }, [active]);

  useEffect(() => {
    viewer.current?.setCamera(camera, interiorRoomId);
  }, [camera, cameraKey, interiorRoomId]);

  useEffect(() => {
    // The settings panel floats over the right of the view.
    viewer.current?.setInsetRight(panelOpen ? 330 : 0);
  }, [panelOpen]);

  if (failed) {
    return (
      <div className="three-host three-failed" role="alert" data-testid="three-unavailable">
        <strong>3D isn&rsquo;t available in this browser</strong>
        <span>The 3D view needs WebGL. Check that hardware acceleration is turned on, or try another browser.</span>
      </div>
    );
  }
  return <div ref={host} className="three-host" data-testid="three-view" aria-label="3D view of the house. Drag to orbit, scroll to zoom; in Walk, use the arrow or WASD keys." role="img" />;
}
