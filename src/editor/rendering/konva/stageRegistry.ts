import type { Stage } from "konva/lib/Stage";

/** The mounted Konva stage, so chrome outside the canvas can export it. */
let current: Stage | null = null;

export function registerStage(stage: Stage | null) {
  current = stage;
}

export interface PlanImageOptions {
  pixelRatio?: number;
  /** The part of the stage to capture, in stage pixels; it may reach past what's on screen. */
  crop?: { x: number; y: number; width: number; height: number };
  /** With the garden, and without the drafting grid and the screen's paper (the caller lays its own page). */
  presentation?: boolean;
}

/**
 * Renders the plan to a PNG data URL, as framed on screen unless cropped.
 * Transient overlays (selection, handles, snaps, drafts) are hidden for the
 * capture, and the garden too unless it's a presentation.
 */
export function exportPlanImage({ pixelRatio = 2, crop, presentation = false }: PlanImageOptions = {}): string | null {
  if (!current) return null;
  const hidden = (presentation ? [".transient", ".grid", ".paper"] : [".transient", ".garden"]).flatMap((name) => current!.find(name));
  hidden.forEach((node) => node.hide());
  try {
    return current.toDataURL({ pixelRatio, mimeType: "image/png", ...(crop ?? {}) });
  } finally {
    hidden.forEach((node) => node.show());
    current.batchDraw();
  }
}
