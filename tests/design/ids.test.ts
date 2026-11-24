import { describe, expect, it } from "vitest";
import { runScenario } from "@/domain/design/eval/benchmark";
import { planLayouts } from "@/domain/design/stripPlanner";
import { BENCH_SCENARIOS } from "../fixtures/benchScenarios";
import { OUTLINES } from "../fixtures/outlines";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { apply, envelope, newHouse, newOutlineHouse } from "../helpers";

/**
 * The ids every planner gives its layouts. They are saved in project files
 * and drive "Show similar" and "More layouts", so a change to how planning is
 * organised must leave them exactly as they are; change this snapshot only
 * when a planner's own choices change on purpose.
 */
describe("layout ids", () => {
  it("stay the same for every benchmark scenario", () => {
    const ids = Object.fromEntries(BENCH_SCENARIOS.map((s) => [s.name, runScenario(s, 3).candidates.map((c) => c.arrangement)]));
    expect(ids).toMatchSnapshot();
    // Every scenario is planned in full: slow beside the other test files.
  }, 60_000);

  it("stay the same for drawn houses of every named shape, and for more and similar layouts", () => {
    const out: Record<string, unknown> = {};
    for (const [name, ring] of Object.entries(OUTLINES)) {
      let doc = newOutlineHouse([...ring]);
      doc = apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
      const r = planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3 }, source: doc, brief: DEFAULT_BRIEF, idPrefix: "i" });
      out[name] = r.candidates.map((c) => [c.arrangement, c.variant ?? null]);
    }
    const rect = apply(newHouse(10, 9), { type: "setRearWall", wallId: envelope(newHouse(10, 9)).sides.north });
    const first = planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3 }, source: rect, brief: DEFAULT_BRIEF, idPrefix: "i" }).candidates;
    out.rectangle = first.map((c) => c.arrangement);
    out.more = planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3, exclude: first.map((c) => c.variant ?? c.arrangement!) }, source: rect, brief: DEFAULT_BRIEF, idPrefix: "i" }).candidates.map((c) => c.arrangement);
    out.similar = planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3, similarTo: first[0].variant ?? first[0].arrangement! }, source: rect, brief: DEFAULT_BRIEF, idPrefix: "i" }).candidates.map((c) => c.arrangement);
    expect(out).toMatchSnapshot();
  }, 60_000);
});
