import { applyCommand } from "../commands/apply";
import type { PlanCommand } from "../commands/types";
import { deriveLevelGeometry } from "../geometry/derive";
import { formatArea, roundToPrecision } from "../geometry/numeric";
import { axialParam } from "../geometry/walls";
import type { Id, Level, Opening, PlanDocument, RoomType } from "../plan/types";
import { neighbourAcross, roomAtPoint, roomRegion, roomWalls, SIDE_NORMAL, type RoomWall } from "./analysis";
import { ROOM_GOAL_LABEL, suggestedGoals, SUPPORTED_ROOM_GOALS, type RoomGoal } from "./intent";
import type { PlanCandidate, PlanningRequest, PlanningResult } from "./planner";

/**
 * Room-level changes: small, explainable edits to one room of an existing
 * plan, each built from ordinary commands so it is exactly as valid as a
 * hand edit. Options are offered, never applied: callers decide what to do
 * with them.
 */

interface Option {
  goal: RoomGoal;
  document: PlanDocument;
  /** Identifies the option across requests ("Generate more" leaves out ones already shown). */
  variant: string;
  title: string;
  summary: string;
  changed: Id[];
  /** Higher is better within a goal. */
  score: number;
}

type Built = { ok: true; document: PlanDocument } | { ok: false; reason: string };

function applyAll(doc: PlanDocument, commands: PlanCommand[]): Built {
  let current = doc;
  for (const command of commands) {
    const result = applyCommand(current, command);
    if (!result.ok) return { ok: false, reason: result.issues[0]?.message ?? "invalid edit" };
    current = result.document;
  }
  return { ok: true, document: current };
}

const areaOf = (level: Level, roomId: Id) => roomRegion(level, roomId)?.clearArea ?? 0;
const DAY: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining", "office"]);
const lower = (s: string) => s.toLowerCase();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function planRoomChange(request: PlanningRequest): PlanningResult {
  const { intent, source, idPrefix } = request;
  if (intent.action === "generate_layouts") return { candidates: [], issues: [{ code: "unsupported-intent", message: "Not a room request." }] };
  const roomId = intent.action === "redesign_room" ? intent.roomId : intent.roomIds[0];
  const count = intent.action === "room_variations" ? intent.count : 3;
  const level = source.levels[0];
  const room = level.rooms[roomId];

  if (!room && !intent.goals.length) return { candidates: [], issues: [{ code: "invalid-source", message: "That room isn't on this plan any more." }] };
  // No goals: a spread of what the planner can do for this kind of room.
  const goals: RoomGoal[] = intent.goals.length ? intent.goals : room ? [...new Set<RoomGoal>([...suggestedGoals(room.type), "make_larger", "make_smaller"])] : [];
  const exclude = new Set(intent.exclude ?? []);
  const supported = goals.filter((g) => SUPPORTED_ROOM_GOALS.has(g));
  const unsupported = goals.filter((g) => !SUPPORTED_ROOM_GOALS.has(g));
  const unsupportedNote = unsupported.length
    ? `${unsupported.map((g) => ROOM_GOAL_LABEL[g]).join(", ")} needs furniture and fittings, which aren't modelled yet.`
    : null;
  if (!supported.length) {
    return {
      candidates: [],
      issues: [{ code: "unsupported-intent", message: `${unsupportedNote} I can make a room larger or smaller, bring in more light, add garden doors or open it up to a neighbour.` }],
    };
  }

  if (!room || !roomRegion(level, roomId)) return { candidates: [], issues: [{ code: "invalid-source", message: "That room isn't on this plan any more." }] };

  const reasons: string[] = [];
  const byGoal = supported.map((goal) => {
    const result = optionsFor(goal, source, roomId, `${idPrefix}-${goal}`);
    if (typeof result === "string") {
      reasons.push(result);
      return [];
    }
    return result.filter((o) => !exclude.has(o.variant)).sort((a, b) => b.score - a.score);
  });

  // Take the best of each goal in turn, so mixed requests get a spread.
  const picked: Option[] = [];
  for (let round = 0; picked.length < count && byGoal.some((list) => list.length > round); round++) {
    for (const list of byGoal) if (list[round] && picked.length < count) picked.push(list[round]);
  }
  if (!picked.length) {
    const message = exclude.size ? `There are no more distinct options for ${lower(room.name)}.` : (reasons[0] ?? `I couldn't find a change to ${room.name} that keeps the plan valid.`);
    return { candidates: [], issues: [{ code: "does-not-fit", message }] };
  }
  const candidates: PlanCandidate[] = picked.map((o, seed) => ({
    document: o.document,
    summary: o.summary,
    notes: unsupportedNote ? [unsupportedNote] : [],
    seed,
    changedRoomIds: o.changed,
    title: o.title,
    goal: o.goal,
    variant: o.variant,
  }));
  return { candidates, issues: [] };
}

