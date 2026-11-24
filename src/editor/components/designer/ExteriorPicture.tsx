"use client";

import type { Level, PlanDocument } from "@/domain/plan/types";
import { useRenders } from "../../state/editor";
import { useLook } from "./RoomGallery";
import { useStill } from "./useStill";

/** The house from the garden: its photo render if there is one, else the 3D view. Nothing at all when 3D can't be drawn. */
export function ExteriorPicture({ planId, level, size = { width: 640, height: 360 }, badge = true, className }: { planId: string; level: Level | PlanDocument; size?: { width: number; height: number }; badge?: boolean; className?: string }) {
  const { appearance } = useLook();
  const photo = useRenders((s) => s.byPlan[planId]?.exterior);
  const { ref, url } = useStill(level, { kind: "exterior" }, size, appearance);
  const src = photo?.url ?? url;
  if (url === null && !photo) return null;
  return (
    <div className={`exterior-picture${className ? ` ${className}` : ""}`} ref={ref} data-testid="exterior-picture">
      {/* eslint-disable-next-line @next/next/no-img-element -- object and data URLs made in the browser */}
      {src ? <img src={src} alt="The house from the garden" /> : <span className="photo-empty">Drawing…</span>}
      {badge && <span className="photo-badge">{photo ? "Photo render" : "3D view"}</span>}
    </div>
  );
}
