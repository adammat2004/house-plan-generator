import { COLOR } from "@/design/tokens";
import { PLAN_THEME as T } from "./konva/theme";

/**
 * The presentation image: the plan in its garden, as captured from the
 * stage, laid on a page with a title block and a scale bar along the
 * bottom. Everything is in the picture's own pixels.
 */

const BAR_LENGTHS = [1, 2, 5, 10, 20, 50, 100];

/** A round length for a scale bar about `target` pixels long, m. */
export function scaleBarLength(metresPerPixel: number, target: number): number {
  const want = metresPerPixel * target;
  return BAR_LENGTHS.reduce((best, l) => (Math.abs(Math.log(l / want)) < Math.abs(Math.log(best / want)) ? l : best));
}

let serif: string | null = null;

/** The title face (Newsreader), from the --font-serif token once it's on the page. */
function serifFont(): string {
  if (serif) return serif;
  const value = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--font-serif").trim();
  serif = value || "Georgia, serif";
  return serif;
}

export interface PresentationInfo {
  title: string;
  /** Size, rooms, floor and date, on one line. */
  subtitle: string;
  /** How many metres one pixel of the picture covers. */
  metresPerPixel: number;
}

export function composePresentation(image: CanvasImageSource & { width: number; height: number }, info: PresentationInfo): HTMLCanvasElement | null {
  const W = image.width;
  const H = image.height;
  // Sizes below are for a picture 1200 px wide, scaled to this one.
  const u = W / 1200;
  const band = Math.round(104 * u);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H + band;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = COLOR.canvas;
  g.fillRect(0, 0, W, H + band);
  g.drawImage(image, 0, 0);

  g.fillStyle = COLOR.surface;
  g.fillRect(0, H, W, band);
  g.fillStyle = COLOR.line;
  g.fillRect(0, H, W, Math.max(1, Math.round(u)));

  const pad = 32 * u;
  const room = W - 2 * pad - 260 * u;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.fillStyle = COLOR.ink;
  g.font = `400 ${30 * u}px ${serifFont()}`;
  g.fillText(info.title, pad, H + 50 * u, room);
  g.fillStyle = COLOR["ink-2"];
  g.font = `400 ${15 * u}px ${T.fontFamily}`;
  g.fillText(info.subtitle, pad, H + 78 * u, room);

  // The scale bar, in five alternating parts, at the right.
  const metres = scaleBarLength(info.metresPerPixel, 200 * u);
  const length = metres / info.metresPerPixel;
  const x1 = W - pad;
  const x0 = x1 - length;
  const y = H + 40 * u;
  const h = 8 * u;
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? COLOR.surface : COLOR.ink;
    g.fillRect(x0 + (length / 5) * i, y, length / 5, h);
  }
  g.strokeStyle = COLOR.ink;
  g.lineWidth = Math.max(1, u);
  g.strokeRect(x0, y, length, h);
  g.fillStyle = COLOR["ink-2"];
  g.font = `500 ${12 * u}px ${T.fontFamily}`;
  g.textAlign = "left";
  g.fillText("0", x0, y + h + 18 * u);
  g.textAlign = "right";
  g.fillText(`${metres} m`, x1, y + h + 18 * u);
  return canvas;
}
