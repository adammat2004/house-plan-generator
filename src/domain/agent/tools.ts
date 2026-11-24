import { z } from "zod";
import { applyCommand, validateDocument, type PlanCommand } from "../commands";
import { compareRoom, neighbourAcross, roomAtPoint, roomBounds, roomRegion, roomResizeCommand, roomWalls, type RoomWall } from "../design/analysis";
import { ROOM_GOAL_LABEL, ROOM_GOALS, SUPPORTED_ROOM_GOALS, type RoomGoal } from "../design/intent";
import { planRoomChange } from "../design/roomPlanner";
import { deriveLevelGeometry, openingHostIntervals } from "../geometry/derive";
import { roundToPrecision } from "../geometry/numeric";
import { axialParam, pointAtParam } from "../geometry/walls";
import { DEFAULT_HOUSE, DOOR_PRESET, WINDOW_PRESET } from "../plan/defaults";
import { levelIndex, levelOf, levelView, spliceLevel, storeyName } from "../plan/levels";
import { suggestRoomName } from "../plan/rooms";
import { ROOM_TYPES } from "../plan/schema";
import type { Id, Level, PlanDocument, Point2, Room } from "../plan/types";
import type { AgentTool, ToolContext, ToolOutcome } from "./types";

/**
 * The built-in tools: room edits, doors and windows, and floors. Each one
 * goes through the domain's own commands and planners (see types.ts), and
 * says in plain words what it did or why it couldn't.
 */

const PARTITION = DEFAULT_HOUSE.internalThickness;
const SIDES = ["north", "south", "east", "west"] as const;
type Side = (typeof SIDES)[number];

const sideSchema = z.enum(SIDES).describe("A side of the room as drawn on the plan: north is the top, south the bottom, east the right, west the left.");
const roomIdSchema = z.string().min(1).describe("A room id exactly as it appears in the plan summary.");

const fail = (code: string, message: string): ToolOutcome => ({ ok: false, code, message });
const lower = (s: string) => s.toLowerCase();
const m = (v: number) => v.toFixed(1);

function tool<S extends z.ZodType>(definition: AgentTool<S>): AgentTool {
  return definition as unknown as AgentTool;
}

function roomOf(document: PlanDocument, roomId: Id): { level: Level; room: Room } | ToolOutcome {
  const level = levelOf(document, roomId);
  const room = level?.rooms[roomId];
  if (!level || !room) return fail("not-found", `There is no room with id "${roomId}". Use an id from the plan summary.`);
  return { level, room };
}
const isFailure = (r: { level: Level; room: Room } | ToolOutcome): r is ToolOutcome => "ok" in r;

/** Runs commands in order on a copy; the first failure stops and reports. */
function runAll(document: PlanDocument, commands: PlanCommand[], prefix: string): { ok: true; document: PlanDocument } | ToolOutcome {
  let current = document;
  for (const [i, command] of commands.entries()) {
    const result = applyCommand(current, command.idPrefix ? command : { ...command, idPrefix: `${prefix}c${i}-` });
    if (!result.ok) return fail(result.issues[0]?.code ?? "invalid", result.issues.map((issue) => issue.message).join(" "));
    current = result.document;
  }
  return { ok: true, document: current };
}
const failed = (r: { ok: true; document: PlanDocument } | ToolOutcome): r is ToolOutcome => !r.ok;

const levelOfRoom = (document: PlanDocument, roomId: Id): Level => levelOf(document, roomId)!;

function dimensions(level: Level, roomId: Id): string {
  const b = roomBounds(level, roomId);
  return b ? `${m(b.maxX - b.minX)} × ${m(b.maxY - b.minY)} m` : "unknown size";
}

