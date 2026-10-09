/**
 * Editable starting values. These are conveniences for a new plan, not
 * regulatory assumptions.
 */
export const DEFAULT_HOUSE = {
  width: 8,
  depth: 10,
  externalThickness: 0.3,
  internalThickness: 0.1,
  wallHeight: 2.4,
} as const;

export const DOOR_PRESET = {
  width: 0.9,
  height: 2.1,
} as const;

export const WINDOW_PRESET = {
  width: 1.2,
  height: 1.2,
  sillHeight: 0.9,
} as const;

export interface OpeningPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Windows only. */
  sillHeight?: number;
}

/** Common sizes offered when editing an opening. Conveniences, not regulatory values. */
export const OPENING_PRESETS: { door: ReadonlyArray<OpeningPreset>; window: ReadonlyArray<OpeningPreset> } = {
  door: [
    { id: "standard", label: "Standard door", ...DOOR_PRESET },
    { id: "narrow", label: "Narrow door", width: 0.8, height: 2.1 },
    { id: "wide", label: "Wide door", width: 1, height: 2.1 },
    { id: "double", label: "Double doors", width: 1.5, height: 2.1 },
  ],
  window: [
    { id: "standard", label: "Standard window", ...WINDOW_PRESET },
    { id: "small", label: "Small window", width: 0.6, height: 0.6, sillHeight: 1.2 },
    { id: "wide", label: "Wide window", width: 1.8, height: 1.2, sillHeight: 0.9 },
    { id: "picture", label: "Picture window", width: 2.4, height: 1.5, sillHeight: 0.6 },
    { id: "full-height", label: "Floor-to-ceiling", width: 1.2, height: 2.1, sillHeight: 0 },
  ],
};

export const LIMITS = {
  minWallThickness: 0.05,
  maxWallThickness: 1,
  minWallLength: 0.05,
  maxWallHeight: 10,
  minOpeningWidth: 0.2,
  minHouseClearSpan: 0.5,
  maxHouseSize: 200,
  /** Most walls a house outline may have. */
  maxOutlineEdges: 64,
  /** Shortest step in a house outline, on the wall centrelines. */
  minOutlineStep: 0.2,
  maxNameLength: 80,
} as const;
