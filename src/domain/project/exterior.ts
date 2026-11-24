import {
  DEFAULT_APPEARANCE,
  ROOF_FINISHES_FOR,
  ROOF_PITCH_RANGE,
  type Appearance,
  type DoorColour,
  type ExteriorStyle,
  type WallColour,
} from "./schema";

/**
 * The exterior as one pure, UI-free API: presets and validated edits of an
 * `Appearance`. The 3D panel and any later AI tool call these, so a change
 * is always a complete, consistent look (a slate roof never lands on a flat
 * roof, a pitch is always in range) and one `setAppearance` call.
 */

export const EXTERIOR_PRESET_IDS = ["modern", "farmhouse", "scandinavian", "traditional_brick", "coastal", "mediterranean"] as const;
export type ExteriorPresetId = (typeof EXTERIOR_PRESET_IDS)[number];

export interface ExteriorPreset {
  id: ExteriorPresetId;
  label: string;
  blurb: string;
  /** The architectural style the AI photo render is asked for. */
  style: ExteriorStyle;
  look: Required<Pick<Appearance, "exterior" | "frames" | "roof" | "roofForm" | "roofPitch" | "doorColour">> & Pick<Appearance, "wallColour">;
}

export const EXTERIOR_PRESETS: Record<ExteriorPresetId, ExteriorPreset> = {
  modern: {
    id: "modern",
    label: "Modern",
    blurb: "Flat roof, dark render, black frames",
    style: "contemporary",
    look: { exterior: "dark_render", wallColour: "charcoal", frames: "black", roof: "membrane", roofForm: "flat", roofPitch: 35, doorColour: "black" },
  },
  farmhouse: {
    id: "farmhouse",
    label: "Modern farmhouse",
    blurb: "White walls, steep gable, black frames",
    style: "farmhouse",
    look: { exterior: "white_render", wallColour: "white", frames: "black", roof: "zinc", roofForm: "gabled", roofPitch: 42, doorColour: "navy" },
  },
  scandinavian: {
    id: "scandinavian",
    label: "Scandinavian",
    blurb: "Timber cladding, low gable",
    style: "scandinavian",
    look: { exterior: "timber", frames: "white", roof: "slate", roofForm: "gabled", roofPitch: 28, doorColour: "oak" },
  },
  traditional_brick: {
    id: "traditional_brick",
    label: "Traditional brick",
    blurb: "Red brick, hipped slate roof",
    style: "traditional",
    look: { exterior: "brick", frames: "white", roof: "slate", roofForm: "hipped", roofPitch: 35, doorColour: "green" },
  },
  coastal: {
    id: "coastal",
    label: "Coastal",
    blurb: "Pale painted walls, grey frames",
    style: "coastal",
    look: { exterior: "painted_brick", wallColour: "sky", frames: "grey", roof: "slate", roofForm: "gabled", roofPitch: 38, doorColour: "yellow" },
  },
  mediterranean: {
    id: "mediterranean",
    label: "Mediterranean",
    blurb: "Warm render, shallow clay-tile roof",
    style: "mediterranean",
    look: { exterior: "white_render", wallColour: "sand", frames: "bronze", roof: "tile", roofForm: "hipped", roofPitch: 22, doorColour: "red" },
  },
};

/** The pitch in range for a roof shape, in whole degrees; undefined for a flat roof. */
export function clampRoofPitch(form: Appearance["roofForm"], degrees: number): number | undefined {
  if (form !== "hipped" && form !== "gabled") return undefined;
  const { min, max } = ROOF_PITCH_RANGE[form];
  return Math.round(Math.min(max, Math.max(min, degrees)));
}

/** The pitch the 3D view and the elevations use: the set one, clamped, else the form's default. Undefined for a flat roof. */
export function effectiveRoofPitch(appearance: Pick<Appearance, "roofForm" | "roofPitch">): number | undefined {
  const form = appearance.roofForm;
  if (form !== "hipped" && form !== "gabled") return undefined;
  return clampRoofPitch(form, appearance.roofPitch ?? ROOF_PITCH_RANGE[form].default);
}

/** The finishes whose colour can be chosen. */
export const takesWallColour = (exterior: Appearance["exterior"]) => exterior === "white_render" || exterior === "dark_render" || exterior === "painted_brick";

/**
 * Makes a look consistent: the roof finish suits the roof shape, the pitch is
 * in range (and dropped on a flat roof), and a wall colour is kept only where
 * the finish takes one.
 */
export function normaliseExterior(appearance: Appearance): Appearance {
  const next: Appearance = { ...appearance };
  const form = next.roofForm ?? "flat";
  if (!ROOF_FINISHES_FOR[form].includes(next.roof)) next.roof = ROOF_FINISHES_FOR[form][0];
  const pitch = next.roofPitch === undefined ? undefined : clampRoofPitch(next.roofForm, next.roofPitch);
  if (pitch === undefined) delete next.roofPitch;
  else next.roofPitch = pitch;
  if (!takesWallColour(next.exterior)) delete next.wallColour;
  return next;
}

/** A user-facing edit of the exterior; `undefined` leaves a field as it is. */
export type ExteriorChange = Partial<Pick<Appearance, "exterior" | "frames" | "roof" | "roofForm" | "roofPitch" | "exteriorStyle" | "wallColour" | "doorColour">>;

/**
 * The appearance after one edit, kept consistent: changing the roof shape
 * picks a roof finish that fits it, a new finish drops a colour it can't take.
 * Pure: returns a new object.
 */
export function setExteriorAppearance(appearance: Appearance | undefined, change: ExteriorChange): Appearance {
  const merged: Appearance = { ...DEFAULT_APPEARANCE, ...appearance };
  for (const [key, value] of Object.entries(change)) if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  // Switching to a finish with its own colour starts from that finish's natural colour.
  if (change.exterior && change.wallColour === undefined && !takesWallColour(change.exterior)) delete merged.wallColour;
  return normaliseExterior(merged);
}

/** The appearance after choosing a preset: its whole bundle replaces the exterior look; the interior style is kept. */
export function applyExteriorPreset(appearance: Appearance | undefined, id: ExteriorPresetId): Appearance {
  const { look, style } = EXTERIOR_PRESETS[id];
  const base: Appearance = { ...DEFAULT_APPEARANCE, ...appearance };
  delete base.wallColour;
  return normaliseExterior({ ...base, ...look, exteriorStyle: style });
}

/** The preset a look matches exactly, if any, so the panel can mark it as chosen. */
export function matchingPreset(appearance: Appearance | undefined): ExteriorPresetId | null {
  if (!appearance) return null;
  const current = normaliseExterior({ ...DEFAULT_APPEARANCE, ...appearance });
  for (const id of EXTERIOR_PRESET_IDS) {
    const applied = applyExteriorPreset(current, id);
    const keys = ["exterior", "wallColour", "frames", "roof", "roofForm", "roofPitch", "doorColour", "exteriorStyle"] as const;
    if (keys.every((k) => (applied[k] ?? null) === (current[k] ?? null))) return id;
  }
  return null;
}

export type { DoorColour, WallColour };
