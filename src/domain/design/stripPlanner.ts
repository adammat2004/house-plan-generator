import { applyCommand } from "../commands/apply";
import type { PlanCommand } from "../commands/types";
import { createPlanDocument } from "../commands/factory";
import { validateDocument } from "../commands/validate";
import { furnishPlan } from "../furniture/furnish";
import { deriveLevelGeometry, roomFaceIndices } from "../geometry/derive";
import { analyzeEnvelope, type EnvelopeSide } from "../geometry/envelope";
import { describeOutline } from "../geometry/outlineDescription";
import { findFaceIndexContaining } from "../geometry/faces";
import { roundToPrecision } from "../geometry/numeric";
import { dot, sub } from "../geometry/vector";
import { axialParam, distanceToAxis } from "../geometry/walls";
import { DEFAULT_HOUSE, DOOR_PRESET } from "../plan/defaults";
import type { Id, Opening, PlanDocument, Point2, RoomType } from "../plan/types";
import type { LayoutPlanner, PlanCandidate, PlanningRequest, PlanningResult } from "./planner";
import { floorFor, programFromBrief, type Program, type Relaxation, type SpaceSpec, type WindowSize } from "./program";
import { ENSUITE_TARGET } from "./roomRules";
import { planRoomChange } from "./roomPlanner";
import { footprintsFor, minimumFootprint, type Footprint, type FootprintShape } from "./footprint";
import { assessSense } from "./sense";
import { isStoreyLayout, planStoreyLayouts, STOREY_TITLE } from "./storeyLayouts";
import { planAutoShapes, planWingLayouts, shellFrom, WING_TITLE, wingArrangementOf } from "./wingPlanner";
import { autoZoneCandidates, furnishZones, isZoneLayout, pickVaried, ZONE_TITLE, zoneCandidates, zoneFamily } from "./zoneLayouts";
import { ARRANGEMENTS, hallWidthFor, minBandDepth, zoneProgram, type Arrangement } from "./zoning";

/**
 * A deterministic "strip" planner. The house interior is split into two
 * bands of rooms either side of a hall, across the depth or the width of
 * the house. Rooms sit side by side along their band, sized in proportion
 * to their target areas and never below their minimum widths. Every wall,
 * room and opening is created with applyCommand, so a candidate is exactly
 * as valid and editable as a hand-drawn plan.
 *
 * Local frame: u runs across the house, v from the front (street) to the
 * rear (garden) wall, both on the external wall centrelines. Within a band,
 * "along" runs the length of the band and "cross" towards the hall.
 */

/** Card titles for each arrangement, keyed by id. */
export const ARRANGEMENT_TITLE: Record<string, string> = Object.fromEntries(ARRANGEMENTS.map((a) => [a.id, a.title]));

/** The card title for a layout's arrangement id, from any planner. */
export function arrangementTitle(id: string): string | null {
  if (isZoneLayout(id)) return ZONE_TITLE;
  if (isStoreyLayout(id)) return STOREY_TITLE;
  const wing = wingArrangementOf(id);
  return ARRANGEMENT_TITLE[id] ?? (wing ? WING_TITLE[wing] : null);
}

/**
 * Zone and strip candidates together: with `similarTo`, the ones like it
 * first, in the order they were planned; then the plans that make the most
 * sense, spread across layout families. Seeds number the result.
 */
function merge(candidates: PlanCandidate[], count: number, similarTo?: string): PlanCandidate[] {
  const base = similarTo?.split("@")[0];
  const like = (c: PlanCandidate) => (isZoneLayout(base) ? isZoneLayout(c.arrangement) && zoneFamily(c.arrangement!) === zoneFamily(base!) : !isZoneLayout(c.arrangement));
  const first = base ? candidates.filter(like).slice(0, count) : [];
  const judged = candidates.filter((c) => !first.includes(c)).map((c) => ({ ...c, sense: assessSense(c.document.levels[0]) }));
  const rest = pickVaried(judged, count - first.length).map((c): PlanCandidate => {
    const copy: PlanCandidate & { sense?: unknown } = { ...c };
    delete copy.sense;
    return copy;
  });
  return furnishZones([...first, ...rest]).map((c, seed) => ({ ...c, seed }));
}

