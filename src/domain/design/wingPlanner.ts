import { applyCommand } from "../commands/apply";
import { createPlanDocument } from "../commands/factory";
import { furnishPlan } from "../furniture/furnish";
import { analyzeEnvelope, type EnvelopeInfo } from "../geometry/envelope";
import { FAMILY_WORD } from "../geometry/outline";
import { describeOutline } from "../geometry/outlineDescription";
import { polygonArea } from "../geometry/polygons";
import { DEFAULT_HOUSE, DOOR_PRESET } from "../plan/defaults";
import { shapeFootprintsFor, type ShapeFamily, type ShapeFootprint } from "./footprint";
import type { PlanDocument } from "../plan/types";
import { emitLayout } from "./layoutEmitter";
import type { PlanCandidate, PlanningRequest, PlanningResult } from "./planner";
import { programFromBrief, type Relaxation } from "./program";
import { planWings, WING_ARRANGEMENTS, type LayoutPlan, type WingArrangement } from "./wingLayout";
import { repeats } from "./select/pick";
import { hallWidthFor } from "./zoning";

/**
 * Layouts for houses that aren't rectangles: the wing layouts of
 * `planWings`, built as plan documents, the best first and the first few
 * from different ideas. Rectangles keep the strip planner.
 */

/** Card titles for wing arrangements, keyed by the arrangement part of a layout id. */
export const WING_TITLE: Record<WingArrangement, string> = Object.fromEntries(WING_ARRANGEMENTS.map((a) => [a.id, a.title])) as Record<WingArrangement, string>;

/** The arrangement a wing layout id ("wings-garden-living.p0.c3") belongs to. */
export function wingArrangementOf(id: string): WingArrangement | null {
  const match = /^wings-([a-z-]+)\.p\d+\.c\d+$/.exec(id);
  return match && (WING_ARRANGEMENTS as ReadonlyArray<{ id: string }>).some((a) => a.id === match[1]) ? (match[1] as WingArrangement) : null;
}

/** Most layouts built per request: building is the slow part. */
const MAX_BUILDS = 24;

/** The source's outline as a fresh shell, with its garden side. */
export function shellFrom(source: PlanDocument, env: EnvelopeInfo, prefix: string): PlanDocument | null {
  const level = source.levels[0];
  const shell = createPlanDocument({
    id: `${prefix}-plan`,
    name: source.name,
    outline: env.outsideRing,
    externalThickness: env.externalThickness,
    wallHeight: level.defaultWallHeight,
    idPrefix: `${prefix}-s`,
  });
  if (!level.rearWallId) return shell;
  // The rear wall is the shell's wall along the same outside face.
  const rear = env.edges.find((e) => e.wallId === level.rearWallId);
  const shellEnv = analyzeEnvelope(shell.levels[0]);
  if (!rear || !shellEnv.ok) return shell;
  const match = shellEnv.info.edges.find(
    (e) => e.facing === rear.facing && Math.abs(e.outside.start.x - rear.outside.start.x) < 1e-6 && Math.abs(e.outside.start.y - rear.outside.start.y) < 1e-6,
  );
  if (!match) return shell;
  const result = applyCommand(shell, { type: "setRearWall", wallId: match.wallId });
  return result.ok ? result.document : shell;
}

/**
 * Orders layouts so the first few differ: the best of each arrangement in
 * turn, then the rest by score.
 */
function varied(plans: LayoutPlan[]): LayoutPlan[] {
  const firsts: LayoutPlan[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    if (seen.has(plan.arrangement)) continue;
    seen.add(plan.arrangement);
    firsts.push(plan);
  }
  return [...firsts, ...plans.filter((p) => !firsts.includes(p))];
}

