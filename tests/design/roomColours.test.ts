import { describe, expect, it } from "vitest";
import { ROOM_COLOUR, roomColour } from "@/design/roomColours";
import { COLOR } from "@/design/tokens";
import { ROOM_TYPES } from "@/domain/plan/schema";
import type { RoomType } from "@/domain/plan/types";

/*
 * The schematic plan colours each room by its type. Names sit on the fill in
 * --ink and sizes in --ink-2, so both must stay readable on every colour, and
 * rooms of different families must stay apart for viewers who can't tell red
 * from green (deuteranopia, the commonest form).
 */

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Machado et al. (2009) deuteranopia, severity 1, on linear RGB. */
const DEUTERANOPIA = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];
const simulate = (v: [number, number, number]) => DEUTERANOPIA.map((row) => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2]))) as [number, number, number];

function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: string, b: string) => {
  const [p, q] = [lab(simulate(rgb(a))), lab(simulate(rgb(b)))];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** Families whose rooms often share a wall; a family's own types differ in lightness on purpose. */
const FAMILY: Record<RoomType, string> = {
  living: "day",
  kitchen: "day",
  kitchen_dining: "day",
  dining: "day",
  office: "day",
  bedroom: "night",
  primary_bedroom: "night",
  bathroom: "wet",
  ensuite: "wet",
  wc: "wet",
  utility: "service",
  storage: "service",
  garage: "service",
  hall: "neutral",
  unspecified: "neutral",
  other: "neutral",
};

describe("room colours", () => {
  it("every room type has a colour from the --room-* tokens", () => {
    const tokens = new Set<string>(Object.entries(COLOR).filter(([k]) => k.startsWith("room-")).map(([, v]) => v));
    for (const type of ROOM_TYPES) {
      expect(roomColour(type), type).toMatch(/^#[0-9a-f]{6}$/);
      expect(tokens.has(roomColour(type)), type).toBe(true);
    }
  });

  it("room names (ink) and sizes (ink-2) read at 4.5:1 or better on every fill", () => {
    for (const [type, fill] of Object.entries(ROOM_COLOUR)) {
      expect(contrast(COLOR.ink, fill), `ink on ${type}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(COLOR["ink-2"], fill), `ink-2 on ${type}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("rooms of different families stay apart under deuteranopia", () => {
    const close: string[] = [];
    for (const a of ROOM_TYPES) {
      for (const b of ROOM_TYPES) {
        if (a >= b || FAMILY[a] === FAMILY[b] || FAMILY[a] === "neutral" || FAMILY[b] === "neutral") continue;
        const d = deltaE(ROOM_COLOUR[a], ROOM_COLOUR[b]);
        if (d < 5) close.push(`${a}/${b} ΔE ${d.toFixed(1)}`);
      }
    }
    expect(close).toEqual([]);
  });

  it("nothing is green, which means selection", () => {
    for (const [type, fill] of Object.entries(ROOM_COLOUR)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
      expect(g > r + 8 && g > b + 8, `${type} ${fill}`).toBe(false);
    }
  });
});
