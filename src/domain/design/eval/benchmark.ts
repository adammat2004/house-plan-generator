import type { HouseBrief } from "../../brief/schema";
import { applyCommand } from "../../commands/apply";
import { createPlanDocument } from "../../commands/factory";
import { analyzeEnvelope } from "../../geometry/envelope";
import type { PlanDocument, Point2 } from "../../plan/types";
import { assessHouseSense } from "../houseSense";
import { planLayouts } from "../stripPlanner";
import { compareIdeas, DESCRIPTOR_FIELDS, ideaOf, planMetrics, type PlanMetrics } from "./metrics";

/**
 * The generation benchmark: a fixed set of briefs and houses, each planned as
 * the user would see it, and summed up in numbers that say whether the plans
 * are efficient, sensible and different from each other. The scenarios live
 * in `tests/fixtures/benchScenarios.ts`; the summary is snapshotted by
 * `tests/design/bench.test.ts` and written out by `npm run plans:bench`.
 */

export interface Scenario {
  name: string;
  brief: HouseBrief;
  /** Size the house from the rooms (with an optional plot) rather than plan inside a drawn one. */
  auto?: boolean;
  /** A drawn rectangle, outside faces, m; or a drawn outline. Street to the south. */
  width?: number;
  depth?: number;
  outline?: Point2[];
}

export interface Candidate {
  arrangement: string;
  doc: PlanDocument;
  metrics: PlanMetrics;
  score: number;
  findings: string[];
}

export interface ScenarioSummary {
  name: string;
  candidates: number;
  issue?: string;
  meanScore: number;
  /** Plans that break each plan-sense rule, by rule. */
  failing: Record<string, number>;
  hallShare: { mean: number; max: number };
  circulationShare: { mean: number; max: number };
  /** Mean share of room floor in each kind of hall. */
  hallByKind: Record<string, number>;
  hallPerDoor: number;
  /** What the front doors open into, by room type. */
  entries: Record<string, number>;
  meanDepth: number;
  privacyGradient: number;
  bedroomsOnLiving: number;
  minGlazing: number;
  furnitureMissing: number;
  /** Different descriptors among the plans. */
  ideas: number;
  /** Pairs of plans: the same plan (mirrored or reshuffled), the same idea, a different idea. */
  pairs: { identical: number; sameIdea: number; distinct: number };
  meanGraphDistance: number;
  meanSpatialDistance: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The scenario's starting house: a drawn rectangle or outline (10 × 9 m if neither), garden to the north. */
function sourceOf(s: Scenario): PlanDocument {
  const doc = s.outline
    ? createPlanDocument({ id: "bench", name: s.name, outline: s.outline, externalThickness: 0.3, wallHeight: 2.4 })
    : createPlanDocument({ id: "bench", name: s.name, width: s.width ?? 10, depth: s.depth ?? 9, externalThickness: 0.3, wallHeight: 2.4 });
  const env = analyzeEnvelope(doc.levels[0]);
  if (!env.ok) return doc;
  const rear = applyCommand(doc, { type: "setRearWall", wallId: env.info.sides.north });
  return rear.ok ? rear.document : doc;
}

/** Plans a scenario as the editor does (three layouts unless told otherwise) and measures each plan. */
export function runScenario(s: Scenario, count = 3): { candidates: Candidate[]; issue?: string } {
  const result = planLayouts({ intent: { action: "generate_layouts", brief: s.brief, count, ...(s.auto ? { footprint: "auto" as const } : {}) }, source: sourceOf(s), brief: s.brief, idPrefix: "b" });
  const candidates = result.candidates.map((c): Candidate => {
    const sense = assessHouseSense(c.document);
    return { arrangement: c.variant ?? c.arrangement ?? "", doc: c.document, metrics: planMetrics(c.document), score: sense.score, findings: sense.findings.map((f) => f.rule) };
  });
  return { candidates, ...(result.issues[0] ? { issue: result.issues[0].message } : {}) };
}

export function summarise(name: string, run: { candidates: Candidate[]; issue?: string }): ScenarioSummary {
  const { candidates } = run;
  const failing: Record<string, number> = {};
  for (const c of candidates) for (const rule of new Set(c.findings)) failing[rule] = (failing[rule] ?? 0) + 1;
  const entries: Record<string, number> = {};
  for (const c of candidates) entries[c.metrics.descriptor.entry] = (entries[c.metrics.descriptor.entry] ?? 0) + 1;
  const ground = candidates.map((c) => c.metrics.levels[0]);
  const pairs = { identical: 0, sameIdea: 0, distinct: 0 };
  const graph: number[] = [];
  const spatial: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const d = compareIdeas(ideaOf(candidates[i].doc), ideaOf(candidates[j].doc));
      graph.push(d.graph);
      spatial.push(d.spatial);
      if (d.identical) pairs.identical++;
      else if (d.distinct) pairs.distinct++;
      else pairs.sameIdea++;
    }
  }
  const ideaKey = (m: PlanMetrics) => DESCRIPTOR_FIELDS.map((f) => m.descriptor[f]).join("|");
  return {
    name,
    candidates: candidates.length,
    ...(run.issue ? { issue: run.issue } : {}),
    meanScore: r2(mean(candidates.map((c) => c.score))),
    failing: Object.fromEntries(Object.entries(failing).sort()),
    hallShare: { mean: r2(mean(candidates.map((c) => c.metrics.hallShare))), max: r2(Math.max(0, ...candidates.map((c) => c.metrics.hallShare))) },
    circulationShare: { mean: r2(mean(candidates.map((c) => c.metrics.circulationShare))), max: r2(Math.max(0, ...candidates.map((c) => c.metrics.circulationShare))) },
    hallByKind: Object.fromEntries((["entry", "corridor", "landing", "hub"] as const).map((k) => [k, r2(mean(candidates.map((c) => c.metrics.hallByKind[k])))])),
    hallPerDoor: r2(mean(ground.map((l) => l.hallPerDoor))),
    entries: Object.fromEntries(Object.entries(entries).sort()),
    meanDepth: r2(mean(ground.map((l) => l.meanDepth))),
    privacyGradient: r2(mean(ground.map((l) => l.privacyGradient))),
    bedroomsOnLiving: candidates.reduce((sum, c) => sum + c.metrics.levels.reduce((s, l) => s + l.bedroomsOnLiving, 0), 0),
    minGlazing: r2(Math.min(...candidates.flatMap((c) => c.metrics.levels.map((l) => l.minGlazing)), 1)),
    furnitureMissing: candidates.reduce((sum, c) => sum + c.metrics.furnitureMissing, 0),
    ideas: new Set(candidates.map((c) => ideaKey(c.metrics))).size,
    pairs,
    meanGraphDistance: r2(mean(graph)),
    meanSpatialDistance: r2(mean(spatial)),
  };
}
