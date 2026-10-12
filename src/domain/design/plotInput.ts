import type { PlotLimits } from "./footprint";

/** The plot sizes people can type, in metres. */
export const PLOT_LIMITS = { min: 5, max: 60 } as const;

/** A plot limit typed in metres: a number, undefined when left blank, or "invalid". */
export function parsePlot(text: string): number | undefined | "invalid" {
  if (!text.trim()) return undefined;
  const v = Number(text.trim());
  return Number.isFinite(v) && v >= PLOT_LIMITS.min && v <= PLOT_LIMITS.max ? v : "invalid";
}

/** Typed plot width and depth as limits for sizing houses, or why they can't be used. */
export function plotFromText(width: string, depth: string): { ok: true; value?: PlotLimits } | { ok: false; error: string } {
  const maxWidth = parsePlot(width);
  const maxDepth = parsePlot(depth);
  if (maxWidth === "invalid" || maxDepth === "invalid") return { ok: false, error: `Plot sizes must be between ${PLOT_LIMITS.min} and ${PLOT_LIMITS.max} m.` };
  return { ok: true, value: maxWidth || maxDepth ? { ...(maxWidth ? { maxWidth } : {}), ...(maxDepth ? { maxDepth } : {}) } : undefined };
}
