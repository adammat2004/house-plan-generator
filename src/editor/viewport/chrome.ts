import type { Insets } from "./viewport";

/** Clear space kept between the plan and the floating chrome, px. */
export const CHROME_MARGIN = 24;

/**
 * Space the floating chrome covers along each edge of the plan canvas,
 * measured from the elements marked `data-chrome="left|right|top|bottom"`,
 * plus a margin. Fitting keeps the plan inside what's left, so the plan
 * always uses the space the panels actually leave, at any window size.
 * `data-chrome-min="340"` reserves that much width even while the element is
 * narrower or empty (the inspector appears only once something is selected,
 * and shouldn't land on the plan when it does).
 *
 *   ┌──────────── canvas ─────────────┐
 *   │ [top: breadcrumb]               │   left   = rail / catalog right edge
 *   │ [left]   ┌── plan ──┐   [right] │   right  = side panel left edge
 *   │ [ rail ] │          │   [panel] │   top    = breadcrumb bottom edge
 *   │          └──────────┘           │   bottom = dock top edge
 *   │        [bottom: dock]           │   hidden (0×0) or off-canvas: ignored
 *   └─────────────────────────────────┘
 */
export function chromeInsets(canvas: Element | null, margin = CHROME_MARGIN): Insets {
  const out = { top: margin, right: margin, bottom: margin, left: margin };
  if (!canvas || typeof document === "undefined") return out;
  const c = canvas.getBoundingClientRect();
  for (const el of document.querySelectorAll<HTMLElement>("[data-chrome]")) {
    const box = el.getBoundingClientRect();
    const min = Number(el.dataset.chromeMin ?? 0);
    if ((box.width === 0 && !min) || box.height === 0) continue;
    const width = Math.max(box.width, min);
    // Reserved width grows away from the edge the element is anchored to.
    const r = el.dataset.chrome === "right" ? { left: box.right - width, right: box.right, top: box.top, bottom: box.bottom } : { left: box.left, right: box.left + width, top: box.top, bottom: box.bottom };
    if (r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) continue;
    switch (el.dataset.chrome) {
      case "left":
        out.left = Math.max(out.left, r.right - c.left + margin);
        break;
      case "right":
        out.right = Math.max(out.right, c.right - r.left + margin);
        break;
      case "top":
        out.top = Math.max(out.top, r.bottom - c.top + margin);
        break;
      case "bottom":
        out.bottom = Math.max(out.bottom, c.bottom - r.top + margin);
        break;
    }
  }
  return out;
}

