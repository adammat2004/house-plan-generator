import { applyCommand } from "../commands/apply";
import { createPlanDocument } from "../commands/factory";
import { furnishPlan } from "../furniture/furnish";
import { analyzeEnvelope } from "../geometry/envelope";
import { DEFAULT_HOUSE, DOOR_PRESET } from "../plan/defaults";
import type { PlanDocument } from "../plan/types";
import { emitLayout } from "./layoutEmitter";
import { layoutPlacement } from "./placement";
import type { PlanCandidate, PlanningRequest } from "./planner";
import { programFromBrief, type Relaxation } from "./program";
import { repeats } from "./select/pick";
import { assessSense, bySense, type PlanSense } from "./sense";
import { planZoneColumns, planZones, zoneFootprints } from "./zonePlanner";
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

export const DIRECT_TITLE = "Front door into the living space";
export const DIRECT_SUMMARY = "The front door opens into the living spaces; the bedrooms are off a short inner hall beyond them, with no entrance hall.";

export const SPLIT_TITLE = "Bedroom wings either side of the living spaces";
export const SPLIT_SUMMARY = "The living spaces run down the middle; the master suite has a wing of its own, the other bedrooms are off a hall on the far side.";

/** A zone layout whose front door opens into the living spaces (its night zone tagged "e", or a split-bedroom layout entered from the middle). */
export const isDirectZone = (arrangement: string | undefined) => !!arrangement && (/^zones-[lr]\.(L\.)?e[qbm][sd]/.test(arrangement) || arrangement.startsWith("zones-c.e"));

/** A split-bedroom layout: a bedroom wing either side of the living spaces. */
export const isSplitZone = (arrangement: string | undefined) => !!arrangement?.startsWith("zones-c.");

/** Zone plans built per house, best by their layout score: building is the slow part. */
const buildsPerHouse = (count: number) => (count <= 1 ? 3 : 4);

export type JudgedCandidate = PlanCandidate & { sense: PlanSense };

export const isZoneLayout = (arrangement: string | undefined) => !!arrangement?.startsWith("zones-");

/** The layout family, for variety: the same night zone mirrored counts as one; a split-bedroom layout by its way in and its split. */
export const zoneFamily = (arrangement: string) =>
  isSplitZone(arrangement) ? arrangement.replace(/^zones-c\.([lre])(\d).*$/, (_, mode: string, split: string) => `zones-c.${mode === "e" ? "e" : "h"}${split}`) : arrangement.replace(/^zones-[lr]\./, "zones.").replace(/o\d+/, "");

/** What a zone layout is called on its card, and what it says. */
export const zoneSummary = (arrangement: string) => (isSplitZone(arrangement) ? SPLIT_SUMMARY : isDirectZone(arrangement) ? DIRECT_SUMMARY : ZONE_SUMMARY);

/** The best zone layouts in a rectangular shell, best first. */
export function zoneCandidates(shell: PlanDocument, request: PlanningRequest, prefix: string, excluded: (id: string) => boolean): { candidates: JudgedCandidate[]; problem: string | null } {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const level = shell.levels[0];
  const env = analyzeEnvelope(level);
  if (!env.ok) return { candidates: [], problem: null };
  const prefs = new Set(intent.brief.preferences);
  const hallWidth = hallWidthFor(prefs);
  const doorWidth = prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width;
  const rearSide = (level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const candidates: JudgedCandidate[] = [];
  let problem: string | null = null;
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (candidates.length) break;
    const program = programFromBrief(intent.brief, relax);
    // A rectangle, or two columns side by side (an L with its legs running back from the street).
    const zoneOpts = { hallWidth, doorWidth, rearSide, kitchenGarden: prefs.has("kitchen_faces_garden"), primaryPrivate: prefs.has("primary_bedroom_private"), utilityNearKitchen: prefs.has("utility_near_kitchen") };
    const zones = env.info.isRectangle ? planZones(env.info.axisRect, program, zoneOpts) : planZoneColumns(env.info.axisRing, program, zoneOpts);
    problem = zones.problem ?? problem;
    // A plan the same as one already built (mirrored, bedrooms swapped) doesn't count: the next is built instead, up to twice as many.
    const builds = buildsPerHouse(intent.count);
    // "Show similar" for a zone layout: its own family first.
    const base = intent.similarTo?.split("@")[0];
    const family = base && isZoneLayout(base) ? zoneFamily(base) : null;
    const byFamily = family ? [...zones.plans.filter((p) => zoneFamily(p.id) === family), ...zones.plans.filter((p) => zoneFamily(p.id) !== family)] : zones.plans;
    // Rooms placed on the house: the plans that put them there are built first (judged on their rectangles, before building).
    const placements = intent.brief.placements;
    const fits = placements && intent.brief.rooms ? new Map(byFamily.map((p) => [p, layoutPlacement(p.rooms, env.info.outsideRect, rearSide, placements, intent.brief.rooms!)])) : null;
    const ordered = fits ? [...byFamily].sort((a, b) => Number(fits.get(b)!.honoured) - Number(fits.get(a)!.honoured) || fits.get(a)!.cost - fits.get(b)!.cost) : byFamily;
    const queue = ordered.filter((p) => !excluded(p.id)).slice(0, intent.count > 1 ? builds * 2 : builds);
    for (const [i, plan] of queue.entries()) {
      if (candidates.length >= builds) break;
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
      if (intent.count > 1 && repeats(built.document, candidates.map((c) => c.document))) continue;
      candidates.push({ document: built.document, summary: zoneSummary(plan.id), notes, seed: i, arrangement: plan.id, sense: assessSense(built.document.levels[0]) });
    }
  }
  candidates.sort((a, b) => bySense(a.sense, b.sense));
  return { candidates, problem };
}

