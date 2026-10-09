import type { Program, SpaceSpec } from "./program";

/**
 * How the strip planner divides a program between its two bands of rooms,
 * shared by the planner and by the footprint chooser so both size bands the
 * same way.
 */

export interface Arrangement {
  id: string;
  /** "depth": bands stacked front and rear; "width": bands side by side, hall running front to back. */
  split: "depth" | "width";
  /** Whether the day (living) band comes first: at the front, or on the left. */
  dayFirst: boolean;
  /** Reverse the order of rooms along each band. */
  reverse: boolean;
  /** Short name for the idea, e.g. on a concept card. */
  title: string;
  summary: string;
}

/** In the order offered: the first few are the most distinct from each other. */
export const ARRANGEMENTS: readonly Arrangement[] = [
  { id: "garden-living", split: "depth", dayFirst: false, reverse: false, title: "Living along the garden", summary: "Living spaces along the garden side, bedrooms to the front." },
  { id: "two-wings", split: "width", dayFirst: true, reverse: false, title: "Living and sleeping wings", summary: "Living and sleeping wings either side of a hall running front to back." },
  { id: "quiet-garden", split: "depth", dayFirst: true, reverse: false, title: "Bedrooms on the quiet side", summary: "Bedrooms on the quiet garden side, living spaces to the front." },
  { id: "two-wings-mirrored", split: "width", dayFirst: false, reverse: false, title: "Sleeping wing first", summary: "Sleeping wing on the entrance side, living wing opposite, hall between." },
  { id: "garden-living-reversed", split: "depth", dayFirst: false, reverse: true, title: "Garden living, mirrored", summary: "Living spaces along the garden side, bedrooms to the front, mirrored." },
  { id: "two-wings-reversed", split: "width", dayFirst: true, reverse: true, title: "Wings, garden rooms swapped", summary: "Living and sleeping wings either side of the hall, with the rooms in each wing reversed." },
  { id: "quiet-garden-reversed", split: "depth", dayFirst: true, reverse: true, title: "Quiet side, mirrored", summary: "Bedrooms on the quiet garden side, living spaces to the front, mirrored." },
  { id: "two-wings-mirrored-reversed", split: "width", dayFirst: false, reverse: true, title: "Sleeping wing first, mirrored", summary: "Sleeping wing on the entrance side with its rooms reversed, living wing opposite." },
];

/** Minimum depth of a band of rooms, m (wall centre to wall centre). */
export const MIN_BAND = 3;
/** Deepest a band gets before rooms read as corridors, m. */
export const MAX_BAND = 5.6;

export const hallWidthFor = (preferences: ReadonlySet<string>) => (preferences.has("accessible_layout") ? 1.5 : 1.2);

/** A band holding an ensuite needs room for it and a strip of bedroom beyond. */
export const minBandDepth = (spaces: SpaceSpec[]) => (spaces.some((s) => s.ensuite) ? MIN_BAND + 0.5 : MIN_BAND);

export const minSum = (spaces: SpaceSpec[]) => spaces.reduce((sum, s) => sum + s.minWidth, 0);

export interface Zoning {
  day: SpaceSpec[];
  night: SpaceSpec[];
  /** The band nearest the front (or left), then the other. */
  first: SpaceSpec[];
  second: SpaceSpec[];
  notes: string[];
}

/**
 * Splits the program into day and night bands in room order, moving
 * bedrooms into the day band if the night band is longer than the house.
 * Null when either band can't fit its rooms at their minimum widths.
 */
export function zoneProgram(program: Program, arrangement: Arrangement, bandLength: number): Zoning | null {
  const prefs = program.preferences;
  const notes: string[] = [];
  let day = program.spaces.filter((s) => s.zone === "day");
  let night = program.spaces.filter((s) => s.zone === "night");
  if (!day.length || !night.length) {
    const all = [...day, ...night];
    const half = Math.ceil(all.length / 2);
    [day, night] = [all.slice(0, half), all.slice(half)];
  }
  day = orderDay(day, arrangement, prefs);
  night = orderNight(night, arrangement, prefs);
  while (minSum(night) > bandLength + 1e-9) {
    const spill = [...night].reverse().find((s) => s.type === "bedroom");
    if (!spill) break;
    night = night.filter((s) => s !== spill);
    day = [...day, spill];
    notes.push(`${spill.name} sits with the living spaces to fit the footprint.`);
  }
  if (minSum(night) > bandLength + 1e-9 || minSum(day) > bandLength + 1e-9) return null;
  const [first, second] = arrangement.dayFirst ? [day, night] : [night, day];
  return { day, night, first, second, notes };
}

const isKitchen = (s: SpaceSpec) => s.type === "kitchen" || s.type === "kitchen_dining";

/**
 * Day rooms along their band. Depth split: living at the start. Width split
 * (band runs front → rear): the kitchen or the living room takes the garden end.
 */
function orderDay(spaces: SpaceSpec[], arrangement: Arrangement, prefs: ReadonlySet<string>): SpaceSpec[] {
  const rank = (s: SpaceSpec): number => {
    const kitchenAtGarden = prefs.has("kitchen_faces_garden");
    if (arrangement.split === "depth") {
      return ({ living: 0, dining: 1, kitchen_dining: 2, kitchen: 2, utility: 3, office: 4, garage: 5 } as Record<string, number>)[s.type] ?? 6;
    }
    const order = kitchenAtGarden
      ? { garage: 0, office: 1, living: 2, dining: 3, utility: 4, kitchen_dining: 5, kitchen: 5 }
      : { garage: 0, office: 1, utility: 2, kitchen: 3, kitchen_dining: 3, dining: 4, living: 5 };
    return (order as Record<string, number>)[s.type] ?? 6;
  };
  const sorted = [...spaces].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
  if (prefs.has("utility_near_kitchen")) {
    const utility = sorted.find((s) => s.type === "utility");
    const kitchen = sorted.find(isKitchen);
    if (utility && kitchen) {
      const rest = sorted.filter((s) => s !== utility);
      rest.splice(rest.indexOf(kitchen) + (arrangement.split === "width" && prefs.has("kitchen_faces_garden") ? 0 : 1), 0, utility);
      return maybeReverse(rest, arrangement);
    }
  }
  return maybeReverse(sorted, arrangement);
}

/** Night rooms: the primary bedroom at the end furthest from the living room. */
function orderNight(spaces: SpaceSpec[], arrangement: Arrangement, prefs: ReadonlySet<string>): SpaceSpec[] {
  const primaryFirst = arrangement.split === "width" && !prefs.has("kitchen_faces_garden");
  const rank = (s: SpaceSpec) => (s.type === "primary_bedroom" ? 0 : s.type === "bedroom" ? 1 : 2);
  const sorted = [...spaces].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
  return maybeReverse(primaryFirst ? sorted : sorted.reverse(), arrangement);
}

const maybeReverse = (spaces: SpaceSpec[], arrangement: Arrangement) => (arrangement.reverse ? [...spaces].reverse() : spaces);
