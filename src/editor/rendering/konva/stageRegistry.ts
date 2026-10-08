import type { Stage } from "konva/lib/Stage";

/** The mounted Konva stage, so chrome outside the canvas can export it. */
let current: Stage | null = null;

export function registerStage(stage: Stage | null) {
  current = stage;
}

/**
 * Renders the plan as it is currently framed to a PNG data URL. Transient
 * overlays (selection, handles, snaps, drafts) are hidden for the capture.
 */
export function exportPlanImage(pixelRatio = 2): string | null {
  if (!current) return null;
  const transient = current.find(".transient");
  transient.forEach((node) => node.hide());
  try {
    return current.toDataURL({ pixelRatio, mimeType: "image/png" });
  } finally {
    transient.forEach((node) => node.show());
    current.batchDraw();
  }
}
