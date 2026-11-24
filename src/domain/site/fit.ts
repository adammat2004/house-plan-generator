import type { PlotLimits } from "../design/footprint";
import { analyzeEnvelope } from "../geometry/envelope";
import type { MultiPolygon, Ring } from "../geometry/polygons";
import type { Rect } from "../geometry/vector";
import type { PlanDocument } from "../plan/types";
import type { Setbacks, Site } from "../project/site";
import { buildableArea, centredOn, contains, crossedEdges, fromFrame, largestRect, outsideSite, placeHouse, placeRing, plotLimits, siteFrame, toFrame, type Cutout, type Placement, type SiteEdgeInfo, type SiteFrame } from "./buildable";
import { checkBand, fromGrid, toGrid } from "./geo";
import type { ExportGrid, LonLat } from "../project/site";

/**
 * What the planners need from a traced site: where a house may go (in the
 * site's frame, road to the south, as the planners lay houses out) and where
 * the last house was put. Layouts that fit nowhere are dropped before the
 * best few are picked, so a site never quietly gets fewer layouts.
 */
export interface SiteFit {
  area: MultiPolygon;
  rect: Rect | null;
  previous?: Placement;
}

export interface TracedSiteSummary {
  frame: SiteFrame;
  fit: SiteFit;
  /** The planners' size limits: the largest rectangle less the check band. Null when nothing fits. */
  limits: PlotLimits | null;
}

/** How far the house keeps from the wastewater area until the rule pack says, m. */
export const DEFAULT_WASTEWATER_DISTANCE = 10;

/** The traced site worked out: its frame, buildable area and limits. Null without a traced site. */
export function tracedSite(site: Site | undefined, pack: Partial<Setbacks> & { wastewater?: number } = {}): TracedSiteSummary | null {
  const traced = site?.traced;
  if (!site || !traced) return null;
  const frame = siteFrame(traced, site.setbacks, pack);
  const cutouts: Cutout[] = traced.wastewater
    ? [{ ring: traced.wastewater.map((p) => toFrame(frame, toGrid(p, traced.exportGrid))), distance: pack.wastewater ?? DEFAULT_WASTEWATER_DISTANCE }]
    : [];
  const area = buildableArea(frame, cutouts);
  const rect = largestRect(area);
  return {
    frame,
    fit: { area, rect, ...(traced.placement ? { previous: traced.placement } : {}) },
    limits: rect ? plotLimits(rect, checkBand(traced.imagery)) : null,
  };
}

/** A plan's ground floor as it stands on the ground: its outside faces. */
export function houseRing(document: PlanDocument): Ring | null {
  const ground = document.levels[0];
  const env = ground ? analyzeEnvelope(ground) : null;
  return env?.ok ? env.info.outsideRing : null;
}

/**
 * The candidates that fit on the site, each with where it goes. Without a
 * site every candidate is kept as it was.
 */
export function fitToSite<T extends { document: PlanDocument }>(candidates: readonly T[], fit: SiteFit | undefined): (T & { placement?: Placement })[] {
  if (!fit) return [...candidates];
  const out: (T & { placement: Placement })[] = [];
  for (const c of candidates) {
    const ring = houseRing(c.document);
    const placed = ring && placeHouse(fit.area, ring, fit.previous, fit.rect);
    if (placed) out.push({ ...c, placement: placed.placement });
  }
  return out;
}

export interface OwnHousePlacement {
  placement: Placement;
  /** Whether the house fits in the buildable area where it stands. */
  fits: boolean;
  /** The gaps it reaches into, to name in its results. */
  crossed: SiteEdgeInfo[];
  /** Whether it reaches past the site's boundary. */
  outside: boolean;
}

/**
 * A house the user drew themselves, on the site. It's never dropped or
 * resized: it goes where the last one was, else where it fits, else centred
 * on the site, and the gaps it reaches into are named.
 */
export function placeOwnHouse(summary: TracedSiteSummary, document: PlanDocument): OwnHousePlacement | null {
  const ring = houseRing(document);
  if (!ring) return null;
  const { frame, fit } = summary;
  const placed = placeHouse(fit.area, ring, fit.previous, fit.rect);
  const fallback = () => {
    const box = frame.ring.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    return centredOn(ring, { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
  };
  const placement = placed?.placement ?? fit.previous ?? fallback();
  const house = placeRing(ring, placement);
  return { placement, fits: contains(fit.area, house), crossed: crossedEdges(frame, house), outside: outsideSite(frame, house) };
}

/** What to say when no layout fits on the site at all. */
export const NOTHING_FITS_ON_SITE = "None of the layouts fit on your site between its gaps. Make a gap smaller, take out a room, or try fewer storeys.";

/** A ring in the site's own frame, back to longitude and latitude, for drawing on the map. */
export function frameRingToLonLat(frame: Pick<SiteFrame, "origin" | "rotation">, ring: Ring, grid: ExportGrid): LonLat[] {
  return ring.map((p) => fromGrid(fromFrame(frame, p), grid));
}

/**
 * The visual anchor (design review 6A): the buildable area and the room for
 * a house (the largest rectangle, full size — not shrunk by the check band,
 * since this is what to show, not what to build to), in longitude and
 * latitude, ready to draw on the map.
 */
export interface SiteAnchor {
  buildable: LonLat[][];
  house: LonLat[] | null;
  /** Outside dimensions of the room for a house, m, rounded to the nearest 0.1. */
  houseSize: { width: number; depth: number } | null;
}

export function siteAnchor(summary: TracedSiteSummary, grid: ExportGrid): SiteAnchor {
  const { frame, fit } = summary;
  const rect = fit.rect;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    buildable: fit.area.map((p) => frameRingToLonLat(frame, p.outer, grid)),
    house: rect ? frameRingToLonLat(frame, [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }], grid) : null,
    houseSize: rect ? { width: round(rect.maxX - rect.minX), depth: round(rect.maxY - rect.minY) } : null,
  };
}
