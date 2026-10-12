import { z } from "zod";
import type { PlotLimits } from "../design/footprint";
import type { EnvelopeSide } from "../geometry/envelope";
import type { Rect } from "../geometry/vector";

/**
 * The house's site, kept light: the plot's width (along the street) and
 * depth (from the street to the back), the gaps to leave at the front, each
 * side and the back, and which way north is. Every part is optional but the
 * gaps: a plot can be measured one way only, and north set later.
 *
 * The plot never turns the plan: its street edge is opposite the garden side
 * (the floor's rear wall), wherever that is.
 */
export const siteSchema = z.object({
  plot: z.object({ width: z.number().min(4).max(400).optional(), depth: z.number().min(4).max(400).optional() }).optional(),
  setbacks: z.object({ front: z.number().min(0).max(100), side: z.number().min(0).max(50), rear: z.number().min(0).max(100) }),
  /** Degrees clockwise from straight up the plan to north. */
  north: z.number().min(0).lt(360).optional(),
});

export type Site = z.infer<typeof siteSchema>;
export type Setbacks = Site["setbacks"];

/** Typical of a suburban plot in Ireland or the UK: a front garden, a gap each side, a long back garden. */
export const DEFAULT_SETBACKS: Setbacks = { front: 6, side: 1, rear: 11 };

/** North in steps of this many degrees. */
export const NORTH_STEP = 15;

const round = (v: number) => Math.round(v * 100) / 100;

/** The limits planners take, m (plotSchema): below the least no house fits anyway. */
const LIMIT = { min: 4, max: 200 } as const;

/**
 * The largest house the site allows, as the planners take it: the plot less
 * its gaps. Nothing for a dimension the plot doesn't give. A site with too
 * little room left still limits, to the least planners take, so no layout
 * is planned on it and the user is told why.
 */
export function buildableLimits(site: Site | undefined): PlotLimits | undefined {
  const plot = site?.plot;
  if (!plot || (!plot.width && !plot.depth)) return undefined;
  const { front, side, rear } = site.setbacks;
  const clamp = (v: number) => Math.min(LIMIT.max, Math.max(LIMIT.min, round(v)));
  return {
    ...(plot.width ? { maxWidth: clamp(plot.width - 2 * side) } : {}),
    ...(plot.depth ? { maxDepth: clamp(plot.depth - front - rear) } : {}),
  };
}

/** Where generated layouts get their size limit: the site, if one has been set, else the old house limits. */
export function generationPlot(project: { site?: Site; sizing?: { plot?: PlotLimits } }): PlotLimits | undefined {
  return project.site ? buildableLimits(project.site) : project.sizing?.plot;
}

/** A site to start from, which leaves exactly the room the old house limits did. */
export function siteFromLimits(plot: PlotLimits | undefined, setbacks: Setbacks = DEFAULT_SETBACKS): Site {
  const width = plot?.maxWidth ? round(plot.maxWidth + 2 * setbacks.side) : undefined;
  const depth = plot?.maxDepth ? round(plot.maxDepth + setbacks.front + setbacks.rear) : undefined;
  return { setbacks, ...(width || depth ? { plot: { ...(width ? { width } : {}), ...(depth ? { depth } : {}) } } : {}) };
}

const horizontal = (side: EnvelopeSide) => side === "north" || side === "south";

/** The house's size along the street and from the street back, for a garden side. */
export function houseOnPlot(house: Rect, rear: EnvelopeSide): { width: number; depth: number } {
  const [w, d] = [house.maxX - house.minX, house.maxY - house.minY];
  return horizontal(rear) ? { width: w, depth: d } : { width: d, depth: w };
}

/**
 * The plot in plan coordinates: its street edge the front gap out from the
 * house's street face, its middle across the street in line with the house.
 * A dimension the plot doesn't give is the house's plus its gaps. Null with
 * no plot at all.
 */
