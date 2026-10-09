import { applyCommand } from "../commands/apply";
import type { PlanCommand } from "../commands/types";
import { furnishRoom, islandSpot, kitchenRun, Layout, toFurniture } from "../furniture/furnish";
import { furnitureIssues } from "../furniture/issues";
import { furnitureInRoom, roomContext, wallSpots, type Placement, type WallSpot } from "../furniture/layout";
import { deriveLevelGeometry, openingHostIntervals } from "../geometry/derive";
import { formatArea, roundToPrecision } from "../geometry/numeric";
import { asAxisRect } from "../geometry/polygons";
import { axialParam } from "../geometry/walls";
import { suggestRoomName } from "../plan/rooms";
import type { Furniture, FurnitureKind, Id, Level, Opening, PlanDocument, Point2, Room, RoomType } from "../plan/types";
import { gardenWallIds, neighbourAcross, roomAtPoint, roomRegion, roomWalls, SIDE_NORMAL, type RoomWall, type Side } from "./analysis";
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
    ? `${unsupported.map((g) => ROOM_GOAL_LABEL[g]).join(", ")} isn't something I can plan yet.`
    : null;
  if (!supported.length) {
    return {
      candidates: [],
      issues: [
        {
          code: "unsupported-intent",
          message: `${unsupportedNote} I can make a room larger or smaller, bring in more light, add garden doors, open it up to a neighbour, add storage, an island, a dining area or an ensuite.`,
        },
      ],
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
    document: tidyFurniture(o.document, o.changed, `${idPrefix}-${seed}`),
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
    case "add_storage":
      return storageOptions(source, roomId, prefix);
    case "add_kitchen_island":
      return islandOptions(source, roomId, prefix);
    case "create_dining_zone":
      return diningOptions(source, roomId, prefix);
    case "add_ensuite":
      return ensuiteOptions(source, roomId, prefix);
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
  const garden = gardenWallIds(level);
  const rear = roomWalls(level, roomId)
    .filter((w) => garden.has(w.wallId))
    .reduce<RoomWall | undefined>((best, w) => (!best || w.to - w.from > best.to - best.from + 1e-9 ? w : best), undefined);
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

// ── Furniture and fittings ───────────────────────────────────────────────

/**
 * After walls move, furniture in the rooms that changed may run into a wall
 * or a door. Those rooms are laid out again; everything else stays put.
 */
function tidyFurniture(doc: PlanDocument, roomIds: Id[], prefix: string): PlanDocument {
  let current = doc;
  roomIds.forEach((roomId, i) => {
    const level = current.levels[0];
    if (!level.rooms[roomId]) return;
    const items = furnitureInRoom(level, roomId);
    const issues = furnitureIssues(level);
    if (!items.some((f) => issues.has(f.id))) return;
    const result = furnishRoom(level, roomId, `${prefix}-t${i}`);
    if (!result) return;
    const applied = applyCommand(current, { type: "replaceFurniture", remove: result.remove, add: result.items });
    if (applied.ok) current = applied.document;
  });
  return current;
}

const SIDE_OF_NORMAL = (n: Point2): Side => (n.y > 0 ? "north" : n.y < 0 ? "south" : n.x > 0 ? "east" : "west");
const metres = (v: number) => `${v.toFixed(1)} m`;

function addOption(source: PlanDocument, items: Furniture[]): PlanDocument | null {
  const result = applyCommand(source, { type: "replaceFurniture", remove: [], add: items });
  return result.ok ? result.document : null;
}

/** Wardrobes in bedrooms, shelving elsewhere: the widest that fits against each free wall. */
function storageOptions(source: PlanDocument, roomId: Id, prefix: string): Option[] | string {
  const level = source.levels[0];
  const room = level.rooms[roomId];
  const sleeping = room.type === "bedroom" || room.type === "primary_bedroom";
  const kind: FurnitureKind = sleeping ? "wardrobe" : "shelving";
  const widths = sleeping ? [2.4, 1.8, 1.2, 0.9] : [2, 1.5, 1, 0.6];
  const ctx = roomContext(level, roomId);
  if (!ctx) return `There's no floor in ${lower(room.name)} to put storage on.`;
  // The widest unit on each wall face.
  const perWall = new Map<string, WallSpot>();
  for (const width of widths) {
    for (const spot of wallSpots(ctx, kind, { width })) {
      const key = `${spot.edge.normal.x},${spot.edge.normal.y},${spot.edge.line}`;
      const seen = perWall.get(key);
      const better = !seen || spot.width > seen.width || (spot.width === seen.width && (spot.flush ? 1 : 0) - spot.offCentre * 0.01 > (seen.flush ? 1 : 0) - seen.offCentre * 0.01);
      if (better) perWall.set(key, spot);
    }
  }
  const options: Option[] = [];
  let n = 0;
  for (const [key, spot] of [...perWall].sort((a, b) => b[1].width - a[1].width).slice(0, 4)) {
    const document = addOption(source, [toFurniture(spot, `${prefix}-s${++n}`)]);
    if (!document) continue;
    const side = SIDE_OF_NORMAL(spot.edge.normal);
    options.push({
      goal: "add_storage",
      document,
      variant: `storage:${kind}:${key}`,
      title: `${capital(room.name)} with ${sleeping ? "a wardrobe" : "shelving"}`,
      summary: `A ${metres(spot.width)} ${sleeping ? "wardrobe" : "run of shelving"} on the ${side} wall of ${lower(room.name)}.`,
      changed: [roomId],
      score: spot.width + (spot.flush ? 0.3 : 0) - (spot.edge.hasDoor ? 0.5 : 0),
    });
  }
  return options.length ? options : `There's no free stretch of wall in ${lower(room.name)} for storage.`;
}

const KITCHENS: ReadonlySet<RoomType> = new Set(["kitchen", "kitchen_dining"]);

/** Kitchen units already in the room, or a new run (with a fridge) to go with the island. */
function kitchenBase(source: PlanDocument, roomId: Id, prefix: string): { document: PlanDocument; run: Placement | null } {
  const level = source.levels[0];
  const existing = furnitureInRoom(level, roomId).find((f) => f.kind === "kitchen_run");
  if (existing) return { document: source, run: existing };
  const ctx = roomContext(level, roomId);
  if (!ctx) return { document: source, run: null };
  const layout = new Layout(ctx);
  const run = kitchenRun(layout);
  const document = run ? addOption(source, layout.placed.map((p, i) => toFurniture(p, `${prefix}-k${i + 1}`))) : null;
  return document ? { document, run } : { document: source, run: null };
}

function islandOptions(source: PlanDocument, roomId: Id, prefix: string): Option[] | string {
  const room = source.levels[0].rooms[roomId];
  if (!KITCHENS.has(room.type)) return `An island goes in a kitchen; ${lower(room.name)} isn't one.`;
  const base = kitchenBase(source, roomId, prefix);
  const options: Option[] = [];
  const sizes: Array<[number, number]> = [
    [2.4, 1],
    [1.8, 0.9],
    [1.2, 0.8],
  ];
  sizes.forEach(([width, depth], i) => {
    const ctx = roomContext(base.document.levels[0], roomId);
    const spot = ctx && islandSpot(new Layout(ctx), base.run, { width, depth });
    const document = spot && addOption(base.document, [toFurniture(spot, `${prefix}-i${i + 1}`)]);
    if (!document) return;
    options.push({
      goal: "add_kitchen_island",
      document,
      variant: `island:${width}`,
      title: `${capital(room.name)} with a ${metres(width)} island`,
      summary: `A ${metres(width)} × ${metres(depth)} island in ${lower(room.name)}, with room to walk round it${base.document === source ? "" : ", and new kitchen units"}.`,
      changed: [roomId],
      score: 1 - i * 0.2,
    });
  });
  return options.length ? options : `${room.name} isn't big enough for an island with room to walk round it.`;
}

const DINING_ROOMS: ReadonlySet<RoomType> = new Set(["kitchen", "kitchen_dining", "dining", "living"]);

function diningOptions(source: PlanDocument, roomId: Id, prefix: string): Option[] | string {
  const level = source.levels[0];
  const room = level.rooms[roomId];
  if (!DINING_ROOMS.has(room.type)) return `A dining area belongs in a kitchen, living or dining room, not ${lower(room.name)}.`;
  const ctx = roomContext(level, roomId);
  if (!ctx) return `There's no floor in ${lower(room.name)} for a table.`;
  const run = furnitureInRoom(level, roomId).find((f) => f.kind === "kitchen_run");
  const middle = { x: (ctx.bounds.minX + ctx.bounds.maxX) / 2, y: (ctx.bounds.minY + ctx.bounds.maxY) / 2 };
  const options: Option[] = [];
  (["dining_set_6", "dining_set_4"] as const).forEach((kind, i) => {
    const spot = new Layout(roomContext(level, roomId)!).free(kind, [0, 90], (p) => {
      const away = run ? Math.hypot(p.position.x - run.position.x, p.position.y - run.position.y) * 0.6 : 0;
      return away - Math.hypot(p.position.x - middle.x, p.position.y - middle.y) * 0.5;
    });
    const document = spot && addOption(source, [toFurniture(spot, `${prefix}-d${i + 1}`)]);
    if (!document) return;
    const seats = kind === "dining_set_6" ? 6 : 4;
    options.push({
      goal: "create_dining_zone",
      document,
      variant: `dining:${seats}`,
      title: `${capital(room.name)} with a table for ${seats}`,
      summary: `A dining table for ${seats} in ${lower(room.name)}.`,
      changed: [roomId],
      score: 1 - i * 0.2,
    });
  });
  return options.length ? options : `There's no clear space in ${lower(room.name)} for a dining table.`;
}

const SLEEPING: ReadonlySet<RoomType> = new Set(["bedroom", "primary_bedroom"]);
const ENSUITE_SIZES: Array<[number, number]> = [
  [2, 1.7],
  [1.7, 2],
  [2.4, 1.8],
];
const PARTITION = 0.1;

/**
 * Walls off a corner of a bedroom as an ensuite, with a door from the
 * bedroom and a shower, toilet and basin. Corners with the bedroom's own
 * door are left alone, and the bedroom keeps a usable size.
 */
function ensuiteOptions(source: PlanDocument, roomId: Id, prefix: string): Option[] | string {
  const level = source.levels[0];
  const room = level.rooms[roomId];
  if (!SLEEPING.has(room.type)) return `An ensuite goes off a bedroom; ${lower(room.name)} isn't one.`;
  const region = roomRegion(level, roomId);
  const rect = region && region.clear.length === 1 ? asAxisRect(region.clear[0]) : null;
  if (!rect) return `I can add an ensuite to rectangular bedrooms; ${lower(room.name)} has a more complex shape.`;
  const minRemaining = room.type === "primary_bedroom" ? 9 : 7.5;
  const walls = roomWalls(level, roomId);
  const axes = deriveLevelGeometry(level).axes;
  const options: Option[] = [];
  let n = 0;
  for (const ns of ["north", "south"] as const) {
    for (const ew of ["east", "west"] as const) {
      for (const [a, b] of ENSUITE_SIZES) {
        const cornerX = ew === "east" ? rect.maxX : rect.minX;
        const cornerY = ns === "north" ? rect.maxY : rect.minY;
        const sx = ew === "east" ? -1 : 1;
        const sy = ns === "north" ? -1 : 1;
        // Clear sizes of the ensuite, then the partition centrelines.
        const xv = roundToPrecision(cornerX + sx * (a + PARTITION / 2));
        const yh = roundToPrecision(cornerY + sy * (b + PARTITION / 2));
        const across = walls.find((w) => w.side === ns && w.from <= Math.min(xv, cornerX) + 0.01 && w.to >= Math.max(xv, cornerX) - 0.01);
        const down = walls.find((w) => w.side === ew && w.from <= Math.min(yh, cornerY) + 0.01 && w.to >= Math.max(yh, cornerY) - 0.01);
        if (!across || !down) continue;
        // The bedroom's door mustn't end up opening into the ensuite.
        const spanX = { ...across, from: Math.min(xv, cornerX), to: Math.max(xv, cornerX) };
        const spanY = { ...down, from: Math.min(yh, cornerY), to: Math.max(yh, cornerY) };
        if (openingsOn(level, spanX, "door").length || openingsOn(level, spanY, "door").length) continue;
        const remaining = (rect.maxX - rect.minX) * (rect.maxY - rect.minY) - (a + PARTITION) * (b + PARTITION);
        if (remaining < minRemaining) continue;
        const yWall = axes.get(across.wallId)!.line;
        const xWall = axes.get(down.wallId)!.line;
        const tag = `${prefix}-e${++n}`;
        const built = applyAll(source, [
          { type: "addWall", start: { x: xv, y: yWall }, end: { x: xv, y: yh }, thickness: PARTITION, idPrefix: `${tag}a` },
          { type: "addWall", start: { x: xv, y: yh }, end: { x: xWall, y: yh }, thickness: PARTITION, idPrefix: `${tag}b` },
        ]);
        if (!built.ok) continue;
        const next = built.document.levels[0];
        const ensuiteId = roomAtPoint(next, { x: cornerX + sx * (a / 2), y: cornerY + sy * (b / 2) });
        const bedroomId = roomAtPoint(next, { x: cornerX + sx * (a + 0.5), y: cornerY + sy * (b + 0.5) });
        if (!ensuiteId || !bedroomId || ensuiteId === bedroomId) continue;
        const finished = finishEnsuite(built.document, ensuiteId, bedroomId, room, { x: cornerX + sx * (a + 1), y: cornerY + sy * (b + 1) }, tag);
        if (!finished) continue;
        options.push({
          goal: "add_ensuite",
          document: finished,
          variant: `ensuite:${ns}${ew}:${a}x${b}`,
          title: `${capital(room.name)} with an ensuite`,
          summary: `A ${a.toFixed(1)} × ${b.toFixed(1)} m ensuite in the ${ns}-${ew} corner of ${lower(room.name)}, with a shower, toilet and basin.`,
          changed: [bedroomId, ensuiteId],
          score: (a === 2 && b === 1.7 ? 1 : 0.8) + remaining / 100,
        });
      }
    }
  }
  return options.length ? options : `${room.name} is too small for an ensuite, or every corner has its door.`;
}

/** Names the new room, puts a door in from the bedroom, and fits it out. */
function finishEnsuite(doc: PlanDocument, ensuiteId: Id, bedroomId: Id, original: Room, bedroomPoint: Point2, tag: string): PlanDocument | null {
  const level = doc.levels[0];
  const geometry = deriveLevelGeometry(level);
  // The longer partition, which has more room for a door.
  const partitions = [...geometry.axes.values()].filter((axis) => axis.wallId.startsWith(`${tag}a`) || axis.wallId.startsWith(`${tag}b`));
  const host = [...partitions].sort((p, q) => q.length - p.length)[0];
  if (!host) return null;
  const interval = openingHostIntervals(geometry, host.wallId).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
  if (!interval || interval[1] - interval[0] < 0.9) return null;
  const width = 0.8;
  const mid = (interval[0] + interval[1]) / 2;
  // Swing into the bedroom, so the ensuite keeps its floor for fittings.
  const centre = { x: host.start.x + host.dir.x * mid, y: host.start.y + host.dir.y * mid };
  const towardBedroom = { x: bedroomPoint.x - centre.x, y: bedroomPoint.y - centre.y };
  const swingSide = towardBedroom.x * host.normal.x + towardBedroom.y * host.normal.y > 0 ? "left" : "right";
  const commands: PlanCommand[] = [
    { type: "updateRoom", roomId: ensuiteId, changes: { type: "ensuite", name: suggestRoomName(level, ensuiteId, "ensuite") } },
    { type: "addOpening", opening: { id: `${tag}-door`, wallId: host.wallId, kind: "door", offset: roundToPrecision(mid - width / 2), width, height: 2.1, hinge: "start", swingSide } },
  ];
  // If the split gave the bedroom a new record, it keeps its old name and type.
  if (bedroomId !== original.id) commands.push({ type: "updateRoom", roomId: bedroomId, changes: { name: original.name, type: original.type } });
  const built = applyAll(doc, commands);
  if (!built.ok) return null;
  const fitted = furnishRoom(built.document.levels[0], ensuiteId, `${tag}-fit`);
  if (!fitted || fitted.missing.length) return null;
  const result = applyCommand(built.document, { type: "replaceFurniture", remove: fitted.remove, add: fitted.items });
  return result.ok ? result.document : null;
}

