import { applyCommand } from "../commands/apply";
import { createPlanDocument } from "../commands/factory";
import { validateDocument } from "../commands/validate";
import { furnishPlan } from "../furniture/furnish";
import { analyzeEnvelope } from "../geometry/envelope";
import { risersFor } from "../geometry/stairs";
import { DEFAULT_HOUSE, DOOR_PRESET, STAIR_PRESET } from "../plan/defaults";
import { levelView, spliceLevel } from "../plan/levels";
import type { PlanDocument } from "../plan/types";
import { assessHouseSense, type HouseSense } from "./houseSense";
import { emitLayout } from "./layoutEmitter";
import type { PlanCandidate, PlanningRequest, PlanningResult } from "./planner";
import { storeyPrograms, type Relaxation } from "./program";
import { planStoreys, storeyFootprints, type StoreyPlan } from "./storeyPlanner";
import { shellFrom } from "./wingPlanner";
import { hallWidthFor } from "./zoning";

/**
 * Two-storey layouts as plan candidates: the ground floor and the floor
 * above emitted into one house, joined by stairs, furnished and judged as a
 * whole. In the user's rectangle (stacked to two floors), or in houses sized
 * from the rooms.
 */

export const STOREY_TITLE = "Two storeys, bedrooms upstairs";
export const STOREY_SUMMARY = "Living spaces downstairs beside the hall; the stairs lead up to the bedrooms off the landing.";

export const isStoreyLayout = (arrangement: string | undefined) => !!arrangement?.startsWith("storeys-");

/** The layout family, for variety: the same layouts on the other side count as one. */
export const storeyFamily = (arrangement: string) => arrangement.replace(/^storeys-[lrab]\./, "storeys.").replace(/@.*$/, "");

type Judged = PlanCandidate & { sense: HouseSense };

const bySense = (a: HouseSense, b: HouseSense) => a.findings.length - b.findings.length || b.score - a.score;

/** Builds one storey plan into a house of two floors; why not, if it doesn't build. */
export function buildStoreys(shell: PlanDocument, plan: StoreyPlan, prefix: string, opts: { hallWidth: number; doorWidth: number; naturalLight: boolean }): { ok: true; document: PlanDocument; notes: string[] } | { ok: false; reason: string } {
  const emit = { hallWidth: opts.hallWidth, doorWidth: opts.doorWidth, naturalLight: opts.naturalLight, doorAvoid: [plan.stairs.rect] };
  const ground = emitLayout(shell, plan.ground, { ...emit, prefix: `${prefix}-g` });
  if (!ground.ok) return ground;
  const added = applyCommand(ground.document, { type: "addLevel", idPrefix: `${prefix}-l` });
  if (!added.ok) return { ok: false, reason: added.issues[0]?.message ?? "the floor above couldn't be added." };
  let doc = added.document;
  const upperId = doc.levels[1].id;
  const upper = emitLayout(levelView(doc, upperId), plan.upper, { ...emit, prefix: `${prefix}-u`, upper: true });
  if (!upper.ok) return upper;
  doc = spliceLevel(doc, upperId, upper.document);
  const stairs = applyCommand(doc, {
    type: "addStairs",
    staircase: { id: `${prefix}-stairs`, fromLevelId: doc.levels[0].id, toLevelId: upperId, shape: "straight", foot: plan.stairs.foot, rotation: plan.stairs.rotation, width: STAIR_PRESET.width, going: STAIR_PRESET.going },
  });
  if (!stairs.ok) return { ok: false, reason: stairs.issues[0]?.message ?? "the stairs don't fit." };
  const issues = validateDocument(stairs.document);
  if (issues.length) return { ok: false, reason: issues[0].message };
  return { ok: true, document: stairs.document, notes: [...ground.notes, ...upper.notes] };
}

/** How many plans to build per house: building and furnishing two floors is the slow part. */
const BUILDS = 4;
/** Most house sizes tried when sizing from the rooms. */
const MAX_SIZES = 12;

/** The best two-storey layouts in a rectangular single-floor shell with its rear wall set, best first. */
function candidatesIn(shell: PlanDocument, request: PlanningRequest, prefix: string, excluded: (id: string) => boolean): { candidates: Judged[]; problem: string | null } {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const level = shell.levels[0];
  const env = analyzeEnvelope(level);
  if (!env.ok) return { candidates: [], problem: null };
  if (!env.info.isRectangle) return { candidates: [], problem: "two-storey layouts work in rectangular houses for now." };
  const prefs = new Set(intent.brief.preferences);
  const hallWidth = hallWidthFor(prefs);
  const doorWidth = prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width;
  const rearSide = (level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const risers = risersFor(level.defaultWallHeight + DEFAULT_HOUSE.floorThickness);
  const candidates: Judged[] = [];
  let problem: string | null = null;
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (candidates.length) break;
    const programs = storeyPrograms(intent.brief, relax);
    const planned = planStoreys(env.info.axisRect, programs.ground, programs.upper, { hallWidth, doorWidth, rearSide, externalThickness: env.info.externalThickness, risers });
    problem = planned.problem ?? problem;
    const queue = planned.plans.filter((p) => !excluded(p.id)).slice(0, BUILDS);
    for (const [i, plan] of queue.entries()) {
      const id = `${prefix}t${i + 1}`;
      const built = buildStoreys({ ...shell, id: `${id}-plan` }, plan, id, { hallWidth, doorWidth, naturalLight: prefs.has("maximize_natural_light") });
      if (!built.ok) {
        problem = built.reason;
        continue;
      }
      const notes = [...programs.notes, ...built.notes];
      if (intent.brief.additionalInstructions.trim() && !request.instructionsRead) {
        notes.push("Additional instructions are saved with the brief, but no AI read them, and this planner doesn't read free text.");
      }
      candidates.push({ document: built.document, summary: STOREY_SUMMARY, notes, seed: i, arrangement: plan.id, sense: assessHouseSense(built.document) });
    }
  }
  candidates.sort((a, b) => bySense(a.sense, b.sense));
  return { candidates, problem };
}