export function sitePlot(house: Rect, rear: EnvelopeSide, site: Site | undefined): Rect | null {
  const plot = site?.plot;
  if (!site || !plot || (!plot.width && !plot.depth)) return null;
  const size = houseOnPlot(house, rear);
  const { front, side, rear: back } = site.setbacks;
  const width = plot.width ?? size.width + 2 * side;
  const depth = plot.depth ?? size.depth + front + back;
  const cx = (house.minX + house.maxX) / 2;
  const cy = (house.minY + house.maxY) / 2;
  switch (rear) {
    case "north": {
      const street = house.minY - front;
      return { minX: cx - width / 2, maxX: cx + width / 2, minY: street, maxY: street + depth };
    }
    case "south": {
      const street = house.maxY + front;
      return { minX: cx - width / 2, maxX: cx + width / 2, minY: street - depth, maxY: street };
    }
    case "east": {
      const street = house.minX - front;
      return { minX: street, maxX: street + depth, minY: cy - width / 2, maxY: cy + width / 2 };
    }
    case "west": {
      const street = house.maxX + front;
      return { minX: street - depth, maxX: street, minY: cy - width / 2, maxY: cy + width / 2 };
    }
  }
}

/** Where the house may go on the plot: the plot less its gaps, in plan coordinates. */
export function buildableRect(plot: Rect, rear: EnvelopeSide, s: Setbacks): Rect {
  switch (rear) {
    case "north":
      return { minX: plot.minX + s.side, maxX: plot.maxX - s.side, minY: plot.minY + s.front, maxY: plot.maxY - s.rear };
    case "south":
      return { minX: plot.minX + s.side, maxX: plot.maxX - s.side, minY: plot.minY + s.rear, maxY: plot.maxY - s.front };
    case "east":
      return { minX: plot.minX + s.front, maxX: plot.maxX - s.rear, minY: plot.minY + s.side, maxY: plot.maxY - s.side };
    case "west":
      return { minX: plot.minX + s.rear, maxX: plot.maxX - s.front, minY: plot.minY + s.side, maxY: plot.maxY - s.side };
  }
}

const m = (v: number) => `${round(v).toFixed(1).replace(/\.0$/, "")} m`;

/** What doesn't fit, in plain words: the house against the room the plot leaves. Empty when it fits. */
export function siteIssues(site: Site | undefined, house: { width: number; depth: number } | null): string[] {
  const plot = site?.plot;
  if (!site || !plot) return [];
  const { front, side, rear } = site.setbacks;
  const width = plot.width !== undefined ? plot.width - 2 * side : undefined;
  const depth = plot.depth !== undefined ? plot.depth - front - rear : undefined;
  const issues: string[] = [];
  if (width !== undefined && width < LIMIT.min) issues.push(width <= 0 ? "The side gaps take the plot's whole width." : `The side gaps leave only ${m(width)} of the plot's width to build on.`);
  else if (house && width !== undefined && house.width > width + 0.005) issues.push(`The house is ${m(house.width)} wide; the plot leaves ${m(width)} between the side gaps.`);
  if (depth !== undefined && depth < LIMIT.min) issues.push(depth <= 0 ? "The front and back gardens take the plot's whole depth." : `The front and back gardens leave only ${m(depth)} of the plot's depth to build on.`);
  else if (house && depth !== undefined && house.depth > depth + 0.005) issues.push(`The house is ${m(house.depth)} deep; the plot leaves ${m(depth)} between the front and back gardens.`);
  return issues;
}

const WINDS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;

/** A compass bearing in words, to the nearest of eight. */
export function bearingWord(bearing: number): (typeof WINDS)[number] {
  return WINDS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

const SIDE_ANGLE: Record<EnvelopeSide, number> = { north: 0, east: 90, south: 180, west: 270 };

/** Which way a side of the plan really faces, once north is set: up the plan is `north` degrees anticlockwise of north. */
export function facing(side: EnvelopeSide, north: number): (typeof WINDS)[number] {
  return bearingWord(SIDE_ANGLE[side] - north);
}

/** A length typed for the site, in metres: a number, undefined when left blank, or "invalid". */
export function parseSiteLength(text: string, min: number, max: number): number | undefined | "invalid" {
  if (!text.trim()) return undefined;
  const v = Number(text.trim().replace(",", "."));
  return Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 100) / 100 : "invalid";
}

/** North turned by a number of steps, kept between 0 and 360. */
export function turnNorth(north: number | undefined, steps: number): number {
  return (((north ?? 0) + steps * NORTH_STEP) % 360 + 360) % 360;
}
