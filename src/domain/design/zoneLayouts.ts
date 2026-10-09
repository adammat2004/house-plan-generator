import { applyCommand } from "../commands/apply";
import { createPlanDocument } from "../commands/factory";
import { furnishPlan } from "../furniture/furnish";
import { analyzeEnvelope } from "../geometry/envelope";
import { DEFAULT_HOUSE, DOOR_PRESET } from "../plan/defaults";
import type { PlanDocument } from "../plan/types";
import { emitLayout } from "./layoutEmitter";
import type { PlanCandidate, PlanningRequest } from "./planner";
import { programFromBrief, type Relaxation } from "./program";
import { assessSense, bySense, type PlanSense } from "./sense";
import { planZones, zoneFootprints } from "./zonePlanner";
import { hallWidthFor } from "./zoning";

/**
 * Zone layouts as plan candidates: in the user's rectangle, or in houses
 * sized for them from the rooms. Each zone plan is built with the emitter and
 * judged with the plan-sense checker; the best come first. They are
 * furnished only once picked (`furnishZones`), since furnishing is slow and
 * doesn't change whether a plan makes sense.
 */

export const ZONE_TITLE = "Living wing beside a bedroom wing";
export const ZONE_SUMMARY = "Living spaces open onto each other on one side; the bedrooms are off a short hall on the other.";

/** Zone plans built per house, best by their layout score: building is the slow part. */
const buildsPerHouse = (count: number) => (count <= 1 ? 3 : 4);

export type JudgedCandidate = PlanCandidate & { sense: PlanSense };

export const isZoneLayout = (arrangement: string | undefined) => !!arrangement?.startsWith("zones-");

/** The layout family, for variety: the same night zone mirrored counts as one. */
export const zoneFamily = (arrangement: string) => arrangement.replace(/^zones-[lr]\./, "zones.").replace(/o\d+/, "");

/** The best zone layouts in a rectangular shell, best first. */
export function zoneCandidates(shell: PlanDocument, request: PlanningRequest, prefix: string, excluded: (id: string) => boolean): { candidates: JudgedCandidate[]; problem: string | null } {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const level = shell.levels[0];
  const env = analyzeEnvelope(level);
  if (!env.ok || !env.info.isRectangle) return { candidates: [], problem: null };
  const prefs = new Set(intent.brief.preferences);
  const hallWidth = hallWidthFor(prefs);
  const doorWidth = prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width;
  const rearSide = (level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const candidates: JudgedCandidate[] = [];
  let problem: string | null = null;
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (candidates.length) break;
    const program = programFromBrief(intent.brief, relax);
    const zones = planZones(env.info.axisRect, program, { hallWidth, doorWidth, rearSide });
    problem = zones.problem ?? problem;
    const queue = zones.plans.filter((p) => !excluded(p.id)).slice(0, buildsPerHouse(intent.count));
    for (const [i, plan] of queue.entries()) {
      const id = `${prefix}z${i + 1}`;
      const built = emitLayout({ ...shell, id: `${id}-plan` }, plan, { prefix: id, hallWidth, doorWidth, naturalLight: prefs.has("maximize_natural_light") });
      if (!built.ok) {
        problem = built.reason;
        continue;
      }
      const notes = [...program.notes, ...built.notes];
      if (intent.brief.additionalInstructions.trim() && !request.instructionsRead) {
        notes.push("Additional instructions are saved with the brief, but no AI read them, and this planner doesn't read free text.");
      }
      candidates.push({ document: built.document, summary: ZONE_SUMMARY, notes, seed: i, arrangement: plan.id, sense: assessSense(built.document.levels[0]) });
    }
  }
  candidates.sort((a, b) => bySense(a.sense, b.sense));
  return { candidates, problem };
}

const SHAPE_WORD = { compact: "A compact", wide: "A wide", deep: "A deep" } as const;