/**
 * Arrangements to try for "generate similar": the same split first (mirrored,
 * then the bands swapped), then the rest.
 */
function similarOrder(baseId: string, all: readonly Arrangement[]): Arrangement[] {
  const base = all.find((a) => a.id === baseId);
  if (!base) return [...all];
  const rank = (a: Arrangement) => (a.split !== base.split ? 3 : a.dayFirst === base.dayFirst ? 1 : 2);
  return all.filter((a) => a.id !== base.id).sort((a, b) => rank(a) - rank(b));
}

const GRID = 0.05;
const snap = (v: number) => roundToPrecision(Math.round(v / GRID) * GRID);

/** A sensible starting finish for each kind of room; the user can change any of them. */

const WINDOW_WIDTH: Record<WindowSize, number> = { large: 2.4, standard: 1.4, small: 0.7, none: 0 };

export function createStripPlanner(): LayoutPlanner {
  return {
    id: "strip-planner-v1",
    plan: async (request) => planLayouts(request),
  };
}

/** Synchronous core of the strip planner (the async wrapper exists for future remote planners). */
export function planLayouts(request: PlanningRequest): PlanningResult {
  const { intent } = request;
  if (intent.action !== "generate_layouts") return planRoomChange(request);
  // Two storeys have their own planner; a brief without storeys plans exactly as before.
  if (intent.brief.storeys === 2) return planStoreyLayouts(request);
  const result = planWholeLayouts(request);
  // A shape in the brief only shapes houses sized from the rooms; say so when the drawn house differs.
  const wanted = intent.brief.houseShape;
  if (intent.footprint !== "auto" && (wanted === "L" || wanted === "T" || wanted === "U")) {
    const env = analyzeEnvelope(request.source.levels[0]);
    if (env.ok && describeOutline(env.info).shape !== wanted) {
      const note = `The brief asks for ${wanted === "L" ? "an" : "a"} ${wanted}-shaped house; these layouts keep the house you drew. Size the house from the rooms to let the planner shape it.`;
      return { ...result, candidates: result.candidates.map((c) => ({ ...c, notes: [...c.notes, note] })) };
    }
  }
  return result;
}

function planWholeLayouts(request: PlanningRequest): PlanningResult {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const prefs = new Set(intent.brief.preferences);
  const allowed = ARRANGEMENTS.filter((a) => !(prefs.has("kitchen_faces_garden") && a.split === "depth" && a.dayFirst));
  const excluded = new Set(intent.exclude ?? []);
  if (intent.footprint === "auto") return planAuto(request, allowed, excluded);
  // Houses that aren't rectangles: wing by wing, and in zones where the outline is two columns side by side.
  const sourceEnv = analyzeEnvelope(request.source.levels[0]);
  if (sourceEnv.ok && !sourceEnv.info.isRectangle) {
    const wings = planWingLayouts(request);
    const zoned = zoneCandidates(shellFrom(request.source, sourceEnv.info, `${request.idPrefix}-z`)!, request, `${request.idPrefix}-`, (id) => excluded.has(id)).candidates;
    const all = [...zoned, ...wings.candidates];
    return all.length ? { candidates: merge(all, intent.count, intent.similarTo), issues: [] } : wings;
  }
  const fresh = allowed.filter((a) => !excluded.has(a.id));
  const arrangements = intent.similarTo ? similarOrder(intent.similarTo, fresh) : fresh;
  const candidates: PlanCandidate[] = [];
  let lastProblem = "The footprint is too small for this brief.";
  // Zone layouts, in a fresh shell of the user's rectangle; the strip layouts below compete with them.
  const zoneShell = sourceEnv.ok ? shellFrom(request.source, sourceEnv.info, `${request.idPrefix}-z`) : null;
  const zones = zoneShell ? zoneCandidates(zoneShell, request, `${request.idPrefix}-`, (id) => excluded.has(id)).candidates : [];
  for (const arrangement of arrangements) {
    if (candidates.length >= intent.count) break;
    for (const relax of [0, 1, 2] as Relaxation[]) {
      const program = programFromBrief(intent.brief, relax);
      const built = buildLayout(request.source, program, arrangement, `${request.idPrefix}-${candidates.length + 1}`);
      if (built.ok) {
        const notes = [...program.notes, ...built.notes];
        if (intent.brief.additionalInstructions.trim() && !request.instructionsRead) {
          notes.push("Additional instructions are saved with the brief, but no AI read them, and this planner doesn't read free text.");
        }
        // Furnished, so concepts read as homes; furniture never affects validity.
        const document = furnishPlan(built.document, `${request.idPrefix}-${candidates.length + 1}`);
        candidates.push({ document, summary: arrangement.summary, notes, seed: ARRANGEMENTS.indexOf(arrangement), arrangement: arrangement.id });
        break;
      }
      lastProblem = built.reason;
    }
  }
  const exhausted = excluded.size > 0 && !arrangements.length && !zones.length;
  if (candidates.length || zones.length) return { candidates: merge([...zones, ...candidates], intent.count, intent.similarTo), issues: [] };
  if (exhausted) return { candidates, issues: [{ code: "does-not-fit", message: "There are no more distinct layouts for this brief. Change the brief to explore other options." }] };
  return { candidates, issues: [{ code: "does-not-fit", message: tooSmallMessage(request, allowed) ?? `No layout fits: ${lastProblem}`, tooSmall: true }] };
}

