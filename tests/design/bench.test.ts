import { describe, expect, it } from "vitest";
import { runScenario, summarise } from "@/domain/design/eval/benchmark";
import { compareIdeas, ideaOf, levelMetrics } from "@/domain/design/eval/metrics";
import { assessSense } from "@/domain/design/sense";
import { zoneCandidates } from "@/domain/design/zoneLayouts";
import { apply, newHouse } from "../helpers";
import { BENCH_SCENARIOS } from "../fixtures/benchScenarios";

const scenario = (name: string) => BENCH_SCENARIOS.find((s) => s.name === name)!;

describe("plan metrics", () => {
  const drawn = runScenario(scenario("family-3 in 12 × 9"), 6).candidates;

  it("measures hall share as plan sense does", () => {
    for (const c of drawn) expect(levelMetrics(c.doc.levels[0]).hallShare).toBeCloseTo(assessSense(c.doc.levels[0]).metrics.hallShare, 6);
  });

  it("counts cupboards cut from the hall as circulation", () => {
    for (const c of drawn) expect(c.metrics.circulationShare).toBeGreaterThanOrEqual(c.metrics.hallShare);
    expect(drawn.some((c) => c.metrics.circulationShare > c.metrics.hallShare + 0.01)).toBe(true);
  });

  it("finds the front door's room and how deep the bedrooms lie", () => {
    for (const c of drawn) {
      expect(c.metrics.descriptor.entry).toBe("hall");
      expect(c.metrics.levels[0].meanDepth).toBeGreaterThanOrEqual(1);
    }
  });

  it("calls a mirrored plan the same plan", () => {
    // Zone layouts as built, before picking drops the mirror images.
    const s = scenario("family-3 in 12 × 9");
    const house = newHouse(12, 9);
    const source = apply(house, { type: "setRearWall", wallId: house.levels[0].envelope.wallIds[2] });
    const built = zoneCandidates(source, { intent: { action: "generate_layouts", brief: s.brief, count: 1 }, source, brief: s.brief, idPrefix: "m" }, "m-", () => false).candidates;
    const left = built.find((c) => c.arrangement!.startsWith("zones-l."))!;
    const right = built.find((c) => c.arrangement === left.arrangement!.replace("zones-l.", "zones-r."))!;
    const d = compareIdeas(ideaOf(left.document), ideaOf(right.document));
    expect(d.identical).toBe(true);
    expect(d.distinct).toBe(false);
  });

  it("tells a zone layout from a strip layout", () => {
    const zone = drawn.find((c) => c.arrangement.startsWith("zones-"))!;
    const strip = drawn.find((c) => !c.arrangement.startsWith("zones-"))!;
    const d = compareIdeas(ideaOf(zone.doc), ideaOf(strip.doc));
    expect(d.identical).toBe(false);
    expect(d.graph).toBeGreaterThan(0);
  });
});

/**
 * The benchmark: every scenario planned as the editor shows it (three
 * layouts), summed up. A planner change that moves these numbers should say
 * why in its commit; see `npm run plans:bench` for the plans themselves.
 */
describe("generation benchmark", () => {
  for (const s of BENCH_SCENARIOS) {
    it(s.name, () => {
      expect(summarise(s.name, runScenario(s))).toMatchSnapshot();
    });
  }
});