/** Zone layouts in rectangular houses sized for them from the rooms, the best of each size, best first. */
export function autoZoneCandidates(request: PlanningRequest, excluded: ReadonlySet<string>): JudgedCandidate[] {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const sourceLevel = request.source.levels[0];
  const env = sourceLevel ? analyzeEnvelope(sourceLevel) : null;
  const externalThickness = env?.ok ? env.info.externalThickness : DEFAULT_HOUSE.externalThickness;
  const wallHeight = sourceLevel?.defaultWallHeight ?? DEFAULT_HOUSE.wallHeight;
  const prefs = new Set(intent.brief.preferences);
  const opts = { hallWidth: hallWidthFor(prefs), doorWidth: prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width, externalThickness, plot: intent.plot };
  const out: JudgedCandidate[] = [];
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (out.length) break;
    // A single layout (the live preview) needs only the most compact house.
    const footprints = zoneFootprints(programFromBrief(intent.brief, relax), opts).slice(0, intent.count <= 1 ? 1 : undefined);
    for (const [fi, fp] of footprints.entries()) {
      const prefix = `${request.idPrefix}-a${fi + 1}`;
      let shell = createPlanDocument({ id: `${prefix}-plan`, name: request.source.name, width: fp.width, depth: fp.depth, externalThickness, wallHeight, idPrefix: `${prefix}-s` });
      // Houses sized from the rooms have the street to the south, so the garden to the north.
      const shellEnv = analyzeEnvelope(shell.levels[0]);
      if (shellEnv.ok) {
        const rear = applyCommand(shell, { type: "setRearWall", wallId: shellEnv.info.sides.north });
        if (rear.ok) shell = rear.document;
      }
      const key = `${fp.width}x${fp.depth}`;
      const { candidates } = zoneCandidates(shell, request, prefix, (id) => excluded.has(`${id}@${key}`));
      // Two per house at most, of different families, so the sizes vary too.
      const families = new Set<string>();
      for (const c of candidates) {
        if (families.size >= 2 || families.has(zoneFamily(c.arrangement!))) continue;
        families.add(zoneFamily(c.arrangement!));
        out.push({ ...c, summary: `${SHAPE_WORD[fp.shape]} ${fp.width} × ${fp.depth} m house. ${ZONE_SUMMARY}`, variant: `${c.arrangement}@${key}`, footprint: fp });
      }
    }
  }
  return out.sort((a, b) => bySense(a.sense, b.sense));
}

/**
 * Up to `count` candidates, best first, preferring a spread: a different
 * house size each until every size has had a turn, then a different layout
 * family, then the rest. Variety never brings in a plan with more things
 * wrong than the best one.
 */
export function pickVaried<T extends PlanCandidate & { sense?: PlanSense }>(candidates: T[], count: number): T[] {
  const ranked = candidates.map((c, i) => ({ c, i })).sort((a, b) => (a.c.sense && b.c.sense ? bySense(a.c.sense, b.c.sense) : 0) || a.i - b.i).map((x) => x.c);
  const wrong = (c: T) => c.sense?.findings.length ?? 0;
  const fewest = Math.min(...ranked.map(wrong));
  const sizeOf = (c: T) => (c.footprint ? `${c.footprint.width}x${c.footprint.depth}` : "");
  const familyOf = (c: T) => (isZoneLayout(c.arrangement) ? zoneFamily(c.arrangement!) : (c.arrangement ?? "")) + sizeOf(c);
  const picked: T[] = [];
  for (const keyOf of [sizeOf, familyOf]) {
    const seen = new Set(picked.map(keyOf));
    for (const c of ranked) {
      if (picked.length >= count || picked.includes(c) || seen.has(keyOf(c)) || wrong(c) > fewest) continue;
      seen.add(keyOf(c));
      picked.push(c);
    }
  }
  for (const c of ranked) if (picked.length < count && !picked.includes(c)) picked.push(c);
  return picked;
}

/** Furnishes the zone layouts among picked candidates; the others already are. */
export function furnishZones(candidates: PlanCandidate[]): PlanCandidate[] {
  return candidates.map((c) => (isZoneLayout(c.arrangement) ? { ...c, document: furnishPlan(c.document, c.document.id.replace(/-plan$/, "")) } : c));
}