function optionsFor(goal: RoomGoal, source: PlanDocument, roomId: Id, prefix: string): Option[] | string {
  switch (goal) {
    case "make_larger":
      return resizeOptions(source, roomId, true, prefix);
    case "make_smaller":
      return resizeOptions(source, roomId, false, prefix);
    case "more_natural_light":
      return lightOptions(source, roomId, prefix);
    case "increase_garden_connection":
      return gardenOptions(source, roomId, prefix);
    case "make_open_plan":
      return openPlanOptions(source, roomId, prefix);
    default:
      return `${ROOM_GOAL_LABEL[goal]} isn't available yet.`;
  }
}

/** Moves each internal wall of the room out (or in) by a few steps, keeping neighbours usable. */
function resizeOptions(source: PlanDocument, roomId: Id, grow: boolean, prefix: string): Option[] | string {
  const level = source.levels[0];
  const room = level.rooms[roomId];
  const before = Object.fromEntries(Object.keys(level.rooms).map((id) => [id, areaOf(level, id)]));
  const walls = roomWalls(level, roomId).filter((w) => !w.external);
  if (!walls.length) return `${room.name} is bounded only by outside walls, so it can't ${grow ? "grow" : "shrink"} without resizing the house.`;
  const options: Option[] = [];
  for (const wall of walls) {
    const n = SIDE_NORMAL[wall.side];
    const outward = n.x + n.y;
    const neighbourId = neighbourAcross(level, wall, (wall.from + wall.to) / 2);
    const neighbour = neighbourId ? level.rooms[neighbourId] : null;
    for (const step of [0.3, 0.6, 0.9]) {
      const result = applyCommand(source, { type: "moveWall", wallId: wall.wallId, delta: (grow ? 1 : -1) * outward * step, idPrefix: `${prefix}-${wall.wallId}-${step}` });
      if (!result.ok) continue;
      const next = result.document.levels[0];
      if (next.rooms[roomId]?.name !== room.name) continue;
      const change = areaOf(next, roomId) - before[roomId];
      if (grow ? change < 0.5 : change > -0.5) continue;
      // Every other room keeps a usable share of its floor.
      const fine = Object.entries(before).every(([id, area]) => {
        if (id === roomId) return true;
        const after = next.rooms[id] ? areaOf(next, id) : 0;
        const floor = level.rooms[id].type === "hall" ? 0.6 : 0.7;
        return after >= Math.min(area, 2) && after >= area * floor;
      });
      if (!fine) continue;
      const other = neighbour ? neighbour.name : "the next room";
      options.push({
        goal: grow ? "make_larger" : "make_smaller",
        document: result.document,
        variant: `${grow ? "larger" : "smaller"}:${wall.wallId}:${step}`,
        title: `${grow ? "Larger" : "Compact"} ${lower(room.name)}`,
        summary: grow
          ? `${room.name} ${formatArea(change)} larger, taking space from ${lower(other)}.`
          : `${room.name} ${formatArea(-change)} smaller, giving the space to ${lower(other)}.`,
        changed: neighbourId ? [roomId, neighbourId] : [roomId],
        // Prefer a middling step, taken from circulation or the roomiest neighbour.
        score: (step === 0.6 ? 1 : 0.5) + (neighbour?.type === "hall" ? 0.5 : 0) + (neighbourId ? before[neighbourId] / 40 : 0),
      });
    }
  }
  // One option per wall first, so the offers differ in more than step size.
  const seen = new Set<string>();
  const firsts: Option[] = [];
  const rest: Option[] = [];
  for (const o of options.sort((a, b) => b.score - a.score)) {
    const key = o.changed.join();
    (seen.has(key) ? rest : firsts).push(o);
    seen.add(key);
  }
  rest.forEach((o) => (o.score -= 10));
  if (!firsts.length) return `${room.name} can't ${grow ? "grow" : "shrink"} without making a neighbouring room too small.`;
  return [...firsts, ...rest];
}

