"use client";

import { useEffect, useRef, useState } from "react";
import type { Level, PlanDocument } from "@/domain/plan/types";
import type { Appearance } from "@/domain/project/schema";
import { planOf } from "./buildingModel";
import type { HouseModelOptions } from "./houseModel";
import { HouseViewer, type CameraMode, type Lighting } from "./viewer";

/**
 * A 3D view of any plan (or one floor of it), driven by props rather than
 * the editor's stores: the live preview beside the room picker shows a
 * layout that isn't saved yet.
 */
export interface LevelViewProps {
  level: Level | PlanDocument;
  display: HouseModelOptions;
  appearance: Appearance;
  lighting: Lighting;
  camera: CameraMode;
  /** Changing it reframes the camera (a different house, or the same camera asked for again). */
  cameraKey: string;
}

export default function LevelView({ level, display, appearance, lighting, camera, cameraKey }: LevelViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<HouseViewer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let v: HouseViewer;
    try {
      v = new HouseViewer(el, () => undefined);
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    viewer.current = v;
    const observer = new ResizeObserver(() => v.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      viewer.current = null;
      v.dispose();
    };
  }, []);

  useEffect(() => {
    viewer.current?.update({ plan: planOf(level), display, appearance, lighting, shadows: true, sunAzimuth: 0, ground: "lawn", sky: "clear", selectedRoomId: null });
  }, [level, display, appearance, lighting]);

  useEffect(() => {
    viewer.current?.setCamera(camera);
  }, [camera, cameraKey]);

  if (failed) {
    return (
      <div className="three-host three-failed" role="alert" data-testid="three-unavailable">
        <strong>3D isn&rsquo;t available in this browser</strong>
        <span>The plan view still shows the layout.</span>
      </div>
    );
  }
  return <div ref={host} className="three-host" data-testid="rooms-3d" aria-label="3D preview of the layout. Drag to orbit, scroll to zoom." role="img" />;
}
