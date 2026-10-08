import { applyCommand } from "../commands/apply";
import type { PlanCommand } from "../commands/types";
import { validateDocument } from "../commands/validate";
import { deriveLevelGeometry, roomFaceIndices } from "../geometry/derive";
import { analyzeEnvelope, type EnvelopeSide } from "../geometry/envelope";
import { findFaceIndexContaining } from "../geometry/faces";
import { roundToPrecision } from "../geometry/numeric";
import { dot, sub } from "../geometry/vector";
import { axialParam, distanceToAxis } from "../geometry/walls";
import { DEFAULT_HOUSE, DOOR_PRESET } from "../plan/defaults";
import type { Id, Opening, PlanDocument, Point2, RoomType } from "../plan/types";
import type { LayoutPlanner, PlanCandidate, PlanningRequest, PlanningResult } from "./planner";
import { programFromBrief, type Program, type Relaxation, type SpaceSpec, type WindowSize } from "./program";
import { planRoomChange } from "./roomPlanner";

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

interface Arrangement {
  id: string;
  /** "depth": bands stacked front and rear; "width": bands side by side, hall running front to back. */
  split: "depth" | "width";
  /** Whether the day (living) band comes first: at the front, or on the left. */
  dayFirst: boolean;
  /** Reverse the order of rooms along each band. */
  reverse: boolean;
  /** Short name for the idea, e.g. on a concept card. */
  title: string;
  summary: string;
}

/** In the order offered: the first few are the most distinct from each other. */
const ARRANGEMENTS: Arrangement[] = [
  { id: "garden-living", split: "depth", dayFirst: false, reverse: false, title: "Living along the garden", summary: "Living spaces along the garden side, bedrooms to the front." },
  { id: "two-wings", split: "width", dayFirst: true, reverse: false, title: "Living and sleeping wings", summary: "Living and sleeping wings either side of a hall running front to back." },
  { id: "quiet-garden", split: "depth", dayFirst: true, reverse: false, title: "Bedrooms on the quiet side", summary: "Bedrooms on the quiet garden side, living spaces to the front." },
  { id: "two-wings-mirrored", split: "width", dayFirst: false, reverse: false, title: "Sleeping wing first", summary: "Sleeping wing on the entrance side, living wing opposite, hall between." },
  { id: "garden-living-reversed", split: "depth", dayFirst: false, reverse: true, title: "Garden living, mirrored", summary: "Living spaces along the garden side, bedrooms to the front, mirrored." },
  { id: "two-wings-reversed", split: "width", dayFirst: true, reverse: true, title: "Wings, garden rooms swapped", summary: "Living and sleeping wings either side of the hall, with the rooms in each wing reversed." },
  { id: "quiet-garden-reversed", split: "depth", dayFirst: true, reverse: true, title: "Quiet side, mirrored", summary: "Bedrooms on the quiet garden side, living spaces to the front, mirrored." },
  { id: "two-wings-mirrored-reversed", split: "width", dayFirst: false, reverse: true, title: "Sleeping wing first, mirrored", summary: "Sleeping wing on the entrance side with its rooms reversed, living wing opposite." },
];

/** Card titles for each arrangement, keyed by id. */
export const ARRANGEMENT_TITLE: Record<string, string> = Object.fromEntries(ARRANGEMENTS.map((a) => [a.id, a.title]));

/**
 * Arrangements to try for "generate similar": the same split first (mirrored,
 * then the bands swapped), then the rest.
 */
function similarOrder(baseId: string, all: Arrangement[]): Arrangement[] {
  const base = all.find((a) => a.id === baseId);
  if (!base) return all;
  const rank = (a: Arrangement) => (a.split !== base.split ? 3 : a.dayFirst === base.dayFirst ? 1 : 2);
  return all.filter((a) => a.id !== base.id).sort((a, b) => rank(a) - rank(b));
}