/** Offsets along a wall where something of `width` fits between corners and existing openings, widest first. */
function freeStretches(level: Level, wallId: Id, lo: number, hi: number, width: number): Array<[number, number]> {
  const geometry = deriveLevelGeometry(level);
  const taken = Object.values(level.openings)
    .filter((o) => o.wallId === wallId)
    .map((o) => [o.offset - 0.05, o.offset + o.width + 0.05] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of openingHostIntervals(geometry, wallId)) {
    let cursor = Math.max(a, lo);
    const end = Math.min(b, hi);
    for (const [t0, t1] of taken) {
      if (t1 <= cursor || t0 >= end) continue;
      if (t0 - cursor >= width + 0.1) out.push([cursor, t0]);
      cursor = Math.max(cursor, t1);
    }
    if (end - cursor >= width + 0.1) out.push([cursor, end]);
  }
  return out.sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
}

/** Where an opening of `width` goes on part of a wall, centred in the widest free stretch; swings toward `toward`. */
function placeOpening(level: Level, wallId: Id, from: number, to: number, width: number, toward: Point2 | null) {
  const axis = deriveLevelGeometry(level).axes.get(wallId);
  if (!axis) return null;
  const at = (c: number): Point2 => (axis.orientation === "horizontal" ? { x: c, y: axis.line } : { x: axis.line, y: c });
  const [a, b] = [axialParam(axis, at(from)), axialParam(axis, at(to))].sort((p, q) => p - q);
  const stretch = freeStretches(level, wallId, a, b, width)[0];
  if (!stretch) return null;
  const offset = roundToPrecision((stretch[0] + stretch[1]) / 2 - width / 2);
  const centre = pointAtParam(axis, offset + width / 2);
  const swingSide = toward && (toward.x - centre.x) * axis.normal.x + (toward.y - centre.y) * axis.normal.y > 0 ? ("left" as const) : ("right" as const);
  return { offset, swingSide, stretch };
}

/** The stretch of `wall` that has room `otherId` on its far side. */
function sharedStretch(level: Level, wall: RoomWall, otherId: Id): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let c = wall.from + 0.05; c < wall.to; c += 0.1) {
    if (neighbourAcross(level, wall, c) === otherId) {
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
  }
  return hi > lo ? [lo, hi] : null;
}

const SUPPORTED_GOALS = ROOM_GOALS.filter((g) => SUPPORTED_ROOM_GOALS.has(g)) as unknown as [RoomGoal, ...RoomGoal[]];

const renameRoom = tool({
  name: "rename_room",
  description: "Rename a room. Does not change what the room is used for; use set_room_type for that.",
  input: z.object({ roomId: roomIdSchema, name: z.string().trim().min(1).max(80) }),
  run({ document, idPrefix }, { roomId, name }) {
    const found = roomOf(document, roomId);
    if (isFailure(found)) return found;
    const result = runAll(document, [{ type: "updateRoom", roomId, changes: { name } }], idPrefix);
    if (failed(result)) return result;
    return { ok: true, kind: "change", document: result.document, summary: `Renamed "${found.room.name}" to "${name}".`, roomIds: [roomId] };
  },
});

const setRoomType = tool({
  name: "set_room_type",
  description: "Change what a room is used for (for example a study becomes a bedroom). Keeps its walls, doors and windows; the name is unchanged unless you pass one.",
  input: z.object({ roomId: roomIdSchema, type: z.enum(ROOM_TYPES), name: z.string().trim().min(1).max(80).optional() }),
  run({ document, idPrefix }, { roomId, type, name }) {
    const found = roomOf(document, roomId);
    if (isFailure(found)) return found;
    const result = runAll(document, [{ type: "updateRoom", roomId, changes: { type, ...(name ? { name } : {}) } }], idPrefix);
    if (failed(result)) return result;
    return { ok: true, kind: "change", document: result.document, summary: `${name ?? found.room.name} is now a ${type.replace(/_/g, " ")}.`, roomIds: [roomId] };
  },
});

