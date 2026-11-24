import type { Stage } from "konva/lib/Stage";

/** The mounted Konva stage, so chrome outside the canvas can export it. */
let current: Stage | null = null;

export function registerStage(stage: Stage | null) {
  current = stage;
}

/** How many pieces the plan draws from the asset library's pictures (for tests). */
export function planSpriteCount(): number {
  return current?.find(".furniture-sprite").length ?? 0;
}

export interface PlanImageOptions {
  pixelRatio?: number;
  /** The part of the stage to capture, in stage pixels; it may reach past what's on screen. */
  crop?: { x: number; y: number; width: number; height: number };
  /** With the garden, and without the drafting grid and the screen's paper (the caller lays its own page). */
  presentation?: boolean;
}

/** The size of the plan on screen, px, for drawing an export at the same framing. */
export function planStageSize(): { width: number; height: number } | null {
  return current ? { width: current.width(), height: current.height() } : null;
}

/**
 * A stage as a PNG data URL, as framed on screen unless cropped. Transient
 * overlays (selection, handles, snaps, drafts) are hidden for the capture,
 * and the garden too unless it's a presentation.
 */
export function captureStage(stage: Stage, { pixelRatio = 2, crop, presentation = false }: PlanImageOptions = {}): string {
  const hidden = (presentation ? [".transient", ".grid", ".paper"] : [".transient", ".garden"]).flatMap((name) => stage.find(name));
  hidden.forEach((node) => node.hide());
  try {
    return stage.toDataURL({ pixelRatio, mimeType: "image/png", ...(crop ?? {}) });
  } finally {
    hidden.forEach((node) => node.show());
    stage.batchDraw();
  }
}