const centreOffset = (level: Level, wall: RoomWall, width: number) => {
  const axis = deriveLevelGeometry(level).axes.get(wall.wallId)!;
  const mid = (wall.from + wall.to) / 2;
  const centre = axis.orientation === "horizontal" ? { x: mid, y: axis.line } : { x: axis.line, y: mid };
  return roundToPrecision(axialParam(axis, centre) - width / 2);
};

/** Openings of a kind on this stretch of wall. */
function openingsOn(level: Level, wall: RoomWall, kind?: Opening["kind"]): Opening[] {
  const axis = deriveLevelGeometry(level).axes.get(wall.wallId);
  if (!axis) return [];
  return Object.values(level.openings).filter((o) => {
    if (o.wallId !== wall.wallId || (kind && o.kind !== kind)) return false;
    const a = axis.orientation === "horizontal" ? axis.start.x + axis.dir.x * o.offset : axis.start.y + axis.dir.y * o.offset;
    const b = axis.orientation === "horizontal" ? axis.start.x + axis.dir.x * (o.offset + o.width) : axis.start.y + axis.dir.y * (o.offset + o.width);
    return Math.min(Math.max(a, b), wall.to) - Math.max(Math.min(a, b), wall.from) > 0.05;
  });
}

function lightOptions(source: PlanDocument, roomId: Id, prefix: string): Option[] | string {
  const level = source.levels[0];
  const room = level.rooms[roomId];
  const outside = roomWalls(level, roomId).filter((w) => w.external);
  if (!outside.length) return `${room.name} has no outside wall to add windows to.`;
  const options: Option[] = [];
  let n = 0;

  // Wider (or new) windows on every outside wall.
  const widen: PlanCommand[] = [];
  for (const wall of outside) {
    const span = wall.to - wall.from;
    const windows = openingsOn(level, wall, "window");
    if (windows.length) {
      for (const w of windows) {
        const width = roundToPrecision(Math.min(w.width + 0.6, span - 0.6));
        if (width > w.width) widen.push({ type: "updateOpening", openingId: w.id, changes: { width, offset: roundToPrecision(w.offset - (width - w.width) / 2) } });
      }
    } else if (span >= 1.6 && !openingsOn(level, wall).length) {
      const width = roundToPrecision(Math.min(1.4, span - 0.6));
      widen.push({ type: "addOpening", opening: { id: `${prefix}-o${++n}`, wallId: wall.wallId, kind: "window", offset: centreOffset(level, wall, width), width, height: 1.2, sillHeight: 0.9 } });
    }
  }
  const wider = widen.length ? applyAll(source, widen) : null;
  if (wider?.ok) {
    options.push({
      goal: "more_natural_light",
      document: wider.document,
      variant: "light:wider",
      title: `${capital(room.name)} with wider windows`,
      summary: `Wider windows on every outside wall of ${lower(room.name)}.`,
      changed: [roomId],
      score: 1,
    });
  }

  // One large picture window on the longest outside wall.
  const longest = [...outside].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  const span = longest.to - longest.from;
  const width = roundToPrecision(Math.min(2.4, span - 0.6));
  if (width >= 1.2) {
    const existing = openingsOn(level, longest);
    if (existing.every((o) => o.kind === "window")) {
      const picture = applyAll(source, [
        ...existing.map((o): PlanCommand => ({ type: "deleteOpening", openingId: o.id })),
        { type: "addOpening", opening: { id: `${prefix}-o${++n}`, wallId: longest.wallId, kind: "window", offset: centreOffset(level, longest, width), width, height: 1.5, sillHeight: 0.6 } },
      ]);
      if (picture.ok) {
        options.push({
          goal: "more_natural_light",
          document: picture.document,
          variant: `light:picture:${longest.wallId}`,
          title: `${capital(room.name)} with a picture window`,
          summary: `A ${width.toFixed(1)} m picture window on the ${longest.side} wall of ${lower(room.name)}.`,
          changed: [roomId],
          score: 0.8,
        });
      }
    }
  }
  return options.length ? options : `There's no room for more windows in ${lower(room.name)}.`;
}

