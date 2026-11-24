import { applyCommand } from "../commands/apply";
import { createPlanDocument } from "../commands/factory";
import { validateDocument } from "../commands/validate";
import { furnishPlan } from "../furniture/furnish";
import { analyzeEnvelope } from "../geometry/envelope";
import { describeOutline } from "../geometry/outlineDescription";
import { roundToPrecision } from "../geometry/numeric";
import { axisToOutside } from "../geometry/outline";
import { risersFor } from "../geometry/stairs";
import { DEFAULT_HOUSE, DOOR_PRESET, STAIR_PRESET } from "../plan/defaults";
import { levelView, spliceLevel } from "../plan/levels";
import { fitToSite, type SiteFit } from "../site/fit";
import type { Rect } from "../geometry/vector";
import type { PlanDocument, Point2 } from "../plan/types";
import { assessHouseSense, type HouseSense } from "./houseSense";
import { chargeFurniture, pickIdeas, repeats } from "./select/pick";
import { placedBy } from "./placement";
import type { HouseBrief } from "../brief/schema";
import { bySense } from "./sense";
import { shapeOf, type ShapeFamily } from "./footprint";
import { emitLayout } from "./layoutEmitter";
import type { PlanCandidate, PlanningRequest, PlanningResult } from "./planner";
import { storeyPrograms, type Relaxation } from "./program";
import { planStacks, type StackKind } from "./stackPlanner";
import { planStoreys, storeyFootprints, type StoreyPlan } from "./storeyPlanner";
import { storeyShapeFootprints } from "./storeyShapes";
import type { LabeledRoom } from "./wingLayout";
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

export const STACK_TITLE = "Two storeys, part single-storey";

export const isStoreyLayout = (arrangement: string | undefined) => !!arrangement?.startsWith("storeys-");

/** In a house that isn't a rectangle, how far the floor above covers it. */
export function stackOf(arrangement: string): StackKind | null {
  const tag = arrangement.split(".")[1] ?? "";
  return /^s\d/.test(tag) ? "setback" : /^w\d/.test(tag) ? "full" : null;
}

/** The title of a two-storey layout. */
export const storeyTitle = (arrangement: string) => (stackOf(arrangement) === "setback" ? STACK_TITLE : STOREY_TITLE);

/** What a two-storey layout is like, naming the rooms downstairs in its wings. */
function storeySummary(plan: StoreyPlan): string {
  const main = plan.main;
  if (!plan.stack || !main) return STOREY_SUMMARY;
  const inMain = (r: LabeledRoom) => r.rects.every((q) => (q.minX + q.maxX) / 2 > main.minX && (q.minX + q.maxX) / 2 < main.maxX && (q.minY + q.maxY) / 2 > main.minY && (q.minY + q.maxY) / 2 < main.maxY);
  const wing = plan.ground.rooms.filter((r) => r.kind !== "hall" && !inMain(r)).map((r) => r.name.toLowerCase());
  const list = wing.length > 1 ? `${wing.slice(0, -1).join(", ")} and ${wing[wing.length - 1]}` : wing[0];
  const holds = plan.wings && plan.wings > 1 ? "wings hold" : "wing holds";
  if (plan.stack === "full") return wing.length ? `Bedrooms upstairs over the whole house; downstairs the ${holds} the ${list}.` : STOREY_SUMMARY;
  if (!wing.length) return "Living spaces downstairs beside the hall; the floor above covers the main part of the house, and the rest is single-storey.";
  return `Bedrooms upstairs over the main part of the house; the single-storey ${holds} the ${list}.`;
}