/** Says how big a house the brief needs when the user's own house is too small for it. */
function tooSmallMessage(request: PlanningRequest, allowed: readonly Arrangement[]): string | null {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const env = analyzeEnvelope(request.source.levels[0]);
  if (!env.ok) return null;
  const minimum = minimumFootprint(programFromBrief(intent.brief, 2), allowed, {
    externalThickness: env.info.externalThickness,
    hallWidth: hallWidthFor(new Set(intent.brief.preferences)),
  });
  if (!minimum) return null;
  const size = (w: number, d: number) => `${Number(w.toFixed(2))} × ${Number(d.toFixed(2))} m`;
  return `These rooms don't fit your ${size(env.info.width, env.info.depth)} house: they need about ${size(minimum.width, minimum.depth)}. Size the house from the rooms, make the house bigger in Structure, or ask for fewer rooms.`;
}

const SHAPE_WORD: Record<FootprintShape, string> = { compact: "A compact", wide: "A wide", deep: "A deep" };
/** Most shells built per request in auto mode, so a hard brief can't stall the editor. */
const MAX_ATTEMPTS = 40;

interface AutoOption {
  arrangement: Arrangement;
  footprint: Footprint;
  variant: string;
}

/**
 * Layouts whose house size comes from the rooms. Rectangles unless the brief
 * asks for another shape; "any" alternates rectangles with L, U and T houses.
 */
function planAuto(request: PlanningRequest, allowed: readonly Arrangement[], excluded: ReadonlySet<string>): PlanningResult {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const shape = intent.brief.houseShape;
  if (!shape || shape === "rectangle") return planAutoRectangles(request, allowed, excluded);
  if (shape === "T" || shape === "U") return planAutoShapes(request, [shape], excluded);
  // L, or any shape: zone layouts in L houses compete with the wing planner's, and with rectangles when the shape is open.
  const ls = autoZoneCandidates(request, excluded, "L");
  const shaped = planAutoShapes(request, shape === "L" ? ["L"] : ["L", "U", "T"], excluded);
  const boxes = shape === "any" ? planAutoRectangles(request, allowed, excluded) : { candidates: [], issues: [] };
  const all = [...ls, ...boxes.candidates, ...shaped.candidates];
  if (all.length) return { candidates: merge(all, intent.count, intent.similarTo), issues: [] };
  return { candidates: [], issues: boxes.issues.length ? boxes.issues : shaped.issues };
}

/**
 * Rectangular houses sized from the rooms: each arrangement in a few
 * footprints chosen for its program, built on a fresh shell like a template.
 * The first round gives every arrangement a different shape, so the first
 * few concepts differ in both plan and size.
 */