const swapRooms = tool({
  name: "swap_rooms",
  description:
    "Swap what two rooms are used for and what they are called, so each takes the other's purpose. The walls stay where they are, so the rooms keep their own sizes and positions: a large bedroom swapped with a small study leaves a small bedroom and a large study. Use it for requests like 'swap bedroom 2 and the study'.",
  input: z.object({ roomA: roomIdSchema, roomB: roomIdSchema }),
  run({ document, idPrefix }, { roomA, roomB }) {
    if (roomA === roomB) return fail("invalid", "Those are the same room.");
    const a = roomOf(document, roomA);
    if (isFailure(a)) return a;
    const b = roomOf(document, roomB);
    if (isFailure(b)) return b;
    const result = runAll(
      document,
      [
        { type: "updateRoom", roomId: roomA, changes: { name: b.room.name, type: b.room.type } },
        { type: "updateRoom", roomId: roomB, changes: { name: a.room.name, type: a.room.type } },
      ],
      idPrefix,
    );
    if (failed(result)) return result;
    return {
      ok: true,
      kind: "change",
      document: result.document,
      summary: `Swapped "${a.room.name}" (${dimensions(a.level, roomA)}) and "${b.room.name}" (${dimensions(b.level, roomB)}); each room kept its position and size.`,
      roomIds: [roomA, roomB],
    };
  },
});

const resizeRoom = tool({
  name: "resize_room",
  description:
    "Set a room's clear width (east-west) and/or depth (north-south) in metres by moving one of its internal walls; the room on the other side gives or takes the difference. Fails when the side is an outside wall or no single wall runs along it. For vague requests ('bigger') prefer improve_room.",
  input: z.object({ roomId: roomIdSchema, widthM: z.number().min(0.8).max(20).optional(), depthM: z.number().min(0.8).max(20).optional() }),
  run({ document, idPrefix }, { roomId, widthM, depthM }) {
    if (widthM === undefined && depthM === undefined) return fail("invalid", "Give widthM, depthM or both.");
    const found = roomOf(document, roomId);
    if (isFailure(found)) return found;
    const before = dimensions(found.level, roomId);
    let current = document;
    for (const [dimension, size] of [["width", widthM], ["depth", depthM]] as const) {
      if (size === undefined) continue;
      const command = roomResizeCommand(levelOfRoom(current, roomId), roomId, dimension, size);
      if (command === null) continue;
      if (typeof command === "string") return fail("cannot-resize", command);
      const result = runAll(current, [command], `${idPrefix}${dimension}-`);
      if (failed(result)) return result;
      current = result.document;
    }
    if (current === document) return fail("no-change", `${found.room.name} is already ${before}.`);
    return { ok: true, kind: "change", document: current, summary: `${found.room.name} is now ${dimensions(levelOfRoom(current, roomId), roomId)} (was ${before}).`, roomIds: [roomId] };
  },
});

const improveRoom = tool({
  name: "improve_room",
  description: `Redesign one room towards a goal using the room planner, which also adjusts neighbouring rooms where needed. Goals: ${SUPPORTED_GOALS.map((g) => `${g} (${ROOM_GOAL_LABEL[g]})`).join(", ")}. Use make_larger / make_smaller for 'bigger' / 'smaller'; add_ensuite works on a bedroom. Fails with the planner's reason when the goal can't be met.`,
  input: z.object({ roomId: roomIdSchema, goal: z.enum(SUPPORTED_GOALS) }),
  run({ document, brief, idPrefix }, { roomId, goal }) {
    const found = roomOf(document, roomId);
    if (isFailure(found)) return found;
    const { level, room } = found;
    const upstairs = levelIndex(document, level.id) > 0;
    if (upstairs && goal === "increase_garden_connection") return fail("unsupported", "Rooms upstairs can't open onto the garden.");
    const result = planRoomChange({ intent: { action: "redesign_room", roomId, goals: [goal] }, source: document.levels.length === 1 ? document : levelView(document, level.id), brief, idPrefix });
    const candidates = result.candidates
      .map((c) => ({ ...c, document: document.levels.length === 1 ? c.document : spliceLevel(document, level.id, c.document) }))
      .filter((c) => validateDocument(c.document).length === 0);
    const best = candidates[0];
    if (!best) {
      const reason = result.issues[0]?.message ?? (result.candidates.length ? "Those changes would run into the stairs or the floors around them." : `I couldn't find a way to do that for ${lower(room.name)}.`);
      return fail("no-option", reason);
    }
    const changedIds = best.changedRoomIds?.length ? best.changedRoomIds : [roomId];
    const after = levelOf(best.document, roomId) ?? level;
    const lines = compareRoom(level, after, roomId).map((c) => c.text);
    return { ok: true, kind: "change", document: best.document, summary: `${best.title ?? ROOM_GOAL_LABEL[goal]}: ${best.summary}${lines.length ? ` (${lines.join("; ")})` : ""}`, roomIds: changedIds };
  },
});

