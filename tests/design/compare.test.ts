import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { applyCommand } from "@/domain/commands";
import { comparePlans } from "@/domain/design/compare";
import { planLayouts } from "@/domain/design/stripPlanner";
import type { PlanDocument } from "@/domain/plan/types";
import { apply, level, newHouse } from "../helpers";

const layouts = (): PlanDocument[] => {
  const source = apply(newHouse(), { type: "setRearWall", wallId: level(newHouse()).envelope.wallIds[2] });
  return planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3 }, source, brief: DEFAULT_BRIEF, idPrefix: "g" }).candidates.map((c) => c.document);
};

/** The plan with one inside wall moved 0.3 m, and that wall's id. */
function nudged(doc: PlanDocument): { doc: PlanDocument; wallId: string } {
  for (const wall of Object.values(level(doc).walls)) {
    if (wall.role !== "internal") continue;
    const result = applyCommand(doc, { type: "moveWall", wallId: wall.id, delta: 0.3 });
    if (result.ok) return { doc: result.document, wallId: wall.id };
  }
  throw new Error("no inside wall moves");
}

describe("comparing two plans", () => {
  it("finds nothing different between a plan and itself", () => {
    const [a] = layouts();
    const c = comparePlans(a, a, DEFAULT_BRIEF);
    expect(c.changed).toEqual({ a: [], b: [] });
    expect(c.pairs.every((p) => p.a && p.b && p.a.id === p.b.id)).toBe(true);
    expect(c.metrics.every((m) => m.better === null)).toBe(true);
    expect(c.metrics.map((m) => m.key)).toContain("brief");
  });

  it("outlines only the rooms a moved wall changes, matched by id, the area passing from one to the other", () => {
    const [a] = layouts();
    const { doc: b } = nudged(a);
    const c = comparePlans(a, b);
    expect(c.changed.a.length).toBeGreaterThanOrEqual(2);
    expect(c.changed.a.length).toBeLessThan(c.pairs.length);
    expect(c.changed.b).toEqual(c.changed.a);
    const moved = c.pairs.filter((p) => p.changed);
    // What one room loses the others gain, less a little wall: the walls meeting the moved one get shorter.
    expect(Math.abs(moved.reduce((sum, p) => sum + (p.areaChange ?? 0), 0))).toBeLessThan(0.15);
    // Without a brief there's nothing to rank by it.
    expect(c.metrics.map((m) => m.key)).not.toContain("brief");
  });

  it("pairs the rooms of two different layouts by name and use, and says which side the numbers favour", () => {
    const [a, b] = layouts();
    const c = comparePlans(a, b, DEFAULT_BRIEF);
    for (const p of c.pairs) if (p.a && p.b) expect(p.a.type).toBe(p.b.type);
    const bedrooms = c.metrics.find((m) => m.key === "bedrooms")!;
    expect(bedrooms.better).toBeNull();
    const checks = c.metrics.find((m) => m.key === "checks")!;
    if (checks.a !== checks.b) expect(checks.better).toBe(checks.a < checks.b ? "a" : "b");
    expect(c.size.a && c.size.b).toBeTruthy();
  });

  it("keeps a renamed room as the same room, and leaves one on its own when two are merged", () => {
    const [a] = layouts();
    const room = Object.values(level(a).rooms)[0];
    const renamed = apply(a, { type: "updateRoom", roomId: room.id, changes: { name: "Games room" } });
    const same = comparePlans(a, renamed).pairs.find((p) => p.a?.id === room.id)!;
    expect(same.b?.name).toBe("Games room");
    expect(same.changed).toBe(false);

    const merged = Object.values(level(a).walls)
      .filter((w) => w.role === "internal")
      .map((w) => applyCommand(a, { type: "deleteWall", wallId: w.id }))
      .find((r) => r.ok && Object.keys(level(r.document).rooms).length < Object.keys(level(a).rooms).length);
    if (!merged?.ok) throw new Error("no wall to take out");
    const c = comparePlans(a, merged.document);
    expect(c.pairs.some((p) => p.a && !p.b)).toBe(true);
    expect(c.pairs.filter((p) => p.a).length).toBe(Object.keys(level(a).rooms).length);
  });
});