/** Up to `count`, best first, a different family each where the plans are equally sound. */
function pick(candidates: Judged[], count: number): PlanCandidate[] {
  const ranked = [...candidates].sort((a, b) => bySense(a.sense, b.sense));
  const fewest = Math.min(...ranked.map((c) => c.sense.findings.length));
  const picked: Judged[] = [];
  const seen = new Set<string>();
  const keyOf = (c: Judged) => `${storeyFamily(c.arrangement!)}${c.footprint ? `${c.footprint.width}x${c.footprint.depth}` : ""}`;
  for (const c of ranked) {
    if (picked.length >= count || seen.has(keyOf(c)) || c.sense.findings.length > fewest) continue;
    seen.add(keyOf(c));
    picked.push(c);
  }
  for (const c of ranked) if (picked.length < count && !picked.includes(c)) picked.push(c);
  return picked.map((c, seed) => {
    const copy: PlanCandidate & { sense?: unknown } = { ...c };
    delete copy.sense;
    return { ...copy, document: furnishPlan(c.document, c.document.id.replace(/-plan$/, "")), seed };
  });
}

/** Two-storey layouts for the request: in the user's house, or in houses sized from the rooms. */
export function planStoreyLayouts(request: PlanningRequest): PlanningResult {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const excluded = new Set(intent.exclude ?? []);
  const sourceLevel = request.source.levels[0];
  const env = analyzeEnvelope(sourceLevel);
  if (intent.footprint !== "auto") {
    if (!env.ok) return { candidates: [], issues: [{ code: "invalid-source", message: env.message }] };
    // The user's own house, from its ground floor: the floors above are planned afresh.
    const shell = shellFrom({ ...request.source, levels: [sourceLevel] }, env.info, `${request.idPrefix}-t`);
    const { candidates, problem } = shell ? candidatesIn(shell, request, `${request.idPrefix}-`, (id) => excluded.has(id)) : { candidates: [], problem: null };
    if (candidates.length) return { candidates: pick(candidates, intent.count), issues: [] };
    return { candidates: [], issues: [{ code: "does-not-fit", message: `No two-storey layout fits: ${problem ?? "these rooms don't fit this house."}`, tooSmall: true }] };
  }
  const externalThickness = env.ok ? env.info.externalThickness : DEFAULT_HOUSE.externalThickness;
  const wallHeight = sourceLevel?.defaultWallHeight ?? DEFAULT_HOUSE.wallHeight;
  const prefs = new Set(intent.brief.preferences);
  const doorWidth = prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width;
  const risers = risersFor(wallHeight + DEFAULT_HOUSE.floorThickness);
  const out: Judged[] = [];
  let problem: string | null = null;
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (out.length) break;
    const programs = storeyPrograms(intent.brief, relax);
    const sizes = storeyFootprints(programs.ground, programs.upper, { externalThickness, doorWidth, risers, plot: intent.plot });
    // Sizes in turn until enough houses have layouts: one for a single layout (the live preview), else three.
    const wanted = intent.count <= 1 ? 1 : 3;
    let houses = 0;
    for (const [fi, fp] of sizes.slice(0, MAX_SIZES).entries()) {
      if (houses >= wanted) break;
      const prefix = `${request.idPrefix}-b${fi + 1}`;
      let shell = createPlanDocument({ id: `${prefix}-plan`, name: request.source.name, width: fp.width, depth: fp.depth, externalThickness, wallHeight, idPrefix: `${prefix}-s` });
      // Houses sized from the rooms have the street to the south, so the garden to the north.
      const shellEnv = analyzeEnvelope(shell.levels[0]);
      if (shellEnv.ok) {
        const rear = applyCommand(shell, { type: "setRearWall", wallId: shellEnv.info.sides.north });
        if (rear.ok) shell = rear.document;
      }
      const key = `2s:${fp.key}`;
      const built = candidatesIn(shell, request, prefix, (id) => excluded.has(`${id}@${key}`));
      problem = built.problem ?? problem;
      if (built.candidates.length) houses++;
      // Two per house at most, of different families, so the sizes vary too.
      const families = new Set<string>();
      for (const c of built.candidates) {
        if (families.size >= 2 || families.has(storeyFamily(c.arrangement!))) continue;
        families.add(storeyFamily(c.arrangement!));
        const shape = fp.width / fp.depth > 1.25 ? "A wide" : fp.width / fp.depth < 0.8 ? "A deep" : "A compact";
        out.push({ ...c, summary: `${shape} ${fp.width} × ${fp.depth} m two-storey house. ${STOREY_SUMMARY}`, variant: `${c.arrangement}@${key}`, footprint: { width: fp.width, depth: fp.depth, shape: fp.width / fp.depth > 1.25 ? "wide" : fp.width / fp.depth < 0.8 ? "deep" : "compact" } });
      }
    }
  }
  if (out.length) return { candidates: pick(out, intent.count), issues: [] };
  return { candidates: [], issues: [{ code: "does-not-fit", message: `No two-storey layout fits: ${problem ?? "these rooms don't fit a house the planner can draw."}` }] };
}
