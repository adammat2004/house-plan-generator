import { floorFor } from "@/domain/design/program";
import type { FloorMaterial, Point2, RoomType } from "@/domain/plan/types";

/**
 * Floor finishes as repeating tiles, in metres: what herringbone, boards,
 * tiles and the rest look like from above. Pure data, so the plan (Konva),
 * the 3D floors (three.js) and the SVG previews all draw the same floor.
 * Every tile repeats seamlessly; tests/editor/finishes.test.ts checks that.
 */
export type FinishId = "herringbone" | "boards" | "tile" | "stone" | "carpet" | "concrete" | "vinyl";
/** The garden's surfaces, drawn the same way (scene/garden.ts). */
export type OutdoorId = "lawn" | "paving" | "gravel";

export interface FinishPart {
  /** A closed shape, filled and/or stroked. */
  ring?: Point2[];
  /** A soft round patch (concrete's mottling): fades from `fill` at the centre to clear at `r`. */
  spot?: { x: number; y: number; r: number };
  fill?: string;
  stroke?: string;
  /** Stroke width, m. */
  width?: number;
}

export interface FinishTile {
  id: FinishId | OutdoorId;
  /** The tile's size, m; it repeats edge to edge. */
  width: number;
  height: number;
  base: string;
  parts: FinishPart[];
}

/** The finish each material is drawn with. */
export const FINISH_OF_MATERIAL: Record<FloorMaterial, FinishId> = {
  timber: "herringbone",
  boards: "boards",
  tile: "tile",
  stone: "stone",
  carpet: "carpet",
  concrete: "concrete",
  vinyl: "vinyl",
};

/** The finish a room is drawn with: its own, else the one its use usually has; none for a room with no use yet. */
export function roomFinish(room: { floorMaterial: FloorMaterial | null | undefined; type: RoomType }): FinishId | null {
  if (room.floorMaterial) return FINISH_OF_MATERIAL[room.floorMaterial];
  return room.type === "unspecified" ? null : FINISH_OF_MATERIAL[floorFor(room.type)];
}

/** A small fixed pseudo-random sequence (mulberry32), so every tile is drawn the same every time. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rect = (x: number, y: number, w: number, h: number): Point2[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const overlaps = (r: Point2[], w: number, h: number) => {
  const xs = r.map((p) => p.x);
  const ys = r.map((p) => p.y);
  return Math.max(...xs) >= 0 && Math.min(...xs) <= w && Math.max(...ys) >= 0 && Math.min(...ys) <= h;
};

/**
 * Rows of pieces (boards, flagstones) across a tile `width` wide. Each row
 * is cut at the given positions, read round the tile: a piece running off
 * the right edge carries on from the left, so rows never line up at the seam.
 */
function rows(width: number, rowHeight: number, cuts: number[][], tones: string[], joint: string, jointWidth: number): FinishPart[] {
  const parts: FinishPart[] = [];
  let n = 0;
  cuts.forEach((row, r) => {
    const sorted = [...row].map((c) => ((c % width) + width) % width).sort((a, b) => a - b);
    sorted.forEach((from, i) => {
      const to = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + width;
      const fill = tones[(n++ * 5 + r * 3) % tones.length];
      const y = r * rowHeight;
      // Drawn where it starts and again a tile to the left, so the part past the right edge shows at the left.
      for (const shift of [0, -width]) {
        const ring = rect(from + shift, y, to - from, rowHeight);
        if (overlaps(ring, width, cuts.length * rowHeight)) parts.push({ ring, fill, stroke: joint, width: jointWidth });
      }
    });
  });
  return parts;
}

/**
 * Herringbone: planks L × W laid alternately along and across, each end
 * against the next one's side. The planks repeat on the lattice
 * (W, W)·k + (L, −L)·m, and the pattern on a square of side 2L.
 */
function herringbone(L: number, W: number, tones: string[], joint: string): FinishPart[] {
  const n = Math.round(L / W);
  const T = 2 * L;
  const parts: FinishPart[] = [];
  const reach = 2 * n + 3;
  for (let k = -reach; k <= reach; k++) {
    for (let m = -3; m <= 3; m++) {
      const x = k * W + m * L;
      const y = k * W - m * L;
      // Each class of plank looks the same wherever the pattern repeats.
      const c = (((k + n * m) % (2 * n)) + 2 * n) % (2 * n);
      const along = rect(x, y, L, W);
      const across = rect(x + L, y + W - L, W, L);
      if (overlaps(along, T, T)) parts.push({ ring: along, fill: tones[(c * 7) % tones.length], stroke: joint, width: 0.003 });
      if (overlaps(across, T, T)) parts.push({ ring: across, fill: tones[(c * 7 + 3) % tones.length], stroke: joint, width: 0.003 });
    }
  }
  return parts;
}

/** Specks or patches scattered over a tile, repeated past each edge they cross. */
function scatter(w: number, h: number, count: number, seed: number, make: (x: number, y: number, rnd: () => number) => FinishPart, reach: number): FinishPart[] {
  const rnd = random(seed);
  const parts: FinishPart[] = [];
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    for (const dx of [-w, 0, w]) {
      for (const dy of [-h, 0, h]) {
        const px = x + dx;
        const py = y + dy;
        if (px < -reach || px > w + reach || py < -reach || py > h + reach) continue;
        parts.push(make(px, py, random(seed * 7919 + i)));
      }
    }
  }
  return parts;
}