function planAutoRectangles(request: PlanningRequest, allowed: readonly Arrangement[], excluded: ReadonlySet<string>): PlanningResult {
  const intent = request.intent as Extract<PlanningRequest["intent"], { action: "generate_layouts" }>;
  const sourceLevel = request.source.levels[0];
  const env = sourceLevel ? analyzeEnvelope(sourceLevel) : null;
  const externalThickness = env?.ok ? env.info.externalThickness : DEFAULT_HOUSE.externalThickness;
  const wallHeight = sourceLevel?.defaultWallHeight ?? DEFAULT_HOUSE.wallHeight;
  const prefs = new Set(intent.brief.preferences);
  const opts = { externalThickness, hallWidth: hallWidthFor(prefs), plot: intent.plot };

  // Footprints per arrangement for the program as asked; relaxed programs only where it doesn't fit.
  const sized = allowed.map((arrangement) => {
    for (const relax of [0, 1, 2] as Relaxation[]) {
      const footprints = footprintsFor(programFromBrief(intent.brief, relax), arrangement, opts);
      if (footprints.length) return { arrangement, footprints };
    }
    return { arrangement, footprints: [] as Footprint[] };
  });
  const queue: AutoOption[] = [];
  const seen = new Set<string>();
  const rounds = Math.max(0, ...sized.map((s) => s.footprints.length));
  // Arrangements with the same split share their sizes, so each takes the next size in turn.
  const turn = sized.map(({ arrangement }, i) => sized.slice(0, i).filter((o) => o.arrangement.split === arrangement.split).length);
  for (let round = 0; round < rounds; round++) {
    sized.forEach(({ arrangement, footprints }, i) => {
      if (!footprints.length) return;
      const footprint = footprints[(turn[i] + round) % footprints.length];
      const variant = `${arrangement.id}@${footprint.width}x${footprint.depth}`;
      if (seen.has(variant) || excluded.has(variant)) return;
      seen.add(variant);
      queue.push({ arrangement, footprint, variant });
    });
  }
  if (intent.similarTo) {
    // Same size first, in the arrangements most like the original, then the rest.
    const [baseId, size] = intent.similarTo.split("@");
    const order = similarOrder(baseId, [...allowed]).map((a) => a.id);
    const rank = (o: AutoOption) => (`${o.footprint.width}x${o.footprint.depth}` === size ? 0 : 100) + (order.indexOf(o.arrangement.id) + 1 || 50);
    queue.sort((a, b) => rank(a) - rank(b));
  }

  const candidates: PlanCandidate[] = [];
  let lastProblem = "these rooms don't fit any house the planner can draw.";
  let attempts = 0;
  for (const option of queue) {
    if (candidates.length >= intent.count || attempts >= MAX_ATTEMPTS) break;
    const prefix = `${request.idPrefix}-${candidates.length + 1}`;
    for (const relax of [0, 1, 2] as Relaxation[]) {
      attempts++;
      const shell = createPlanDocument({
        id: `${prefix}-plan`,
        name: request.source.name,
        width: option.footprint.width,
        depth: option.footprint.depth,
        externalThickness,
        wallHeight,
        idPrefix: `${prefix}-s`,
      });
      const program = programFromBrief(intent.brief, relax);
      const built = buildLayout(shell, program, option.arrangement, prefix);
      if (!built.ok) {
        lastProblem = built.reason;
        continue;
      }
      const { width, depth, shape } = option.footprint;
      const notes = [...program.notes, ...built.notes];
      if (intent.brief.additionalInstructions.trim() && !request.instructionsRead) {
        notes.push("Additional instructions are saved with the brief, but no AI read them, and this planner doesn't read free text.");
      }
      candidates.push({
        document: furnishPlan(built.document, prefix),
        summary: `${SHAPE_WORD[shape]} ${width} × ${depth} m house. ${option.arrangement.summary}`,
        notes,
        seed: ARRANGEMENTS.indexOf(option.arrangement),
        arrangement: option.arrangement.id,
        variant: option.variant,
        footprint: option.footprint,
      });
      break;
    }
  }
  const zones = autoZoneCandidates(request, excluded);
  if (candidates.length || zones.length) return { candidates: merge([...zones, ...candidates], intent.count, intent.similarTo), issues: [] };
  if (excluded.size && !queue.length) {
    return { candidates, issues: [{ code: "does-not-fit", message: "There are no more distinct layouts for these rooms. Change the rooms to explore other options." }] };
  }
  const minimum = minimumFootprint(programFromBrief(intent.brief, 2), allowed, opts);
  const plot = intent.plot;
  const message =
    minimum && (plot?.maxWidth || plot?.maxDepth)
      ? `These rooms need a house of at least about ${minimum.width} × ${minimum.depth} m, and the plot allows ${plot.maxWidth ?? "any"} × ${plot.maxDepth ?? "any"} m. Raise the plot size or choose fewer rooms.`
      : `No layout fits: ${lastProblem}`;
  return { candidates, issues: [{ code: "does-not-fit", message }] };
}

