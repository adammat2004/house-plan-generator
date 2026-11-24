import proj4 from "proj4";
import type { Point2 } from "../plan/types";
import type { ExportGrid, LonLat } from "../project/site";

/**
 * Between the map's longitude and latitude and metres on the ground. A
 * traced site is kept in WGS84, as the map gives it; everything measured on
 * it (gaps, areas, where the house goes) is worked out in its export grid,
 * which for Ireland is Irish Transverse Mercator. Metres here are easting
 * and northing, so north is +y, as on the plan.
 */

const GRIDS: Record<ExportGrid, string> = {
  // IRENET95 / Irish Transverse Mercator (EPSG:2157).
  "EPSG:2157": "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
};

const WGS84 = "EPSG:4326";

/** A longitude and latitude in metres on the grid: easting as x, northing as y. */
export function toGrid(point: LonLat, grid: ExportGrid): Point2 {
  const [x, y] = proj4(WGS84, GRIDS[grid], [point[0], point[1]]);
  return { x, y };
}

/** Metres on the grid back to longitude and latitude. */
export function fromGrid(point: Point2, grid: ExportGrid): LonLat {
  const [lon, lat] = proj4(GRIDS[grid], WGS84, [point.x, point.y]);
  return [lon, lat];
}

/**
 * How far off a corner traced on each kind of imagery can be, metres: a
 * distance this near a rule's limit is "close, check on site", never met or
 * not met. Set from the imagery's checked accuracy in Ireland; until it has
 * been checked against known points, the default stands.
 */
export const CHECK_BAND: Readonly<Record<string, number>> = {};
export const DEFAULT_CHECK_BAND = 2;

/** The band for a site traced on this imagery. */
export function checkBand(imagery: string | undefined): number {
  return (imagery && CHECK_BAND[imagery]) || DEFAULT_CHECK_BAND;
}