export function planWingLayouts(request: PlanningRequest): PlanningResult {
  const intent = request.intent;
  if (intent.action !== "generate_layouts") return { candidates: [], issues: [{ code: "unsupported-intent", message: "Only whole layouts are planned here." }] };
  const env = analyzeEnvelope(request.source.levels[0]);
  if (!env.ok) return { candidates: [], issues: [{ code: "invalid-source", message: env.message }] };
  const prefs = new Set(intent.brief.preferences);
  const hallWidth = hallWidthFor(prefs);
  const doorWidth = prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width;
  const level = request.source.levels[0];
  const rearSide = (level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const arrangements = WING_ARRANGEMENTS.map((a) => a.id).filter((a) => !(prefs.has("kitchen_faces_garden") && a === "quiet-garden"));
  const excluded = new Set(intent.exclude ?? []);
  const similar = intent.similarTo ? wingArrangementOf(intent.similarTo) : null;

  const candidates: PlanCandidate[] = [];
  const offered = new Set<string>();
  let lastProblem: string | null = null;
  let builds = 0;
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (candidates.length >= intent.count) break;
    const program = programFromBrief(intent.brief, relax);
    const { plans, problem } = planWings(env.info.axisRing, program, { hallWidth, doorWidth, rearSide, arrangements });
    lastProblem = problem ?? lastProblem;
    let queue = varied(plans).filter((p) => !excluded.has(p.id) && !offered.has(p.id));
    if (similar) queue = [...queue.filter((p) => p.arrangement === similar), ...queue.filter((p) => p.arrangement !== similar)];
    const made = new Set(candidates.map((c) => JSON.stringify(Object.values(c.document.levels[0].walls).map((w) => [c.document.levels[0].vertices[w.startVertexId], c.document.levels[0].vertices[w.endVertexId]]))));
    for (const plan of queue) {
      if (candidates.length >= intent.count || builds >= MAX_BUILDS) break;
      builds++;
      const prefix = `${request.idPrefix}-${candidates.length + 1}`;
      const shell = shellFrom(request.source, env.info, prefix);
      if (!shell) continue;
      const built = emitLayout(shell, plan, { prefix, hallWidth, doorWidth, naturalLight: prefs.has("maximize_natural_light") });
      if (!built.ok) {
        lastProblem = built.reason;
        continue;
      }
      const walls = built.document.levels[0];
      const fingerprint = JSON.stringify(Object.values(walls.walls).map((w) => [walls.vertices[w.startVertexId], walls.vertices[w.endVertexId]]));
      if (made.has(fingerprint) || (intent.count > 1 && repeats(built.document, candidates.map((c) => c.document)))) continue;
      made.add(fingerprint);
      offered.add(plan.id);
      const notes = [...program.notes, ...plan.notes, ...built.notes];
      if (intent.brief.additionalInstructions.trim() && !request.instructionsRead) {
        notes.push("Additional instructions are saved with the brief, but no AI read them, and this planner doesn't read free text.");
      }
      const summary = WING_ARRANGEMENTS.find((a) => a.id === plan.arrangement)!.summary;
      candidates.push({
        document: furnishPlan(built.document, prefix),
        summary: `${capital(describeOutline(env.info).words)} house. ${summary}`,
        notes,
        seed: plans.indexOf(plan),
        arrangement: plan.id,
      });
    }
  }
  if (candidates.length) return { candidates, issues: [] };
  if (excluded.size) {
    return { candidates, issues: [{ code: "does-not-fit", message: "There are no more distinct layouts for this brief. Change the brief to explore other options." }] };
  }
  return { candidates, issues: [{ code: "does-not-fit", ...tooSmall(request, env.info, hallWidth, lastProblem) }] };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why nothing fits: the house is too small for the rooms, or the shape gets in the way. */
function tooSmall(request: PlanningRequest, env: EnvelopeInfo, hallWidth: number, problem: string | null): { message: string; tooSmall?: boolean } {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const program = programFromBrief(intent.brief, 2);
  const rooms = program.spaces.reduce((sum, s) => sum + s.target + (s.ensuite ? 3.5 : 0), 0);
  // Rooms, plus hall and walls, roughly as the strip planner needs them.
  const need = Math.round(rooms * 1.12 + hallWidth * Math.sqrt(rooms) * 1.5);
  const have = Math.round(polygonArea({ outer: env.insideRing, holes: [] }));
  const shape = describeOutline(env).words;
  if (need > have) {
    return {
      message: `These rooms need about ${need} m² inside; your ${shape} house has about ${have} m². Size the house from the rooms, make the house bigger in Structure, or ask for fewer rooms.`,
      tooSmall: true,
    };
  }
  return { message: `No layout fits this ${shape} house: ${problem ?? "the rooms don't fit its wings."}` };
}

/** Most outlines tried per request when the planner chooses the shape. */
const MAX_SHAPES = 8;

/**
 * Layouts whose house the planner shapes and sizes from the rooms: L, T or
 * U outlines from `shapeFootprintsFor`, each laid out by the wing planner,
 * one layout per outline so the concepts differ in shape and size.
 */
export function planAutoShapes(request: PlanningRequest, families: readonly ShapeFamily[], excluded: ReadonlySet<string>): PlanningResult {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const sourceLevel = request.source.levels[0];
  const env = sourceLevel ? analyzeEnvelope(sourceLevel) : null;
  const externalThickness = env?.ok ? env.info.externalThickness : DEFAULT_HOUSE.externalThickness;
  const wallHeight = sourceLevel?.defaultWallHeight ?? DEFAULT_HOUSE.wallHeight;
  const opts = { externalThickness, hallWidth: hallWidthFor(new Set(intent.brief.preferences)), plot: intent.plot };
  const [similarArrangement, similarKey] = intent.similarTo?.includes("@") ? intent.similarTo.split("@") : [intent.similarTo, undefined];

  const candidates: PlanCandidate[] = [];
  const usedKeys = new Set<string>();
  let lastProblem: string | null = null;
  let tried = 0;
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (candidates.length >= intent.count) break;
    const program = programFromBrief(intent.brief, relax);
    const lists = families.map((f) => shapeFootprintsFor(program, f, opts));
    // The first outline of each family, then the second, …
    let options = Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, i) => lists.map((l) => l[i])).flat().filter((o): o is ShapeFootprint => !!o);
    if (similarKey) options = [...options.filter((o) => o.key === similarKey), ...options.filter((o) => o.key !== similarKey)];
    for (const fp of options) {
      if (candidates.length >= intent.count || tried >= MAX_SHAPES) break;
      if (usedKeys.has(fp.key)) continue;
      tried++;
      const prefix = `${request.idPrefix}-${candidates.length + 1}`;
      let shell = createPlanDocument({ id: `${prefix}-plan`, name: request.source.name, outline: fp.outline, externalThickness, wallHeight, idPrefix: `${prefix}-s` });
      // Presets put the street to the south, so the garden is to the north.
      const shellEnv = analyzeEnvelope(shell.levels[0]);
      if (shellEnv.ok) {
        const rear = applyCommand(shell, { type: "setRearWall", wallId: shellEnv.info.sides.north });
        if (rear.ok) shell = rear.document;
      }
      const result = planWingLayouts({
        ...request,
        source: shell,
        idPrefix: prefix,
        intent: { action: "generate_layouts", brief: intent.brief, count: 2, ...(similarArrangement && similarKey === fp.key ? { similarTo: similarArrangement } : {}) },
      });
      const pick = result.candidates.find((c) => !excluded.has(`${c.arrangement}@${fp.key}`));
      if (!pick) {
        lastProblem = result.issues[0]?.message ?? lastProblem;
        continue;
      }
      usedKeys.add(fp.key);
      const words = shellEnv.ok ? describeOutline(shellEnv.info).words : fp.family;
      const idea = WING_ARRANGEMENTS.find((a) => a.id === wingArrangementOf(pick.arrangement!))?.summary ?? "";
      candidates.push({
        ...pick,
        summary: `${/^[aeiou]|^L/i.test(words) ? "An" : "A"} ${words} ${fp.width} × ${fp.depth} m house. ${idea}`,
        variant: `${pick.arrangement}@${fp.key}`,
        footprint: { width: fp.width, depth: fp.depth, shape: fp.shape },
      });
    }
  }
  if (candidates.length) return { candidates, issues: [] };
  if (excluded.size) return { candidates, issues: [{ code: "does-not-fit", message: "There are no more distinct layouts for these rooms. Change the rooms to explore other options." }] };
  const plot = intent.plot;
  const message =
    plot?.maxWidth || plot?.maxDepth
      ? `These rooms don't fit a ${families.length > 1 ? "shaped" : FAMILY_WORD[families[0]]} house within a ${plot.maxWidth ?? "any"} × ${plot.maxDepth ?? "any"} m plot. Raise the plot size, choose another shape, or choose fewer rooms.`
      : `No ${families.length > 1 ? "shaped" : FAMILY_WORD[families[0]]} house fits these rooms${lastProblem ? `: ${lastProblem}` : "."}`;
  return { candidates, issues: [{ code: "does-not-fit", message }] };
}