const CORNERS = ["north_east", "north_west", "south_east", "south_west"] as const;

const addRoom = tool({
  name: "add_room",
  description:
    "Add a new small room by partitioning a corner off an existing rectangular room (a downstairs toilet from a hall, a study from a bedroom). Gives the new room a door from the room it came out of, which keeps the rest. The new room has no window; add one with add_window if it has an outside wall. Fails if the corner isn't bounded by one straight wall on each side or too little would be left.",
  input: z.object({
    fromRoomId: roomIdSchema.describe("The room to take the space from."),
    corner: z.enum(CORNERS).describe("Which corner of that room, as drawn on the plan."),
    widthM: z.number().min(0.8).max(6).describe("Clear width of the new room, east-west, in metres. A toilet is about 0.9 to 1.2."),
    depthM: z.number().min(0.8).max(6).describe("Clear depth of the new room, north-south, in metres. A toilet is about 1.5 to 2."),
    type: z.enum(ROOM_TYPES),
    name: z.string().trim().min(1).max(80).optional(),
  }),
  run({ document, idPrefix }, { fromRoomId, corner, widthM: a, depthM: b, type, name }) {
    const found = roomOf(document, fromRoomId);
    if (isFailure(found)) return found;
    const { level, room } = found;
    const region = roomRegion(level, fromRoomId);
    const rect = roomBounds(level, fromRoomId);
    if (!region || !rect) return fail("not-found", "That room isn't on the plan.");
    const width = rect.maxX - rect.minX;
    const depth = rect.maxY - rect.minY;
    if (region.clearArea < width * depth * 0.97) return fail("not-rectangular", `${room.name} isn't a plain rectangle, so I can't partition a corner off it.`);
    const [ns, ew] = corner.split("_") as [Side, Side];
    const cornerX = ew === "east" ? rect.maxX : rect.minX;
    const cornerY = ns === "north" ? rect.maxY : rect.minY;
    const sx = ew === "east" ? -1 : 1;
    const sy = ns === "north" ? -1 : 1;
    if (width - a - PARTITION < 1 && depth - b - PARTITION < 1) return fail("too-big", `${room.name} is ${m(width)} × ${m(depth)} m; a ${m(a)} × ${m(b)} m room would leave too little of it.`);
    if (region.clearArea - (a + PARTITION) * (b + PARTITION) < region.clearArea * 0.35) return fail("too-big", `A ${m(a)} × ${m(b)} m room would take too much of ${lower(room.name)} (${m(region.clearArea)} m²).`);
    const xv = roundToPrecision(cornerX + sx * (a + PARTITION / 2));
    const yh = roundToPrecision(cornerY + sy * (b + PARTITION / 2));
    const walls = roomWalls(level, fromRoomId);
    const across = walls.find((w) => w.side === ns && w.from <= Math.min(xv, cornerX) + 0.01 && w.to >= Math.max(xv, cornerX) - 0.01);
    const down = walls.find((w) => w.side === ew && w.from <= Math.min(yh, cornerY) + 0.01 && w.to >= Math.max(yh, cornerY) - 0.01);
    if (!across || !down) return fail("no-corner", `That corner of ${lower(room.name)} isn't bounded by one straight wall on each side. Try another corner.`);
    const axes = deriveLevelGeometry(level).axes;
    const inSpan = (wall: RoomWall, lo: number, hi: number) =>
      Object.values(level.openings).some((o) => {
        if (o.wallId !== wall.wallId) return false;
        const axis = axes.get(wall.wallId)!;
        const at = (c: number): Point2 => (axis.orientation === "horizontal" ? { x: c, y: axis.line } : { x: axis.line, y: c });
        const [p, q] = [axialParam(axis, at(lo)), axialParam(axis, at(hi))].sort((x, y) => x - y);
        return o.offset < q && o.offset + o.width > p;
      });
    if (inSpan(across, Math.min(xv, cornerX), Math.max(xv, cornerX)) || inSpan(down, Math.min(yh, cornerY), Math.max(yh, cornerY))) {
      return fail("opening-in-the-way", `A door or window of ${lower(room.name)} is in the way in that corner. Try another corner.`);
    }
    const yWall = axes.get(across.wallId)!.line;
    const xWall = axes.get(down.wallId)!.line;
    const tag = `${idPrefix}p`;
    const built = runAll(
      document,
      [
        { type: "addWall", start: { x: xv, y: yWall }, end: { x: xv, y: yh }, thickness: PARTITION, idPrefix: `${tag}a`, levelId: level.id },
        { type: "addWall", start: { x: xv, y: yh }, end: { x: xWall, y: yh }, thickness: PARTITION, idPrefix: `${tag}b`, levelId: level.id },
      ],
      idPrefix,
    );
    if (failed(built)) return built;
    const nextLevel = built.document.levels[levelIndex(built.document, level.id)];
    const newId = roomAtPoint(nextLevel, { x: cornerX + sx * (a / 2), y: cornerY + sy * (b / 2) });
    const hostId = roomAtPoint(nextLevel, { x: cornerX + sx * (a + 0.5), y: cornerY + sy * (b + 0.5) });
    if (!newId || !hostId || newId === hostId) return fail("no-room", "The partition didn't make a separate room.");
    const geometry = deriveLevelGeometry(nextLevel);
    const partitions = [...geometry.axes.values()].filter((axis) => axis.wallId.startsWith(`${tag}a`) || axis.wallId.startsWith(`${tag}b`));
    const host = [...partitions].sort((p, q) => q.length - p.length)[0];
    const hostSeed = nextLevel.rooms[hostId]?.seed ?? null;
    const door = host && placeOpening(nextLevel, host.wallId, host.min, host.max, 0.8, hostSeed);
    if (!host || !door) return fail("no-door", "There's no room for a door into the new room in that corner. Try another corner or size.");
    const finalName = name ?? suggestRoomName(nextLevel, newId, type);
    const commands: PlanCommand[] = [
      { type: "updateRoom", roomId: newId, changes: { type, name: finalName }, levelId: level.id },
      { type: "addOpening", opening: { id: `${idPrefix}door`, wallId: host.wallId, kind: "door", offset: door.offset, width: 0.8, height: DOOR_PRESET.height, hinge: "start", swingSide: door.swingSide } },
    ];
    if (hostId !== fromRoomId) commands.push({ type: "updateRoom", roomId: hostId, changes: { name: room.name, type: room.type }, levelId: level.id });
    const finished = runAll(built.document, commands, idPrefix);
    if (failed(finished)) return finished;
    const after = finished.document.levels[levelIndex(finished.document, level.id)];
    return {
      ok: true,
      kind: "change",
      document: finished.document,
      summary: `Added "${finalName}" (${dimensions(after, newId)}) in the ${ns}-${ew} corner of ${lower(room.name)}, with a door from it. ${room.name} is now ${dimensions(after, hostId)}.`,
      roomIds: [newId, hostId],
      data: { newRoomId: newId, remainingRoomId: hostId },
    };
  },
});

