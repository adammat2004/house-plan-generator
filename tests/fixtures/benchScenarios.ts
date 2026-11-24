import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import type { Scenario } from "@/domain/design/eval/benchmark";
import type { Point2 } from "@/domain/plan/types";

/**
 * Benchmark scenarios: every preset sized from the rooms, the shaped and
 * two-storey briefs, and drawn houses of awkward sizes and shapes. Add a
 * scenario whenever a planner change targets a kind of house not covered.
 * Still missing (they need features the planners lack): a terrace with
 * party walls, a rear extension to an existing house.
 */

const preset = (id: string, extra: Partial<HouseBrief> = {}): HouseBrief => ({ ...withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks), ...extra });
const ring = (...p: Array<[number, number]>): Point2[] => p.map(([x, y]) => ({ x, y }));

export const BENCH_SCENARIOS: readonly Scenario[] = [
  ...BRIEF_PRESETS.map((p): Scenario => ({ name: p.id, brief: preset(p.id), auto: true })),
  { name: "family-4 any shape", brief: preset("family-4", { houseShape: "any" }), auto: true },
  { name: "family-3 L", brief: preset("family-3", { houseShape: "L" }), auto: true },
  { name: "bungalow U", brief: preset("bungalow", { houseShape: "U" }), auto: true },
  { name: "family-3 two storeys", brief: preset("family-3", { storeys: 2 }), auto: true },
  { name: "family-4 two storeys", brief: preset("family-4", { storeys: 2 }), auto: true },
  { name: "family-3 kitchen to the garden", brief: preset("family-3", { preferences: ["kitchen_faces_garden"] }), auto: true },
  { name: "bungalow two storeys kitchen to the garden", brief: preset("bungalow", { storeys: 2, preferences: ["kitchen_faces_garden"] }), auto: true },
  { name: "family-3 in 12 × 9", brief: preset("family-3"), width: 12, depth: 9 },
  { name: "bungalow wide shallow 16 × 8", brief: preset("bungalow"), width: 16, depth: 8 },
  { name: "family-3 deep 8.5 × 16", brief: preset("family-3"), width: 8.5, depth: 16 },
  { name: "family-3 drawn L", brief: preset("family-3"), outline: ring([0, 0], [12, 0], [12, 7], [6, 7], [6, 13], [0, 13]) },
  { name: "family-3 two storeys in 7.5 × 9", brief: preset("family-3", { storeys: 2 }), width: 7.5, depth: 9 },
  { name: "family-4 T", brief: preset("family-4", { houseShape: "T" }), auto: true },
  { name: "family-3 drawn U", brief: preset("family-3"), outline: ring([0, 0], [5, 0], [5, 5], [9, 5], [9, 0], [14, 0], [14, 11], [0, 11]) },
  { name: "family-3 drawn T", brief: preset("family-3"), outline: ring([4.5, 0], [11.5, 0], [11.5, 7], [16, 7], [16, 14], [0, 14], [0, 7], [4.5, 7]) },
];
