import { isStoreyLayout, storeyTitle } from "../storeyLayouts";
import { WING_TITLE, wingArrangementOf } from "../wingPlanner";
import { DIRECT_TITLE, isDirectZone, isSplitZone, isZoneLayout, SPLIT_TITLE, ZONE_TITLE, zoneFamily } from "../zoneLayouts";
import { ARRANGEMENTS } from "../zoning";

/**
 * What a layout's arrangement id means, in one place (roadmap M3): which
 * strategy drew it, the family it belongs to for variety and "Show
 * similar", whether the front door opens into the living spaces, and its
 * card title. Ids are kept in project files, so they never change; this
 * reads them instead of each caller testing the string.
 */

export type StrategyId = "zones" | "split" | "wings" | "storeys" | "strip";

export interface ConceptDescriptor {
  strategy: StrategyId;
  /** Layouts of one family are variations of one idea: mirrored, resized, or with rooms swapped. */
  family: string;
  /** The front door opens into the living spaces, with no entrance hall. */
  direct: boolean;
  title: string | null;
}

const STRIP_TITLE: Record<string, string> = Object.fromEntries(ARRANGEMENTS.map((a) => [a.id, a.title]));

/** The concept behind an arrangement id; null for one no planner gives (a plan someone drew). */
export function conceptOf(arrangement: string | undefined): ConceptDescriptor | null {
  if (!arrangement) return null;
  const id = arrangement.split("@")[0];
  if (isZoneLayout(id)) {
    const split = isSplitZone(id);
    const direct = isDirectZone(id);
    return { strategy: split ? "split" : "zones", family: zoneFamily(id), direct, title: split ? SPLIT_TITLE : direct ? DIRECT_TITLE : ZONE_TITLE };
  }
  if (isStoreyLayout(id)) return { strategy: "storeys", family: id, direct: false, title: storeyTitle(id) };
  const wing = wingArrangementOf(id);
  if (wing) return { strategy: "wings", family: `wings-${wing}`, direct: false, title: WING_TITLE[wing] };
  if (STRIP_TITLE[id]) return { strategy: "strip", family: `strip-${id}`, direct: false, title: STRIP_TITLE[id] };
  return null;
}

const zoned = (c: ConceptDescriptor | null) => !!c && (c.strategy === "zones" || c.strategy === "split");

/** Whether a layout is like the one "Show similar" started from: a zone layout of the same family, or, for any other base, a layout that isn't a zone layout. */
export function likeBase(arrangement: string | undefined, base: string): boolean {
  const c = conceptOf(arrangement);
  const b = conceptOf(base);
  return zoned(b) ? zoned(c) && c!.family === b!.family : !zoned(c);
}