type BuildResult = { ok: true; document: PlanDocument; notes: string[] } | { ok: false; reason: string };

interface Band {
  spaces: SpaceSpec[];
  /** Cross coordinates of the band's external edge and its hall edge. */
  ext: number;
  hall: number;
  /** Slot boundaries along the band, from 0 to the band length. */
  cuts: number[];
}

function buildLayout(source: PlanDocument, program: Program, arrangement: Arrangement, prefix: string): BuildResult {
  const prefs = program.preferences;
  const sourceLevel = source.levels[0];
  const env0 = analyzeEnvelope(sourceLevel);
  if (!env0.ok) return { ok: false, reason: "the source plan's envelope is invalid." };
  if (program.spaces.length < 2) return { ok: false, reason: "the brief needs at least two spaces." };
  const rearSide: EnvelopeSide = (sourceLevel.rearWallId && env0.info.sideOfWall[sourceLevel.rearWallId]) || "north";
  const hallWidth = hallWidthFor(prefs);
  const doorWidth = prefs.has("accessible_layout") ? 1 : DOOR_PRESET.width;
  const notes: string[] = [];

  let doc: PlanDocument = { ...source, id: `${prefix}-plan` };
  const run = (command: PlanCommand): string | null => {
    const result = applyCommand(doc, command);
    if (!result.ok) return result.issues[0]?.message ?? "invalid edit";
    doc = result.document;
    return null;
  };
  const failure =
    run({
      type: "createFootprint",
      width: env0.info.width,
      depth: env0.info.depth,
      externalThickness: env0.info.externalThickness,
      wallHeight: sourceLevel.defaultWallHeight,
      idPrefix: `${prefix}-f`,
    }) ?? run({ type: "setRearWall", wallId: envSides(doc)[rearSide] });
  if (failure) return { ok: false, reason: failure };

  // Local frame → world.
  const r = (analyzeEnvelope(doc.levels[0]) as Extract<ReturnType<typeof analyzeEnvelope>, { ok: true }>).info.axisRect;
  const across = rearSide === "north" || rearSide === "south";
  const U = across ? r.maxX - r.minX : r.maxY - r.minY;
  const V = across ? r.maxY - r.minY : r.maxX - r.minX;
  const uv = (u: number, v: number): Point2 => {
    const p =
      rearSide === "north" ? { x: r.minX + u, y: r.minY + v }
      : rearSide === "south" ? { x: r.maxX - u, y: r.maxY - v }
      : rearSide === "east" ? { x: r.minX + v, y: r.maxY - u }
      : { x: r.maxX - v, y: r.minY + u };
    return { x: roundToPrecision(p.x), y: roundToPrecision(p.y) };
  };
  const depthSplit = arrangement.split === "depth";
  const L = depthSplit ? U : V;
  const T = depthSplit ? V : U;
  /** Band coordinates (along, cross) → world. */
  const at = (a: number, c: number) => (depthSplit ? uv(a, c) : uv(c, a));

  // Zone the program into two bands; spill bedrooms into the day band if the night band overflows.
  const zoning = zoneProgram(program, arrangement, L);
  if (!zoning) return { ok: false, reason: `${depthSplit ? "the house is too narrow" : "the house is too shallow"} for every room at its minimum width.` };
  notes.push(...zoning.notes);

  // Band depths in proportion to how much area each band needs, with a usable minimum.
  const rest = roundToPrecision(T - hallWidth);
  const { first: firstSpaces, second: secondSpaces } = zoning;
  const minDepth = minBandDepth;
  if (rest < minDepth(firstSpaces) + minDepth(secondSpaces)) return { ok: false, reason: "the house is too small for two rows of rooms and a hall." };
  const need = (spaces: SpaceSpec[]) => spaces.reduce((sum, s) => sum + s.target, 0) / L;
  const share = rest * (need(firstSpaces) / (need(firstSpaces) + need(secondSpaces)));
  const firstDepth = snap(Math.min(Math.max(share, minDepth(firstSpaces)), rest - minDepth(secondSpaces)));
  const bands: Band[] = [
    { spaces: firstSpaces, ext: 0, hall: firstDepth, cuts: [] },
    { spaces: secondSpaces, ext: T, hall: snap(firstDepth + hallWidth), cuts: [] },
  ];
  for (const band of bands) {
    const cuts = distribute(L, band.spaces);
    if (!cuts) return { ok: false, reason: "rooms don't fit along the band." };
    band.cuts = cuts;
  }

  // Walls: the two hall walls, then slot separators, then ensuites.
  let wallCount = 0;
  const addWall = (a0: number, c0: number, a1: number, c1: number): Id | string => {
    const wallId = `${prefix}-w${++wallCount}`;
    const problem = run({ type: "addWall", wallId, start: at(a0, c0), end: at(a1, c1), thickness: DEFAULT_HOUSE.internalThickness, idPrefix: wallId });
    return problem ? `!${problem}` : wallId;
  };
  const hallWalls: Id[] = [];
  for (const band of bands) {
    const id = addWall(0, band.hall, L, band.hall);
    if (id.startsWith("!")) return { ok: false, reason: id.slice(1) };
    hallWalls.push(id);
  }
  const separators: Id[][] = [];
  for (const band of bands) {
    const ids: Id[] = [];
    for (const cut of band.cuts.slice(1, -1)) {
      const id = addWall(cut, band.ext, cut, band.hall);
      if (id.startsWith("!")) return { ok: false, reason: id.slice(1) };
      ids.push(id);
    }
    separators.push(ids);
  }

  interface Placed {
    spec: SpaceSpec;
    band: Band;
    bandIndex: number;
    slot: number;
    a0: number;
    a1: number;
    /** Where the hall door goes along the band (excludes an ensuite). */
    doorA0: number;
    doorA1: number;
    ensuite?: { wallId: Id; a0: number; depth: number };
  }
  const placed: Placed[] = [];
  for (const [bandIndex, band] of bands.entries()) {
    const dir = Math.sign(band.ext - band.hall);
    const depth = Math.abs(band.ext - band.hall);
    band.spaces.forEach((spec, slot) => {
      const [a0, a1] = [band.cuts[slot], band.cuts[slot + 1]];
      const item: Placed = { spec, band, bandIndex, slot, a0, a1, doorA0: a0, doorA1: a1 };
      const ensW = snap(Math.min(1.6, a1 - a0 - 1.9));
      const ensD = snap(Math.min(2, depth - 1.6));
      if (spec.ensuite && ensW >= 1.3 && ensD >= 1.5) {
        // Carve the ensuite from the hall-side corner of the bedroom's slot.
        const side = addWall(a1 - ensW, band.hall, a1 - ensW, band.hall + dir * ensD);
        const back = addWall(a1 - ensW, band.hall + dir * ensD, a1, band.hall + dir * ensD);
        if (!side.startsWith("!") && !back.startsWith("!")) {
          item.ensuite = { wallId: side, a0: a1 - ensW, depth: ensD };
          item.doorA1 = a1 - ensW;
        }
      } else if (spec.ensuite) notes.push("The primary bedroom was too small to hold an ensuite.");
      placed.push(item);
    });
  }

  // Name and type every region.
  const rooms: Array<{ point: Point2; name: string; type: RoomType; target?: number }> = [];
  for (const item of placed) {
    const { band } = item;
    const dir = Math.sign(band.ext - band.hall);
    const depth = Math.abs(band.ext - band.hall);
    const mid = (item.a0 + item.a1) / 2;
    if (item.ensuite) {
      const e = item.ensuite;
      rooms.push({ point: at(mid, band.hall + dir * (e.depth + (depth - e.depth) / 2)), name: item.spec.name, type: item.spec.type, target: item.spec.target });
      rooms.push({ point: at((e.a0 + item.a1) / 2, band.hall + (dir * e.depth) / 2), name: "Ensuite", type: "ensuite", target: ENSUITE_TARGET });
    } else rooms.push({ point: at(mid, band.hall + (dir * depth) / 2), name: item.spec.name, type: item.spec.type, target: item.spec.target });
  }
  const hallMid = (bands[0].hall + bands[1].hall) / 2;
  rooms.push({ point: at(L / 2, hallMid), name: "Hall", type: "hall" });
  for (const room of rooms) {
    const level = doc.levels[0];
    const face = findFaceIndexContaining(deriveLevelGeometry(level).faces, room.point);
    const roomId = [...roomFaceIndices(level)].find(([, f]) => f === face)?.[0];
    if (!roomId) return { ok: false, reason: `couldn't find the region for ${room.name}.` };
    const problem = run({ type: "updateRoom", roomId, changes: { name: room.name, type: room.type, targetArea: room.target ?? null, floorMaterial: floorFor(room.type) } });
    if (problem) return { ok: false, reason: problem };
  }

  // Openings. A door or window that doesn't fit is skipped rather than failing the layout.
  let openingCount = 0;
  let skipped = 0;
  const hostAt = (p: Point2): Id | null => {
    const geometry = deriveLevelGeometry(doc.levels[0]);
    for (const id of doc.levels[0].envelope.wallIds) {
      const axis = geometry.axes.get(id);
      if (axis && distanceToAxis(axis, p) < 1e-6) return id;
    }
    return null;
  };
  const place = (kind: "door" | "window", wallId: Id | null, centre: Point2, width: number, size: WindowSize, inside?: Point2) => {
    if (!wallId || width < 0.5) return;
    const axis = deriveLevelGeometry(doc.levels[0]).axes.get(wallId);
    if (!axis) return;
    const offset = roundToPrecision(axialParam(axis, centre) - width / 2);
    const id = `${prefix}-o${++openingCount}`;
    const swingSide = inside && dot(sub(inside, axis.start), axis.normal) < 0 ? "right" : "left";
    const opening: Opening =
      kind === "door"
        ? { id, wallId, kind, offset, width: roundToPrecision(width), height: DOOR_PRESET.height, hinge: "start", swingSide }
        : size === "small"
          ? { id, wallId, kind, offset, width: roundToPrecision(width), height: 0.6, sillHeight: 1.4 }
          : { id, wallId, kind, offset, width: roundToPrecision(width), height: size === "large" ? 1.5 : 1.2, sillHeight: size === "large" ? 0.6 : 0.9 };
    if (run({ type: "addOpening", opening })) skipped++;
  };
  const light = prefs.has("maximize_natural_light") ? 1.3 : 1;
  for (const item of placed) {
    const { band, spec } = item;
    const dir = Math.sign(band.ext - band.hall);
    const depth = Math.abs(band.ext - band.hall);
    const inside = at((item.a0 + item.a1) / 2, band.ext - dir * Math.min(1, depth / 2));
    const narrowDoor = spec.type === "bathroom" || spec.type === "wc" ? Math.min(doorWidth, 0.8) : doorWidth;
    const doorMid = (item.doorA0 + item.doorA1) / 2;
    place("door", hallWalls[item.bandIndex], at(doorMid, band.hall), Math.min(narrowDoor, item.doorA1 - item.doorA0 - 0.3), "none", at(doorMid, band.hall + dir * 0.5));
    if (item.ensuite) {
      const e = item.ensuite;
      place("door", e.wallId, at(e.a0, band.hall + (dir * e.depth) / 2), Math.min(0.8, e.depth - 0.4), "none", at(e.a0 + 0.3, band.hall + (dir * e.depth) / 2));
    }
    if (spec.window !== "none") {
      const outer = at((item.a0 + item.a1) / 2, band.ext);
      place("window", hostAt(outer), outer, Math.min(WINDOW_WIDTH[spec.window] * light, item.a1 - item.a0 - 0.6), spec.window, inside);
      const ends = [item.slot === 0 ? 0 : null, item.slot === band.spaces.length - 1 ? L : null].filter((e): e is number => e !== null);
      if (spec.window === "large" || prefs.has("maximize_natural_light")) {
        for (const end of ends) {
          const p = at(end, band.ext - (dir * depth) / 2);
          place("window", hostAt(p), p, Math.min(WINDOW_WIDTH[spec.window] * light, depth - 0.8), spec.window, inside);
        }
      }
    }
  }
  // Entrance into the hall, and a garden door where the hall reaches the rear wall.
  const hallInside = at(L / 2, hallMid);
  const entrance = at(0, hallMid);
  place("door", hostAt(entrance), entrance, Math.min(1, hallWidth - 0.2), "none", hallInside);
  if (!depthSplit) {
    const garden = at(L, hallMid);
    place("door", hostAt(garden), garden, Math.min(0.9, hallWidth - 0.2), "none", hallInside);
  }
  if (skipped) notes.push(`${skipped} door${skipped > 1 ? "s or windows" : " or window"} didn't fit and ${skipped > 1 ? "were" : "was"} left out.`);

  const issues = validateDocument(doc);
  if (issues.length) return { ok: false, reason: issues[0].message };
  return { ok: true, document: doc, notes };
}