function gardenOptions(source: PlanDocument, roomId: Id, prefix: string): Option[] | string {
  const level = source.levels[0];
  const room = level.rooms[roomId];
  if (!level.rearWallId) return "Mark the rear (garden) wall in Structure first, so I know where the garden is.";
  const rear = roomWalls(level, roomId).find((w) => w.wallId === level.rearWallId);
  if (!rear) return `${room.name} doesn't reach the garden wall. Try a room along the rear of the house.`;
  const axis = deriveLevelGeometry(level).axes.get(rear.wallId)!;
  const inside = { x: -SIDE_NORMAL[rear.side].x, y: -SIDE_NORMAL[rear.side].y };
  const swingSide = inside.x * axis.normal.x + inside.y * axis.normal.y < 0 ? "right" : "left";
  const existing = openingsOn(level, rear);
  const options: Option[] = [];
  const span = rear.to - rear.from;
  [1.8, 2.4].forEach((width, i) => {
    if (span - 0.6 < width) return;
    const built = applyAll(source, [
      ...existing.map((o): PlanCommand => ({ type: "deleteOpening", openingId: o.id })),
      { type: "addOpening", opening: { id: `${prefix}-d${i + 1}`, wallId: rear.wallId, kind: "door", offset: centreOffset(level, rear, width), width, height: 2.1, hinge: "start", swingSide } },
    ]);
    if (built.ok) {
      options.push({
        goal: "increase_garden_connection",
        document: built.document,
        variant: `garden:${width}`,
        title: `${capital(room.name)} with ${width.toFixed(1)} m garden doors`,
        summary: `${width.toFixed(1)} m garden doors from ${lower(room.name)}${existing.length ? ", in place of the window" : ""}.`,
        changed: [roomId],
        score: 1 - i * 0.2,
      });
    }
  });
  return options.length ? options : `The garden wall of ${lower(room.name)} is too short for garden doors.`;
}

function openPlanOptions(source: PlanDocument, roomId: Id, prefix: string): Option[] | string {
  const level = source.levels[0];
  const room = level.rooms[roomId];
  const label = roomRegion(level, roomId)!.labelPoint;
  const count = Object.keys(level.rooms).length;
  const options: Option[] = [];
  for (const wall of roomWalls(level, roomId).filter((w) => !w.external)) {
    const neighbourId = neighbourAcross(level, wall, (wall.from + wall.to) / 2);
    const neighbour = neighbourId ? level.rooms[neighbourId] : null;
    // Only day spaces open into each other; bedrooms and bathrooms stay enclosed.
    if (!neighbour || !DAY.has(neighbour.type) || !DAY.has(room.type)) continue;
    const removed = applyCommand(source, { type: "deleteWall", wallId: wall.wallId, idPrefix: `${prefix}-${wall.wallId}` });
    if (!removed.ok) continue;
    const next = removed.document.levels[0];
    // The wall must only have separated these two rooms.
    if (Object.keys(next.rooms).length !== count - 1) continue;
    const merged = roomAtPoint(next, label);
    if (!merged) continue;
    const kitchen = [room.type, neighbour.type].some((t) => t === "kitchen" || t === "kitchen_dining");
    const names = [...new Set([...room.name.split(" / "), ...neighbour.name.split(" / ")])];
    const named = applyCommand(removed.document, {
      type: "updateRoom",
      roomId: merged,
      changes: { name: names.join(" / ").slice(0, 80), type: kitchen ? "kitchen_dining" : "living" },
    });
    if (!named.ok) continue;
    options.push({
      goal: "make_open_plan",
      document: named.document,
      variant: `open:${wall.wallId}`,
      title: `${capital(room.name)} opened to ${lower(neighbour.name)}`,
      summary: `${room.name} opened up to ${lower(neighbour.name)} as one space.`,
      changed: [merged],
      score: 1,
    });
  }
  return options.length ? options : `${room.name} has no living space beside it that can be opened up.`;
}