const addWindow = tool({
  name: "add_window",
  description: "Add a window to an outside wall of a room, centred in the widest free stretch of that side. Fails if the side isn't an outside wall or has no free stretch.",
  input: z.object({ roomId: roomIdSchema, side: sideSchema, widthM: z.number().min(0.4).max(3).optional() }),
  run({ document, idPrefix }, { roomId, side, widthM }) {
    const found = roomOf(document, roomId);
    if (isFailure(found)) return found;
    const { level, room } = found;
    const outside = roomWalls(level, roomId).filter((w) => w.side === side && w.external);
    if (!outside.length) return fail("no-outside-wall", `The ${side} side of ${lower(room.name)} isn't an outside wall, so it can't have a window.`);
    const width = widthM ?? WINDOW_PRESET.width;
    for (const wall of outside.sort((p, q) => q.to - q.from - (p.to - p.from))) {
      const spot = placeOpening(level, wall.wallId, wall.from, wall.to, width, null);
      if (!spot) continue;
      const result = runAll(document, [{ type: "addOpening", opening: { id: `${idPrefix}win`, wallId: wall.wallId, kind: "window", offset: spot.offset, width, height: WINDOW_PRESET.height, sillHeight: WINDOW_PRESET.sillHeight } }], idPrefix);
      if (failed(result)) return result;
      return { ok: true, kind: "change", document: result.document, summary: `Added a ${m(width)} m window to the ${side} wall of ${lower(room.name)}.`, roomIds: [roomId] };
    }
    return fail("no-space", `There's no free stretch on the ${side} wall of ${lower(room.name)} wide enough for a ${m(width)} m window.`);
  },
});