const GRID = 0.05;
const MIN_BAND = 3;
const snap = (v: number) => roundToPrecision(Math.round(v / GRID) * GRID);

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
  const prefs = new Set(intent.brief.preferences);
  const allowed = ARRANGEMENTS.filter((a) => !(prefs.has("kitchen_faces_garden") && a.split === "depth" && a.dayFirst));
  const excluded = new Set(intent.exclude ?? []);
  const fresh = allowed.filter((a) => !excluded.has(a.id));
  const arrangements = intent.similarTo ? similarOrder(intent.similarTo, fresh) : fresh;
  const candidates: PlanCandidate[] = [];
  let lastProblem = "The footprint is too small for this brief.";
  for (const arrangement of arrangements) {
    if (candidates.length >= intent.count) break;
    for (const relax of [0, 1, 2] as Relaxation[]) {
      const program = programFromBrief(intent.brief, relax);
      const built = buildLayout(request.source, program, arrangement, `${request.idPrefix}-${candidates.length + 1}`);
      if (built.ok) {
        const notes = [...program.notes, ...built.notes];
        if (intent.brief.additionalInstructions.trim()) notes.push("Additional instructions are saved with the brief; this planner doesn't read free text yet.");
        candidates.push({ document: built.document, summary: arrangement.summary, notes, seed: ARRANGEMENTS.indexOf(arrangement), arrangement: arrangement.id });
        break;
      }
      lastProblem = built.reason;
    }
  }
  const exhausted = excluded.size > 0 && !arrangements.length;
  return {
    candidates,
    issues: candidates.length
      ? []
      : [exhausted ? { code: "does-not-fit", message: "There are no more distinct layouts for this brief. Change the brief to explore other options." } : { code: "does-not-fit", message: `No layout fits: ${lastProblem}` }],
  };
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
  const accessible = prefs.has("accessible_layout");
  const hallWidth = accessible ? 1.5 : 1.2;
  const doorWidth = accessible ? 1 : DOOR_PRESET.width;
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
      externalThickness: env0.info.thickness.south,
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
  let day = program.spaces.filter((s) => s.zone === "day");
  let night = program.spaces.filter((s) => s.zone === "night");
  if (!day.length || !night.length) {
    const all = [...day, ...night];
    const half = Math.ceil(all.length / 2);
    [day, night] = [all.slice(0, half), all.slice(half)];
  }
  day = orderDay(day, arrangement, prefs);
  night = orderNight(night, arrangement, prefs);
  const minSum = (spaces: SpaceSpec[]) => spaces.reduce((sum, s) => sum + s.minWidth, 0);
  while (minSum(night) > L + 1e-9) {
    const spill = [...night].reverse().find((s) => s.type === "bedroom");
    if (!spill) break;
    night = night.filter((s) => s !== spill);
    day = [...day, spill];
    notes.push(`${spill.name} sits with the living spaces to fit the footprint.`);
  }
  if (minSum(night) > L + 1e-9 || minSum(day) > L + 1e-9) {
    return { ok: false, reason: `${depthSplit ? "the house is too narrow" : "the house is too shallow"} for every room at its minimum width.` };
  }

  // Band depths in proportion to how much area each band needs, with a usable minimum.
  const rest = roundToPrecision(T - hallWidth);
  const firstSpaces = arrangement.dayFirst ? day : night;
  const secondSpaces = arrangement.dayFirst ? night : day;
  // A band holding an ensuite needs room for it and a strip of bedroom beyond.
  const minDepth = (spaces: SpaceSpec[]) => (spaces.some((s) => s.ensuite) ? MIN_BAND + 0.5 : MIN_BAND);
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
      rooms.push({ point: at((e.a0 + item.a1) / 2, band.hall + (dir * e.depth) / 2), name: "Ensuite", type: "ensuite", target: 3.5 });
    } else rooms.push({ point: at(mid, band.hall + (dir * depth) / 2), name: item.spec.name, type: item.spec.type, target: item.spec.target });
  }
  const hallMid = (bands[0].hall + bands[1].hall) / 2;
  rooms.push({ point: at(L / 2, hallMid), name: "Hall", type: "hall" });
  for (const room of rooms) {
    const level = doc.levels[0];
    const face = findFaceIndexContaining(deriveLevelGeometry(level).faces, room.point);
    const roomId = [...roomFaceIndices(level)].find(([, f]) => f === face)?.[0];
    if (!roomId) return { ok: false, reason: `couldn't find the region for ${room.name}.` };
    const problem = run({ type: "updateRoom", roomId, changes: { name: room.name, type: room.type, targetArea: room.target ?? null } });
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

const isKitchen = (s: SpaceSpec) => s.type === "kitchen" || s.type === "kitchen_dining";

/**
 * Day rooms along their band. Depth split: living at the start. Width split
 * (band runs front → rear): the kitchen or the living room takes the garden end.
 */
function orderDay(spaces: SpaceSpec[], arrangement: Arrangement, prefs: ReadonlySet<string>): SpaceSpec[] {
  const rank = (s: SpaceSpec): number => {
    const kitchenAtGarden = prefs.has("kitchen_faces_garden");
    if (arrangement.split === "depth") {
      return ({ living: 0, dining: 1, kitchen_dining: 2, kitchen: 2, utility: 3, office: 4, garage: 5 } as Record<string, number>)[s.type] ?? 6;
    }
    const order = kitchenAtGarden
      ? { garage: 0, office: 1, living: 2, dining: 3, utility: 4, kitchen_dining: 5, kitchen: 5 }
      : { garage: 0, office: 1, utility: 2, kitchen: 3, kitchen_dining: 3, dining: 4, living: 5 };
    return (order as Record<string, number>)[s.type] ?? 6;
  };
  const sorted = [...spaces].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
  if (prefs.has("utility_near_kitchen")) {
    const utility = sorted.find((s) => s.type === "utility");
    const kitchen = sorted.find(isKitchen);
    if (utility && kitchen) {
      const rest = sorted.filter((s) => s !== utility);
      rest.splice(rest.indexOf(kitchen) + (arrangement.split === "width" && prefs.has("kitchen_faces_garden") ? 0 : 1), 0, utility);
      return maybeReverse(rest, arrangement);
    }
  }
  return maybeReverse(sorted, arrangement);
}

/** Night rooms: the primary bedroom at the end furthest from the living room. */
function orderNight(spaces: SpaceSpec[], arrangement: Arrangement, prefs: ReadonlySet<string>): SpaceSpec[] {
  const primaryFirst = arrangement.split === "width" && !prefs.has("kitchen_faces_garden");
  const rank = (s: SpaceSpec) => (s.type === "primary_bedroom" ? 0 : s.type === "bedroom" ? 1 : 2);
  const sorted = [...spaces].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
  return maybeReverse(primaryFirst ? sorted : sorted.reverse(), arrangement);
}

const maybeReverse = (spaces: SpaceSpec[], arrangement: Arrangement) => (arrangement.reverse ? [...spaces].reverse() : spaces);

