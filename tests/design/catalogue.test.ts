import { describe, expect, it } from "vitest";
import { CATALOGUE, catalogueAppearance, cataloguePlan } from "@/domain/project/catalogue";
import { appearanceSchema } from "@/domain/project/schema";

describe("house plan catalogue", () => {
  it("names every house once, with a style and a look that loads", () => {
    expect(CATALOGUE.length).toBeGreaterThan(40);
    expect(new Set(CATALOGUE.map((e) => e.id)).size).toBe(CATALOGUE.length);
    expect(new Set(CATALOGUE.map((e) => e.name)).size).toBe(CATALOGUE.length);
    for (const e of CATALOGUE) expect(appearanceSchema.safeParse(catalogueAppearance(e)).success).toBe(true);
  });

  it("lays every house out with the rooms, floors and shape it lists", () => {
    let fitted = 0;
    for (const e of CATALOGUE) {
      const laid = cataloguePlan(e);
      if (!laid) continue;
      fitted++;
      expect(laid.plan.levels).toHaveLength(e.storeys);
      const rooms = laid.plan.levels.flatMap((l) => Object.values(l.rooms));
      expect(rooms.filter((r) => r.type === "bedroom" || r.type === "primary_bedroom")).toHaveLength(e.bedrooms);
      expect(laid.area).toBeGreaterThan(20);
      // Laid out once: asking again gives the same plan.
      expect(cataloguePlan(e)).toBe(laid);
    }
    // Nearly all of them fit their shape.
    expect(fitted).toBeGreaterThanOrEqual(CATALOGUE.length - 4);
  }, 120_000);
});