const addDoor = tool({
  name: "add_door",
  description: "Add a door from a room into a neighbouring room (toRoomId), or out of the house through one of its outside walls (side). Give exactly one of toRoomId or side.",
  input: z.object({ roomId: roomIdSchema, toRoomId: roomIdSchema.optional(), side: sideSchema.optional(), widthM: z.number().min(0.6).max(2.4).optional() }),
  run({ document, idPrefix }, { roomId, toRoomId, side, widthM }) {
    if ((toRoomId === undefined) === (side === undefined)) return fail("invalid", "Give exactly one of toRoomId or side.");
    const found = roomOf(document, roomId);
    if (isFailure(found)) return found;
    const { level, room } = found;
    const width = widthM ?? DOOR_PRESET.width;
    let target: { wall: RoomWall; from: number; to: number } | null = null;
    let label = "outside";
    if (toRoomId !== undefined) {
      const other = roomOf(document, toRoomId);
      if (isFailure(other)) return other;
      if (levelOf(document, toRoomId)?.id !== level.id) return fail("different-floor", "Those rooms are on different floors; doors only join rooms on the same floor.");
      label = other.room.name;
      for (const wall of roomWalls(level, roomId).filter((w) => !w.external)) {
        const stretch = sharedStretch(level, wall, toRoomId);
        if (stretch && (!target || stretch[1] - stretch[0] > target.to - target.from)) target = { wall, from: stretch[0], to: stretch[1] };
      }
      if (!target) return fail("not-adjacent", `${room.name} and ${other.room.name} don't share a wall, so there's nowhere for a door between them.`);
    } else {
      const walls = roomWalls(level, roomId).filter((w) => w.side === side && w.external);
      const wall = walls.sort((p, q) => q.to - q.from - (p.to - p.from))[0];
      if (!wall) return fail("no-outside-wall", `The ${side} side of ${lower(room.name)} isn't an outside wall.`);
      target = { wall, from: wall.from, to: wall.to };
    }
    const spot = placeOpening(level, target.wall.wallId, target.from, target.to, width, room.seed);
    if (!spot) return fail("no-space", `There's no free stretch of wall wide enough for a ${m(width)} m door there.`);
    const result = runAll(document, [{ type: "addOpening", opening: { id: `${idPrefix}door`, wallId: target.wall.wallId, kind: "door", offset: spot.offset, width, height: DOOR_PRESET.height, hinge: "start", swingSide: spot.swingSide } }], idPrefix);
    if (failed(result)) return result;
    return { ok: true, kind: "change", document: result.document, summary: `Added a ${m(width)} m door from ${lower(room.name)} to ${toRoomId ? lower(label) : "outside"}.`, roomIds: toRoomId ? [roomId, toRoomId] : [roomId] };
  },
});

