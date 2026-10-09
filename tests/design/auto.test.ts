import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF, type HouseBrief } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { footprintsFor, minimumFootprint } from "@/domain/design/footprint";
import { programFromBrief } from "@/domain/design/program";
import { planLayouts } from "@/domain/design/stripPlanner";
import { ARRANGEMENTS, hallWidthFor } from "@/domain/design/zoning";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { projectFromRooms } from "@/domain/project/fromRooms";
import { loadProjectDocument } from "@/domain/project/schema";
import { level, newHouse } from "../helpers";

const opts = { externalThickness: 0.3, hallWidth: hallWidthFor(new Set()) };
const brief = (over: Partial<HouseBrief> = {}): HouseBrief => ({ ...DEFAULT_BRIEF, ...over });

function auto(b: HouseBrief, extra: { count?: number; plot?: { maxWidth?: number; maxDepth?: number }; exclude?: string[]; similarTo?: string } = {}) {
  const { count = 3, ...rest } = extra;
  return planLayouts({ intent: { action: "generate_layouts", brief: b, count, footprint: "auto", ...rest }, source: newHouse(), brief: b, idPrefix: "a" });
}

const outside = (doc: Parameters<typeof level>[0]) => {
  const env = analyzeEnvelope(level(doc));
  if (!env.ok) throw new Error(env.message);
  return { width: env.info.width, depth: env.info.depth };
};

describe("footprint chooser", () => {
  it("offers distinct, sensibly proportioned sizes that grow with the rooms", () => {
    let previous = 0;
    for (const bedrooms of [1, 2, 3, 4, 5, 6]) {
      const program = programFromBrief(brief({ bedrooms, bathrooms: Math.min(3, bedrooms) }));
      const sizes = footprintsFor(program, ARRANGEMENTS[0], opts);
      expect(sizes.length).toBeGreaterThan(0);
      expect(new Set(sizes.map((s) => `${s.width}x${s.depth}`)).size).toBe(sizes.length);
      for (const s of sizes) expect(Math.max(s.width, s.depth) / Math.min(s.width, s.depth)).toBeLessThanOrEqual(2.2 + 1e-9);
      const min = minimumFootprint(program, ARRANGEMENTS, opts)!;
      expect(min.width * min.depth).toBeGreaterThan(previous);
      previous = min.width * min.depth;
    }
  });

  it("keeps every size inside the plot", () => {
    const program = programFromBrief(brief({ bedrooms: 4 }));
    for (const arrangement of ARRANGEMENTS) {
      for (const s of footprintsFor(program, arrangement, { ...opts, plot: { maxWidth: 14 } })) expect(s.width).toBeLessThanOrEqual(14);
    }
  });
});

describe("layouts sized from the rooms", () => {
  it("generates valid, furnished layouts in different arrangements and sizes", () => {
    const started = performance.now();
    const result = auto(brief({ bedrooms: 4, bathrooms: 2 }), { count: 4 });
    const elapsed = performance.now() - started;
    expect(result.issues).toEqual([]);
    expect(result.candidates).toHaveLength(4);
    for (const c of result.candidates) {
      expect(validateDocument(c.document)).toEqual([]);
      expect(Object.keys(level(c.document).furniture).length).toBeGreaterThan(10);
      expect(c.variant).toBe(`${c.arrangement}@${c.footprint!.width}x${c.footprint!.depth}`);
      expect(outside(c.document)).toEqual({ width: c.footprint!.width, depth: c.footprint!.depth });
      const types = Object.values(level(c.document).rooms).map((r) => r.type);
      expect(types.filter((t) => t === "bedroom" || t === "primary_bedroom")).toHaveLength(4);
    }
    expect(new Set(result.candidates.map((c) => c.arrangement)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(result.candidates.map((c) => `${c.footprint!.width}x${c.footprint!.depth}`)).size).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeLessThan(3000);
  });

  it("is deterministic, and Generate more and similar offer new ones", () => {
    const b = brief({ bedrooms: 3 });
    const first = auto(b);
    expect(JSON.stringify(auto(b))).toBe(JSON.stringify(first));
    const more = auto(b, { exclude: first.candidates.map((c) => c.variant!) });
    expect(more.candidates.length).toBeGreaterThan(0);
    for (const c of more.candidates) expect(first.candidates.map((f) => f.variant)).not.toContain(c.variant);
    const base = first.candidates[0];
    const similar = auto(b, { count: 2, similarTo: base.variant, exclude: first.candidates.map((c) => c.variant!) });
    expect(similar.candidates[0].footprint).toMatchObject({ width: base.footprint!.width, depth: base.footprint!.depth });
  });

  it("respects the plot, and says how big the house must be when it can't", () => {
    const b = brief({ bedrooms: 4, bathrooms: 2 });
    for (const c of auto(b, { plot: { maxWidth: 13 } }).candidates) expect(outside(c.document).width).toBeLessThanOrEqual(13);
    const tight = auto(b, { plot: { maxWidth: 6, maxDepth: 6 } });
    expect(tight.candidates).toEqual([]);
    expect(tight.issues[0].message).toMatch(/at least about [\d.]+ × [\d.]+ m/);
  });

  it("says how big the user's house needs to be when the rooms don't fit it", () => {
    const b = brief({ bedrooms: 6, bathrooms: 2 });
    const result = planLayouts({ intent: { action: "generate_layouts", brief: b, count: 3 }, source: newHouse(), brief: b, idPrefix: "s" });
    expect(result.candidates).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: "does-not-fit", tooSmall: true });
    expect(result.issues[0].message).toMatch(/don't fit your 8 × 10 m house: they need about [\d.]+ × [\d.]+ m/);
    // Sizing from the rooms works for the same brief.
    expect(auto(b).candidates.length).toBeGreaterThan(0);
  });

  it("leaves layouts in the user's own house unchanged", () => {
    const source = newHouse();
    const result = planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 2 }, source, brief: DEFAULT_BRIEF, idPrefix: "s" });
    for (const c of result.candidates) {
      expect(outside(c.document)).toEqual({ width: 8, depth: 10 });
      expect(c.footprint).toBeUndefined();
    }
  });
});

describe("projects started from rooms", () => {
  it("opens on generated layouts sized from the rooms, and survives a save and load", () => {
    const result = projectFromRooms(brief({ bedrooms: 4, bathrooms: 2 }), { id: "p1", idPrefix: "x", now: "2026-10-08T00:00:00Z", name: "Our house", plot: { maxWidth: 16 }, count: 3 });
    if (!result.ok) throw new Error(result.message);
    const { project } = result;
    expect(project.plans.map((p) => p.label)).toEqual(["Shell", "Plan A", "Plan B", "Plan C"]);
    expect(project.activePlanId).toBe(project.plans[1].id);
    expect(project.sizing).toEqual({ footprint: "auto", plot: { maxWidth: 16 } });
    for (const plan of project.plans.slice(1)) {
      expect(plan.parentId).toBe(project.plans[0].id);
      expect(plan.origin).toMatchObject({ kind: "generated", variant: expect.stringMatching(/@/) });
      expect(outside(plan.document).width).toBeLessThanOrEqual(16);
    }
    const loaded = loadProjectDocument(JSON.parse(JSON.stringify(project)), "now");
    expect(loaded.ok && loaded.project).toEqual(project);
    expect(projectFromRooms(brief({ bedrooms: 6 }), { id: "p2", idPrefix: "y", now: "n", name: "x", plot: { maxWidth: 5, maxDepth: 5 } }).ok).toBe(false);
  });
});
