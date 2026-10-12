import type { Level, PlanDocument } from "../plan/types";
import { assessHouse, assessPlan } from "./analysis";

/**
 * Changes worth suggesting for a whole plan, in plain words the request
 * readers understand. Never offers a room the house already has, on any
 * floor, and asks only about rooms it does have. At most four, the likeliest
 * first.
 */
export function planSuggestions(plan: Level | PlanDocument, max = 4): string[] {
  const facts = "levels" in plan ? assessHouse(plan) : assessPlan(plan);
  const types = new Set(facts.rooms.map((r) => r.type));
  const has = (...t: string[]) => t.some((x) => types.has(x as never));
  const out: string[] = [];
  if (has("kitchen", "kitchen_dining")) out.push("Make the kitchen larger");
  if (has("living")) out.push("More light in the living room");
  if (has("kitchen") && has("living") && !has("kitchen_dining")) out.push("Open up the kitchen to the living room");
  if (!has("utility")) out.push("Add a utility room");
  if (!has("office")) out.push("Add a home office");
  return out.slice(0, max);
}
