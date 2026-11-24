import { BRIEF_PRESETS, pickedBathrooms, pickedBedrooms } from "../brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief, type HouseShape } from "../brief/schema";
import { createPlanDocument } from "../commands/factory";
import { assessHouse } from "../design/analysis";
import { planLayouts } from "../design/stripPlanner";
import type { PlanDocument } from "../plan/types";
import { EXTERIOR_STYLES, type Appearance, type ExteriorStyle } from "./schema";

/**
 * The house-plan catalogue: a fixed set of named houses, each a starting
 * brief (a room preset), a shape and a number of storeys, with an exterior
 * style. Plans are laid out by the same planner as Create, one entry at a
 * time when asked for, so the list itself costs nothing to build.
 */

export interface CatalogueEntry {
  id: string;
  name: string;
  description: string;
  brief: HouseBrief;
  shape: Exclude<HouseShape, "any">;
  storeys: 1 | 2;
  style: ExteriorStyle;
  bedrooms: number;
  bathrooms: number;
}

const SHAPES: ReadonlyArray<CatalogueEntry["shape"]> = ["rectangle", "L", "T", "U"];
const SHAPE_WORDS: Record<CatalogueEntry["shape"], string> = { rectangle: "a simple rectangle", L: "an L", T: "a T", U: "a U around a courtyard garden" };

/** House names, one per entry in order. */
const NAMES = [
  "Ashford", "Birchwood", "Clover Hill", "Dunmore", "Elm Grove", "Fernbank", "Glenview", "Hazel Lane",
  "Ivy Lodge", "Juniper", "Kilbride", "Larchfield", "Meadowbank", "Northgate", "Oakdene", "Primrose",
  "Quarry Lane", "Rowan", "Seaview", "Thornfield", "Upton", "Valley Rise", "Willowbrook", "Yewtree",
  "Alder", "Brookside", "Cedar Lodge", "Drumlin", "Eskerview", "Foxglove", "Greenfield", "Heathercroft",
  "Inishmore", "Juniper Ridge", "Knockmore", "Lisheen", "Millbrook", "Newgrange", "Orchard House", "Parklands",
  "Riverbank", "Sallygap", "Tullagh", "Uplands", "Veronica", "Westwood", "Yarrow", "Ballyvale",
];

/** Every house in the catalogue, in a fixed order. */
export const CATALOGUE: readonly CatalogueEntry[] = BRIEF_PRESETS.flatMap((preset, p) =>
  SHAPES.flatMap((shape, s) =>
    ([1, 2] as const).flatMap((storeys) => {
      // A one-bedroom annexe doesn't go upstairs.
      if (storeys === 2 && pickedBedrooms(preset.picks) < 2) return [];
      const i = p * SHAPES.length * 2 + s * 2 + (storeys - 1);
      const brief = withPicks({ ...DEFAULT_BRIEF, houseShape: shape, ...(storeys === 2 ? { storeys } : {}) }, preset.picks);
      return [
        {
          id: `${preset.id}-${shape.toLowerCase()}-${storeys}`,
          name: NAMES[i % NAMES.length],
          description: `${preset.label}: ${preset.description.toLowerCase()}, ${storeys === 2 ? "on two storeys" : "on one level"}, shaped as ${SHAPE_WORDS[shape]}.`,
          brief,
          shape,
          storeys,
          style: EXTERIOR_STYLES[i % EXTERIOR_STYLES.length],
          bedrooms: pickedBedrooms(preset.picks),
          bathrooms: pickedBathrooms(preset.picks),
        },
      ];
    }),
  ),
);

/** The look a catalogue house is shown and remixed in: gables suit the farmhouse and cottage styles, hips the rest. */
export function catalogueAppearance(entry: CatalogueEntry): Appearance {
  const gabled = entry.style === "farmhouse" || entry.style === "cottage" || entry.style === "scandinavian";
  return {
    exterior: entry.style === "scandinavian" ? "timber" : entry.style === "craftsman" ? "brick" : "white_render",
    frames: entry.style === "contemporary" ? "black" : entry.style === "farmhouse" ? "black" : "white",
    roof: entry.style === "mediterranean" ? "tile" : "slate",
    roofForm: gabled ? "gabled" : "hipped",
    exteriorStyle: entry.style,
  };
}

export interface CataloguePlan {
  plan: PlanDocument;
  area: number;
  width: number;
  depth: number;
}

const plans = new Map<string, CataloguePlan | null>();

/** A catalogue house laid out (once; later calls are cached). Null if its rooms don't fit its shape. */
export function cataloguePlan(entry: CatalogueEntry): CataloguePlan | null {
  if (plans.has(entry.id)) return plans.get(entry.id)!;
  const source = createPlanDocument({ id: `catalogue-${entry.id}`, width: 12, depth: 10 });
  const result = planLayouts({ intent: { action: "generate_layouts", brief: entry.brief, count: 1, footprint: "auto" }, source, brief: entry.brief, idPrefix: `cat-${entry.id}` });
  const plan = result.candidates[0]?.document;
  const a = plan ? assessHouse(plan) : null;
  const out = plan && a ? { plan, area: a.totalArea, width: a.outside?.width ?? 0, depth: a.outside?.depth ?? 0 } : null;
  plans.set(entry.id, out);
  return out;
}
