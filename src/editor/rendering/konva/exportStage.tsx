"use client";

import type { Stage } from "konva/lib/Stage";
import { createRoot } from "react-dom/client";
import { PlanStage, type PlanLook } from "./PlanStage";
import { spritesSettled } from "./sprites";
import { captureStage, planStageSize, type PlanImageOptions } from "./stageRegistry";
import { loadPlanSerif } from "./theme";

const frames = (n: number) => new Promise<void>((resolve) => {
  const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
  step(n);
});

/**
 * The plan as an image in a given look, whatever the view on screen: the
 * plain plan image is always the schematic plan, the presentation image
 * always the furnished plan in its garden. A second plan stage is drawn off
 * screen at the same size and framing as the one on screen (so crops in
 * screen pixels still fit), captured, and taken down again.
 *
 *   screen stage ─ size, viewport ─▶ hidden <PlanStage look> ─ fonts, pictures, 2 frames ─▶ PNG
 */
export async function exportPlanLook(look: PlanLook, options: PlanImageOptions = {}): Promise<string | null> {
  const size = planStageSize();
  if (!size || typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-${size.width + 100}px;top:0;width:${size.width}px;height:${size.height}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  let stage: Stage | null = null;
  try {
    root.render(<PlanStage width={size.width} height={size.height} look={look} onStage={(s) => (stage = s)} />);
    await Promise.all([document.fonts?.ready, loadPlanSerif()]);
    if (look === "furnished") await spritesSettled();
    await frames(2);
    return stage ? captureStage(stage, options) : null;
  } finally {
    root.unmount();
    host.remove();
  }
}
