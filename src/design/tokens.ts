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
  ink: "#1e2420",
  "ink-2": "#525852",
  "ink-3": "#646962",
  "ink-disabled": "#a4a8a1",
  "on-brand": "#ffffff",
  brand: "#1f3a32",
  "brand-hover": "#2a4a40",
  "brand-soft": "#edf2ef",
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
  "room-day": "#f3e7cf",
  "room-night": "#dfe7ef",
  "room-wet": "#d9ebe6",
  "room-service": "#ece8e0",
  "room-hall": "#f1eee8",
} as const;

export type ColorToken = keyof typeof COLOR;

/** The UI typeface stack before next/font's family name is known (server, tests). */
export const FALLBACK_SANS = "Inter, ui-sans-serif, system-ui, sans-serif";
