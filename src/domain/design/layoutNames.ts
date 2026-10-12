import { analyzeEnvelope } from "../geometry/envelope";
import type { Level } from "../plan/types";
import { assessPlan, PLAN_FEATURE_LABEL } from "./analysis";

/**
 * Names for a set of layouts generated together, saying why you'd pick each
 * one over the others in its set ("Most compact", "Biggest living space").
 * A name goes to the one layout that clearly leads on it; layouts that lead
 * on nothing are described by their shape when that tells them apart ("Long and narrow"), else "Balanced", then "Another arrangement" and so on. Names are unique
 * within the set and depend only on it, so the same set gets the same names.
 * A lone layout is described by what it has instead.
 */
const FALLBACK = ["Balanced", "Another arrangement", "A third arrangement", "A fourth arrangement", "A fifth arrangement", "A sixth arrangement"];

export function layoutNames(levels: readonly Level[]): string[] {
  const facts = levels.map((level) => {
    const a = assessPlan(level);
    const env = analyzeEnvelope(level);
    const rearSide = env.ok && level.rearWallId ? env.info.sideOfWall[level.rearWallId] : undefined;
    const gardenWidth = !env.ok ? 0 : rearSide === "east" || rearSide === "west" ? env.info.depth : env.info.width;
    const hall = a.rooms.filter((r) => r.type === "hall").reduce((sum, r) => sum + r.area, 0);
    const bedrooms = a.rooms.filter((r) => r.type === "bedroom" || r.type === "primary_bedroom").reduce((sum, r) => sum + r.area, 0);
    return { a, gardenWidth, hallShare: a.totalArea ? hall / a.totalArea : 0, bedrooms };
  });
  if (levels.length < 2) {
    const a = facts[0]?.a;
    const lead = a?.features.find((f) => f === "open_plan" || f === "separate_living" || f === "kitchen_diner");
    return levels.map(() => (lead ? PLAN_FEATURE_LABEL[lead] : "Balanced"));
  }
  // In priority order: a name, and how much each layout has of it (higher is more).
  const traits: ReadonlyArray<{ name: string; score: (i: number) => number; margin: number }> = [
    { name: "Most compact", score: (i) => -facts[i].a.totalArea, margin: 4 },
    { name: "Biggest living space", score: (i) => facts[i].a.dayArea, margin: 1.5 },
    { name: "Biggest bedrooms", score: (i) => facts[i].bedrooms, margin: 2 },
    { name: "Widest garden side", score: (i) => facts[i].gardenWidth, margin: 0.4 },
    { name: "Least hallway", score: (i) => -facts[i].hallShare, margin: 0.02 },
    { name: "Open-plan living", score: (i) => (facts[i].a.features.includes("open_plan") ? 1 : 0), margin: 0.5 },
    { name: "Most daylight", score: (i) => facts[i].a.glazingRatio, margin: 0.01 },
  ];
  const names: Array<string | null> = levels.map(() => null);
  for (const trait of traits) {
    const open = names.flatMap((n, i) => (n === null ? [i] : []));
    if (!open.length) break;
    const ranked = levels.map((_, i) => i).sort((x, y) => trait.score(y) - trait.score(x));
    const [best, next] = ranked;
    // Only a clear lead earns the name, and only for a layout without one yet.
    if (names[best] === null && (next === undefined || trait.score(best) - trait.score(next) >= trait.margin)) names[best] = trait.name;
  }
  // Layouts that lead on nothing are described by their shape, when that tells them apart.
  const shapeOf = (i: number) => {
    const o = facts[i].a.outside;
    if (!o) return null;
    const ratio = o.depth / o.width;
    return ratio >= 1.35 ? "Long and narrow" : ratio <= 1 / 1.35 ? "Wide and shallow" : "Square";
  };
  const unnamed = names.flatMap((n, i) => (n === null ? [i] : []));
  for (const i of unnamed) {
    const shape = shapeOf(i);
    if (shape && !names.includes(shape) && unnamed.filter((j) => shapeOf(j) === shape).length === 1) names[i] = shape;
  }
  // A set holds at most six layouts (the generate intent's limit), so these stay unique.
  let next = 0;
  return names.map((n) => n ?? FALLBACK[Math.min(next++, FALLBACK.length - 1)]);
}