const SHAPE_WORD = { compact: "A compact", wide: "A wide", deep: "A deep" } as const;

/**
 * Zone layouts in houses sized for them from the rooms, the best of each
 * size, best first: rectangles, Ls where the zones need different depths, or
 * both.
 */
export function autoZoneCandidates(request: PlanningRequest, excluded: ReadonlySet<string>, shapes: "rectangle" | "L" | "both" | "U" | "T" = "rectangle"): JudgedCandidate[] {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const sourceLevel = request.source.levels[0];
  const env = sourceLevel ? analyzeEnvelope(sourceLevel) : null;
  const externalThickness = env?.ok ? env.info.externalThickness : DEFAULT_HOUSE.externalThickness;
  const wallHeight = sourceLevel?.defaultWallHeight ?? DEFAULT_HOUSE.wallHeight;
  const prefs = new Set(intent.brief.preferences);
  const opts = { hallWidth: hallWidthFor(prefs), doorWidth: prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width, externalThickness, plot: intent.plot, shapes };
  const out: JudgedCandidate[] = [];
  for (const relax of [0, 1, 2] as Relaxation[]) {
    if (out.length) break;
    // A single layout (the live preview) needs only the most compact house; of the Us and Ts offered (some won't fit their rooms after all), the first three that work.
    const all = zoneFootprints(programFromBrief(intent.brief, relax), opts);
    const split = shapes === "U" || shapes === "T";
    const footprints = split ? all : all.slice(0, intent.count <= 1 ? 1 : undefined);
    const houses = intent.count <= 1 ? 1 : 3;
    let built = 0;
    for (const [fi, fp] of footprints.entries()) {
      if (split && built >= houses) break;
      const prefix = `${request.idPrefix}-a${fi + 1}`;
      const size = fp.outline ? { outline: fp.outline } : { width: fp.width, depth: fp.depth };
      let shell = createPlanDocument({ id: `${prefix}-plan`, name: request.source.name, ...size, externalThickness, wallHeight, idPrefix: `${prefix}-s` });
      // Houses sized from the rooms have the street to the south, so the garden to the north.
      const shellEnv = analyzeEnvelope(shell.levels[0]);
      if (shellEnv.ok) {
        const rear = applyCommand(shell, { type: "setRearWall", wallId: shellEnv.info.sides.north });
        if (rear.ok) shell = rear.document;
      }
      const key = fp.key;
      const { candidates } = zoneCandidates(shell, request, prefix, (id) => excluded.has(`${id}@${key}`));
      if (candidates.length) built++;
      // Two per house at most, of different families, so the sizes vary too.
      const families = new Set<string>();
      for (const c of candidates) {
        if (families.size >= 2 || families.has(zoneFamily(c.arrangement!))) continue;
        families.add(zoneFamily(c.arrangement!));
        const what = fp.kind ? `${fp.kind === "L" ? "An" : "A"} ${fp.kind}-shaped ${fp.width} × ${fp.depth} m house` : `${SHAPE_WORD[fp.shape]} ${fp.width} × ${fp.depth} m house`;
        out.push({ ...c, summary: `${what}. ${c.summary}`, variant: `${c.arrangement}@${key}`, footprint: { width: fp.width, depth: fp.depth, shape: fp.shape } });
      }
    }
  }
  return out.sort((a, b) => bySense(a.sense, b.sense));
}

/** Furnishes the zone layouts among picked candidates that aren't yet; the others already are. */
export function furnishZones(candidates: PlanCandidate[]): PlanCandidate[] {
  const bare = (c: PlanCandidate) => isZoneLayout(c.arrangement) && !Object.keys(c.document.levels[0].furniture).length;
  return candidates.map((c) => (bare(c) ? { ...c, document: furnishPlan(c.document, c.document.id.replace(/-plan$/, "")) } : c));
}
