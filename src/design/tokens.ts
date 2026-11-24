/**
 * Colour tokens for code that can't read CSS: the Konva plan, the three.js
 * scene and 3D stills. These mirror src/app/tokens.css exactly;
 * tests/design/tokens.test.ts fails if the two drift. DESIGN.md says how
 * each is used.
 */
export const COLOR = {
  bg: "#f8f7f3",
  canvas: "#f2f0ea",
  surface: "#ffffff",
  "surface-2": "#f4f3ef",
  "surface-3": "#ecebe5",
  line: "#e6e3db",
  "line-strong": "#d4d0c6",
  ink: "#1c1a17",
  "ink-2": "#57524a",
  "ink-3": "#6b665e",
  "ink-disabled": "#a8a39a",
  "on-brand": "#ffffff",
  brand: "#1c1a17",
  "brand-hover": "#3a3733",
  "brand-soft": "#efece6",
  accent: "#2f6f5e",
  "accent-ink": "#245848",
  "accent-soft": "#e5efeb",
  "accent-line": "#c5dcd4",
  danger: "#b8432f",
  "danger-soft": "#f6e3df",
  "danger-line": "#e9c4bb",
  "danger-ink": "#86301f",
  warning: "#9a5a10",
  "warning-soft": "#fbf5ea",
  "warning-line": "#eedcbc",
  "warning-ink": "#6b4a12",
  media: "#e7e0d2",
  sky: "#e9eef1",
  "grid-dot": "#d6dbcc",
  "room-paper": "#f7f4ec",
  "room-living": "#f0dfc4",
  "room-kitchen": "#f4dd97",
  "room-bedroom": "#f2cbbe",
  "room-primary-bedroom": "#ecbbaa",
  "room-office": "#dad0c5",
  "room-bathroom": "#c7dcee",
  "room-wc": "#d5e4f0",
  "room-utility": "#d1cfd2",
  "room-storage": "#e6e0e6",
  "room-garage": "#d8d6dc",
  "room-hall": "#eae4d8",
  "room-other": "#e8e5dd",
} as const;

export type ColorToken = keyof typeof COLOR;

/** The UI typeface stack before next/font's family name is known (server, tests). */
export const FALLBACK_SANS = "Inter, ui-sans-serif, system-ui, sans-serif";

/** The small-size serif (plan labels) before next/font's family name is known. */
export const FALLBACK_SERIF_TEXT = "\"DM Serif Text\", Georgia, serif";