const OAK = ["#d9b88f", "#d4b088", "#ddbd95", "#d2ae85", "#d7b58c", "#dbba92"];
const BOARD = ["#dcc19c", "#d6b993", "#e0c6a2", "#d3b58e", "#d9bd97"];
const TILE = ["#efeeea", "#e9e8e3", "#edece7", "#e6e5e0"];
const STONE = ["#ddd6ca", "#d5cec1", "#e2dcd1", "#d1c9bc"];
const VINYL = ["#e4d8c4", "#ddd0bb", "#e8ddca", "#dfd3bf"];

const PAVING = ["#e8e2d7", "#e3ddd1", "#ebe6dc", "#e0d9cc"];

const cache = new Map<FinishId | OutdoorId, FinishTile>();

/** One tile of a finish. */
export function finishTile(id: FinishId | OutdoorId): FinishTile {
  const cached = cache.get(id);
  if (cached) return cached;
  const tile = makeTile(id);
  cache.set(id, tile);
  return tile;
}

function makeTile(id: FinishId | OutdoorId): FinishTile {
  switch (id) {
    case "lawn":
      // Mown in 1.4 m stripes, kept faint, with a little grain.
      return {
        id,
        width: 2.8,
        height: 0.7,
        base: "#b9c79b",
        parts: [
          { ring: rect(0, 0, 1.4, 0.7), fill: "#b6c497" },
          ...scatter(2.8, 0.7, 260, 17, (x, y, rnd) => ({ ring: rect(x, y, 0.012, 0.03), fill: rnd() < 0.5 ? "#a9b98a" : "#c4d1a8" }), 0.04),
        ],
      };
    case "paving":
      // 600 mm slabs, staggered.
      return { id, width: 1.8, height: 1.8, base: "#d3cbbd", parts: rows(1.8, 0.6, [[0, 0.9], [0.45, 1.35], [0.2, 1.1]], PAVING, "#d3cbbd", 0.012) };
    case "gravel":
      return {
        id,
        width: 0.5,
        height: 0.5,
        base: "#e3dccd",
        parts: scatter(0.5, 0.5, 160, 23, (x, y, rnd) => ({ ring: rect(x, y, 0.014, 0.014), fill: rnd() < 0.4 ? "#d2c9b6" : rnd() < 0.7 ? "#efe9de" : "#c9c0ad" }), 0.02),
      };
    case "herringbone":
      return { id, width: 1.44, height: 1.44, base: "#c4a07a", parts: herringbone(0.72, 0.12, OAK, "#bf9c75") };
    case "boards":
      // 0.2 m boards, staggered so no two rows' joints line up.
      return { id, width: 2.4, height: 0.8, base: "#c8a67e", parts: rows(2.4, 0.2, [[0, 1.2], [0.75, 1.95], [0.35, 1.55], [1.0, 2.2]], BOARD, "#c3a27c", 0.003) };
    case "vinyl":
      return { id, width: 2, height: 0.72, base: "#d6c9b3", parts: rows(2, 0.18, [[0, 1], [0.6, 1.6], [0.25, 1.25], [0.8, 1.8]], VINYL, "#c4b49b", 0.002) };
    case "tile":
      return {
        id,
        width: 1.2,
        height: 1.2,
        base: "#d4d1ca",
        parts: [0, 1, 2, 3].map((i) => ({ ring: rect((i % 2) * 0.6 + 0.002, Math.floor(i / 2) * 0.6 + 0.002, 0.596, 0.596), fill: TILE[i] })),
      };
    case "stone":
      return { id, width: 1.2, height: 1.2, base: "#c4bbac", parts: rows(1.2, 0.4, [[0, 0.5, 0.9], [0.2, 0.75], [0.45, 0.85, 1.1]], STONE, "#c4bbac", 0.008) };
    case "carpet":
      return {
        id,
        width: 0.5,
        height: 0.5,
        base: "#e2ddd3",
        parts: scatter(0.5, 0.5, 220, 11, (x, y, rnd) => ({ ring: rect(x, y, 0.006, 0.006), fill: rnd() < 0.5 ? "#d6d0c4" : "#ebe7de" }), 0.01),
      };
    case "concrete":
      return {
        id,
        width: 2,
        height: 2,
        base: "#dedcd7",
        parts: scatter(2, 2, 14, 5, (x, y, rnd) => ({ spot: { x, y, r: 0.25 + rnd() * 0.35 }, fill: rnd() < 0.5 ? "rgba(196, 192, 184, 0.45)" : "rgba(236, 234, 230, 0.6)" }), 0.6),
      };
  }
}

/** The finish's overall colour: for a swatch, or when there's no room to draw the pattern. */
export const FINISH_TONE: Record<FinishId, string> = {
  herringbone: "#d6b287",
  boards: "#d8bb94",
  tile: "#ebeae5",
  stone: "#dad3c6",
  carpet: "#e2ddd3",
  concrete: "#dedcd7",
  vinyl: "#e2d5c0",
};