function envSides(doc: PlanDocument): Record<EnvelopeSide, Id> {
  const env = analyzeEnvelope(doc.levels[0]);
  if (!env.ok) throw new Error(env.message);
  return env.info.sides;
}

/**
 * Slot boundaries along a band: widths in proportion to target areas, never
 * below each room's minimum, snapped to the planning grid.
 */
function distribute(length: number, spaces: SpaceSpec[]): number[] | null {
  const mins = spaces.map((s) => s.minWidth);
  if (mins.reduce((a, b) => a + b, 0) > length + 1e-9) return null;
  const widths = spaces.map(() => 0);
  const fixed = new Set<number>();
  for (;;) {
    const free = spaces.map((_, i) => i).filter((i) => !fixed.has(i));
    const remaining = length - [...fixed].reduce((sum, i) => sum + mins[i], 0);
    const total = free.reduce((sum, i) => sum + spaces[i].target, 0);
    free.forEach((i) => (widths[i] = (remaining * spaces[i].target) / total));
    const short = free.filter((i) => widths[i] < mins[i] - 1e-9);
    if (!short.length) break;
    short.forEach((i) => {
      fixed.add(i);
      widths[i] = mins[i];
    });
  }
  const cuts = [0];
  let acc = 0;
  for (let i = 0; i < spaces.length - 1; i++) {
    acc += widths[i];
    // Snap, but never below a room's minimum or into the next room's.
    const lo = cuts[i] + mins[i];
    const hi = length - mins.slice(i + 1).reduce((a, b) => a + b, 0);
    cuts.push(Math.min(Math.max(snap(acc), Math.ceil((lo - 1e-9) / GRID) * GRID), Math.floor((hi + 1e-9) / GRID) * GRID));
    cuts[i + 1] = roundToPrecision(cuts[i + 1]);
    if (cuts[i + 1] - cuts[i] < mins[i] - 1e-6) return null;
  }
  cuts.push(roundToPrecision(length));
  if (length - cuts[cuts.length - 2] < mins[mins.length - 1] - 1e-6) return null;
  return cuts;
}