/** Plans to build, best first, spread over the parts of the house that take the floor above and how far it covers. */
function spread(plans: StoreyPlan[], count: number): StoreyPlan[] {
  if (!plans.some((p) => p.stack)) return plans.slice(0, count);
  const groups = new Map<string, StoreyPlan[]>();
  for (const p of plans) {
    const key = `${p.stack}:${p.core}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const out: StoreyPlan[] = [];
  for (let round = 0; out.length < count && round < count; round++) for (const list of groups.values()) if (list[round] && out.length < count) out.push(list[round]);
  return out;
}

/** The layout family, for variety: the same layouts on the other side count as one. */
export const storeyFamily = (arrangement: string) => arrangement.replace(/^storeys-[lrab]\./, "storeys.").replace(/@.*$/, "");

type Judged = PlanCandidate & { sense: HouseSense };


/** Builds one storey plan into a house of two floors; why not, if it doesn't build. */
export function buildStoreys(shell: PlanDocument, plan: StoreyPlan, prefix: string, opts: { hallWidth: number; doorWidth: number; naturalLight: boolean }): { ok: true; document: PlanDocument; notes: string[] } | { ok: false; reason: string } {
  const emit = { hallWidth: opts.hallWidth, doorWidth: opts.doorWidth, naturalLight: opts.naturalLight, doorAvoid: [plan.stairs.rect] };
  const ground = emitLayout(shell, plan.ground, { ...emit, prefix: `${prefix}-g` });
  if (!ground.ok) return ground;
  const added = applyCommand(ground.document, { type: "addLevel", idPrefix: `${prefix}-l` });
  if (!added.ok) return { ok: false, reason: added.issues[0]?.message ?? "the floor above couldn't be added." };
  let doc = added.document;
  const upperId = doc.levels[1].id;
  // A floor over part of the house only: its own outline, with the garden on the same side.
  if (plan.upperAxis) {
    const env = analyzeEnvelope(shell.levels[0]);
    if (!env.ok) return { ok: false, reason: env.message };
    const t = env.info.externalThickness;
    const rear = (shell.levels[0].rearWallId && env.info.sideOfWall[shell.levels[0].rearWallId]) || "north";
    const outline = axisToOutside(plan.upperAxis, t).map((p) => ({ x: roundToPrecision(p.x), y: roundToPrecision(p.y) }));
    const drawn = applyCommand(doc, { type: "createOutline", levelId: upperId, outline, externalThickness: t, wallHeight: doc.levels[1].defaultWallHeight, idPrefix: `${prefix}-o` });
    if (!drawn.ok) return { ok: false, reason: drawn.issues[0]?.message ?? "the floor above couldn't be drawn." };
    const upperEnv = analyzeEnvelope(drawn.document.levels[1]);
    if (!upperEnv.ok) return { ok: false, reason: upperEnv.message };
    const rearSet = applyCommand(drawn.document, { type: "setRearWall", levelId: upperId, wallId: upperEnv.info.sides[rear] });
    if (!rearSet.ok) return { ok: false, reason: rearSet.issues[0]?.message ?? "the floor above couldn't be drawn." };
    doc = rearSet.document;
  }
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
/** In a house that isn't a rectangle, where there are more ways to stack it. */
const STACK_BUILDS = 6;
/** Most house sizes tried when sizing from the rooms. */
const MAX_SIZES = 12;

/** The best two-storey layouts in a single-floor shell with its rear wall set, best first. */
function candidatesIn(shell: PlanDocument, request: PlanningRequest, prefix: string, excluded: (id: string) => boolean, prefer?: Rect): { candidates: Judged[]; problem: string | null } {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const level = shell.levels[0];
  const env = analyzeEnvelope(level);
  if (!env.ok) return { candidates: [], problem: null };
  const prefs = new Set(intent.brief.preferences);
  const hallWidth = hallWidthFor(prefs);
  const doorWidth = prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width;
  const rearSide = (level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const risers = risersFor(level.defaultWallHeight + DEFAULT_HOUSE.floorThickness);
  const candidates: Judged[] = [];
  let problem: string | null = null;
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (candidates.length) break;
    // Wings give the ground floor room to spare, so an office stays down there.
    const programs = storeyPrograms(intent.brief, relax, { wings: !env.info.isRectangle });
    const opts = { hallWidth, doorWidth, rearSide, externalThickness: env.info.externalThickness, risers, kitchenGarden: prefs.has("kitchen_faces_garden"), primaryPrivate: prefs.has("primary_bedroom_private"), utilityNearKitchen: prefs.has("utility_near_kitchen") };
    const planned = env.info.isRectangle
      ? planStoreys(env.info.axisRect, programs.ground, programs.upper, opts)
      : planStacks(env.info.axisRing, programs.ground, programs.upper, { ...opts, kinds: ["setback", "full"], prefer });
    problem = planned.problem ?? problem;
    // A plan the same as one already built (mirrored, bedrooms swapped) doesn't count: the next is built instead, up to twice as many.
    const builds = env.info.isRectangle ? BUILDS : STACK_BUILDS;
    const queue = spread(planned.plans.filter((p) => !excluded(p.id)), builds * 2);
    for (const [i, plan] of queue.entries()) {
      if (candidates.length >= builds) break;
      const id = `${prefix}t${i + 1}`;
      const built = buildStoreys({ ...shell, id: `${id}-plan` }, plan, id, { hallWidth, doorWidth, naturalLight: prefs.has("maximize_natural_light") });
      if (!built.ok) {
        problem = built.reason;
        continue;
      }
      const notes = [...programs.notes, ...plan.ground.notes, ...built.notes];
      if (intent.brief.additionalInstructions.trim() && !request.instructionsRead) {
        notes.push("Additional instructions are saved with the brief, but no AI read them, and this planner doesn't read free text.");
      }
      if (intent.count > 1 && repeats(built.document, candidates.map((c) => c.document))) continue;
      candidates.push({ document: built.document, summary: storeySummary(plan), notes, seed: i, arrangement: plan.id, sense: assessHouseSense(built.document) });
    }
  }
  candidates.sort((a, b) => bySense(a.sense, b.sense));
  return { candidates, problem };
}

/** Up to `count`, best first, a different design idea each where one is nearly as good (`pickIdeas`). */
function pick(all: Judged[], count: number, brief?: HouseBrief, site?: SiteFit): PlanCandidate[] {
  // On a traced site, only the layouts that fit somewhere on it, before any are picked.
  const candidates = fitToSite(all, site);
  // Several to show: the best few are charged for furniture that won't fit (the live preview skips it).
  return pickIdeas(count > 1 ? chargeFurniture(candidates) : candidates, count, placedBy(brief)).map((c, seed) => {
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
    if (candidates.length) return { candidates: pick(candidates, intent.count, intent.brief, request.site), issues: [] };
    return { candidates: [], issues: [{ code: "does-not-fit", message: `No two-storey layout fits: ${problem ?? "these rooms don't fit this house."}`, tooSmall: true }] };
  }
  const externalThickness = env.ok ? env.info.externalThickness : DEFAULT_HOUSE.externalThickness;
  const wallHeight = sourceLevel?.defaultWallHeight ?? DEFAULT_HOUSE.wallHeight;
  const prefs = new Set(intent.brief.preferences);
  const doorWidth = prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width;
  const risers = risersFor(wallHeight + DEFAULT_HOUSE.floorThickness);
  // The house shape the brief asks for: rectangles, L, T or U houses with single-storey wings, or a mix.
  const shape = intent.brief.houseShape;
  const families: ShapeFamily[] = shape === "L" || shape === "T" || shape === "U" ? [shape] : shape === "any" ? ["L", "U", "T"] : [];
  const rectangles = !shape || shape === "rectangle" || shape === "any";
  const out: Judged[] = [];
  let problem: string | null = null;
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (out.length) break;
    const programs = storeyPrograms(intent.brief, relax, { wings: !rectangles });
    const opts = { externalThickness, doorWidth, risers, plot: intent.plot };
    // Each kind of house in turn, so a mix brings a rectangle and each shape.
    const lists: Array<Array<{ width: number; depth: number; key: string; outline?: Point2[]; core?: Rect }>> = [
      ...(rectangles ? [storeyFootprints(programs.ground, programs.upper, opts)] : []),
      ...families.map((f) => storeyShapeFootprints(programs.ground, programs.upper, f, opts)),
    ];
    const sizes = Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, i) => lists.flatMap((l) => (l[i] ? [l[i]] : []))).flat();
    // Sizes in turn until enough houses have layouts: one for a single layout (the live preview), else three.
    const wanted = intent.count <= 1 ? 1 : 3;
    let houses = 0;
    for (const [fi, fp] of sizes.slice(0, MAX_SIZES).entries()) {
      if (houses >= wanted) break;
      const prefix = `${request.idPrefix}-b${fi + 1}`;
      let shell = fp.outline
        ? createPlanDocument({ id: `${prefix}-plan`, name: request.source.name, outline: fp.outline, externalThickness, wallHeight, idPrefix: `${prefix}-s` })
        : createPlanDocument({ id: `${prefix}-plan`, name: request.source.name, width: fp.width, depth: fp.depth, externalThickness, wallHeight, idPrefix: `${prefix}-s` });
      // Houses sized from the rooms have the street to the south, so the garden to the north.
      const shellEnv = analyzeEnvelope(shell.levels[0]);
      if (shellEnv.ok) {
        const rear = applyCommand(shell, { type: "setRearWall", wallId: shellEnv.info.sides.north });
        if (rear.ok) shell = rear.document;
      }
      const key = `2s:${fp.key}`;
      const built = candidatesIn(shell, request, prefix, (id) => excluded.has(`${id}@${key}`), fp.core);
      problem = built.problem ?? problem;
      if (built.candidates.length) houses++;
      // Two per house at most, of different families, so the sizes vary too.
      const families = new Set<string>();
      const kind = shapeOf(fp.width, fp.depth);
      // "An L-shaped 9 × 13 m two-storey house", or "A compact 8 × 10 m …".
      const words = fp.outline && shellEnv.ok ? describeOutline(shellEnv.info).words : kind;
      const house = `${/^[aeiouL]/.test(words) ? "An" : "A"} ${words} ${fp.width} × ${fp.depth} m two-storey house`;
      for (const c of built.candidates) {
        if (families.size >= 2 || families.has(storeyFamily(c.arrangement!))) continue;
        families.add(storeyFamily(c.arrangement!));
        out.push({ ...c, summary: `${house}. ${c.summary}`, variant: `${c.arrangement}@${key}`, footprint: { width: fp.width, depth: fp.depth, shape: kind } });
      }
    }
  }
  if (out.length) return { candidates: pick(out, intent.count, intent.brief, request.site), issues: [] };
  return { candidates: [], issues: [{ code: "does-not-fit", message: `No two-storey layout fits: ${problem ?? "these rooms don't fit a house the planner can draw."}` }] };
}