const removeOpening = tool({
  name: "remove_opening",
  description: "Remove a door or window by its id (ids are listed under each room's openings in the plan summary).",
  input: z.object({ openingId: z.string().min(1) }),
  run({ document, idPrefix }, { openingId }) {
    const level = document.levels.find((l) => l.openings[openingId]);
    const opening = level?.openings[openingId];
    if (!level || !opening) return fail("not-found", `There is no door or window with id "${openingId}".`);
    const roomId = Object.keys(level.rooms).find((id) => roomWalls(level, id).some((w) => w.wallId === opening.wallId));
    const result = runAll(document, [{ type: "deleteOpening", openingId }], idPrefix);
    if (failed(result)) return result;
    return { ok: true, kind: "change", document: result.document, summary: `Removed a ${opening.kind}${roomId ? ` from ${lower(level.rooms[roomId].name)}` : ""}.`, roomIds: roomId ? [roomId] : [] };
  },
});

const mergeRooms = tool({
  name: "merge_rooms",
  description: "Knock down the wall between two neighbouring rooms so they become one open space. Fails if the wall also divides other rooms, or is an outside wall.",
  input: z.object({ roomA: roomIdSchema, roomB: roomIdSchema }),
  run({ document, idPrefix }, { roomA, roomB }) {
    const a = roomOf(document, roomA);
    if (isFailure(a)) return a;
    const b = roomOf(document, roomB);
    if (isFailure(b)) return b;
    if (a.level.id !== b.level.id || roomA === roomB) return fail("invalid", "Pick two different rooms on the same floor.");
    const wallIds = [...new Set(roomWalls(a.level, roomA).filter((w) => !w.external && sharedStretch(a.level, w, roomB)).map((w) => w.wallId))];
    if (!wallIds.length) return fail("not-adjacent", `${a.room.name} and ${b.room.name} aren't separated by an inside wall.`);
    const result = runAll(document, wallIds.map((wallId) => ({ type: "deleteWall" as const, wallId })), idPrefix);
    if (failed(result)) return result;
    const after = result.document.levels[levelIndex(result.document, a.level.id)];
    if (Object.keys(after.rooms).length !== Object.keys(a.level.rooms).length - 1) return fail("wall-shared", "That wall also divides other rooms, so taking it out would change more than those two.");
    const survivor = Object.values(after.rooms).find((r) => r.id === roomA || r.id === roomB);
    return { ok: true, kind: "change", document: result.document, summary: `Took out the wall between ${lower(a.room.name)} and ${lower(b.room.name)}; they are now one room${survivor ? ` ("${survivor.name}", ${dimensions(after, survivor.id)})` : ""}.`, roomIds: survivor ? [survivor.id] : [] };
  },
});

const addFloor = tool({
  name: "add_floor",
  description: "Add a new top floor with the same outline as the floor below and no rooms yet. Stairs and rooms for it are not made by this tool. A house has at most three floors.",
  input: z.object({ name: z.string().trim().min(1).max(80).optional() }),
  run({ document, idPrefix }, { name }) {
    const result = runAll(document, [{ type: "addLevel", ...(name ? { name } : {}) }], idPrefix);
    if (failed(result)) return result;
    const index = result.document.levels.length - 1;
    return { ok: true, kind: "change", document: result.document, summary: `Added a new empty ${lower(name ?? storeyName(index))} floor. It has no stairs or rooms yet.`, roomIds: [] };
  },
});

const reportUnsupported = tool({
  name: "report_unsupported",
  description:
    "Record a part of the user's request that none of your other tools can do, so the user is told plainly. Call it once for each part you can't do (colours, materials, a roof, furniture, exact positions, anything outside the tools), instead of pretending or guessing. Do not use it for a tool that failed in a way you can fix by retrying.",
  input: z.object({ request: z.string().min(1).max(200).describe("The part of the request, in the user's words."), reason: z.string().min(1).max(300).describe("Why it can't be done, in plain language.") }),
  run(_context, { request, reason }) {
    return { ok: true, kind: "unsupported", request, reason };
  },
});

export const builtinTools: AgentTool[] = [renameRoom, setRoomType, swapRooms, resizeRoom, improveRoom, addRoom, addWindow, addDoor, removeOpening, mergeRooms, addFloor, reportUnsupported];

export type { ToolContext };
