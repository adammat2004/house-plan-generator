import { applyCommand } from "../commands/apply";
import type { PlanCommand } from "../commands/types";
import { levelKeepOut, type KeepOut } from "../geometry/stairs";
import type { Rect } from "../geometry/vector";
import { groundLevel, levelById } from "../plan/levels";
import type { Furniture, FurnitureKind, FurnitureRotation, Id, Level, PlanDocument, Point2, RoomType } from "../plan/types";
import { FURNITURE_CATALOG } from "./catalog";
import { backDirection, rectOverlapArea, rotationFacing } from "./geometry";
import {
  best,
  fits,
  freeSpots,
  furnitureInRoom,
  occupy,
  roomContext,
  wallSpots,
  type Placement,
  type RoomContext,
  type RoomEdge,
  type SizeOverride,
  type WallSpot,
} from "./layout";

/**
 * Lays out furniture for a room from its type: beds against a wall away
 * from the door, sofas facing a TV, kitchen units along the longest wall,
 * and so on. Rule-based and deterministic, like the layout planner; every
 * piece is placed on the floor, clear of door swings and other pieces.
 */

export interface FurnishResult {
  /** Items to add. */
  items: Furniture[];
  /** Items already in the room that the new layout replaces. */
  remove: Id[];
  /** Pieces the room needs but has no space for. */
  missing: FurnitureKind[];
}

export interface FurnishOptions {
  /** Keep what is already in the room and add around it. */
  keepExisting?: boolean;
  /** Stairs on the floor (`levelKeepOut`), kept clear. */
  keepOut?: KeepOut;
  /** A different but still valid arrangement for each number; 0 (the default) is the usual layout. */
  seed?: number;
}

/** Where along a wall face an item stands. */
const alongOf = (p: Placement, edge: RoomEdge) => (edge.horizontal ? p.position.x : p.position.y);
const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (r: Rect): Point2 => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 });

/** A repeatable number in [0, 1) from a seed and a spot, to vary which of several good spots wins. */
function noise(seed: number, key: string): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** How far a seed may move a spot's score: enough to reorder good spots, not to override a door rule. */
const SEED_SPREAD = 1.4;

/** Placement helper for one room: remembers what it placed so later pieces keep clear. */
export class Layout {
  readonly placed: Placement[] = [];
  readonly missing: FurnitureKind[] = [];

  constructor(
    readonly ctx: RoomContext,
    readonly seed = 0,
  ) {}

  private varied<T extends Placement>(kind: FurnitureKind, score: (item: T) => number): (item: T) => number {
    if (!this.seed) return score;
    return (item) => score(item) + SEED_SPREAD * noise(this.seed, `${kind}:${item.position.x}:${item.position.y}:${item.rotation}:${item.width}`);
  }

  add<T extends Placement>(p: T | null, kind?: FurnitureKind): T | null {
    if (!p) {
      if (kind) this.missing.push(kind);
      return null;
    }
    occupy(this.ctx, p);
    this.placed.push(p);
    return p;
  }

  /** The best spot against a wall, or null. */
  wall(kind: FurnitureKind, score: (s: WallSpot) => number, size?: SizeOverride): WallSpot | null {
    return best(wallSpots(this.ctx, kind, size), this.varied(kind, score));
  }

  /** The best spot against a wall over several widths. */
  wallSized(kind: FurnitureKind, widths: number[], score: (s: WallSpot) => number): WallSpot | null {
    return best(
      widths.flatMap((width) => wallSpots(this.ctx, kind, { width })),
      this.varied(kind, score),
    );
  }

  free(kind: FurnitureKind, rotations: FurnitureRotation[], score: (p: Placement) => number, size?: SizeOverride): Placement | null {
    return best(freeSpots(this.ctx, kind, rotations, size), this.varied(kind, score));
  }

  /** Places an item at an exact spot if it fits there. */
  at(kind: FurnitureKind, position: Point2, rotation: FurnitureRotation, size: SizeOverride = {}): Placement | null {
    const spec = FURNITURE_CATALOG[kind];
    const p = { kind, position, rotation, width: size.width ?? spec.width, depth: size.depth ?? spec.depth, height: spec.height };
    return fits(this.ctx, p) ? p : null;
  }

  windowOn(edge: RoomEdge): boolean {
    const strip: Rect = edge.horizontal
      ? { minX: edge.from, maxX: edge.to, minY: edge.line - 0.05, maxY: edge.line + 0.05 }
      : { minX: edge.line - 0.05, maxX: edge.line + 0.05, minY: edge.from, maxY: edge.to };
    return this.ctx.windows.some((w) => rectOverlapArea(strip, w.rect) > 1e-4);
  }
}

const doorPenalty = (s: WallSpot, weight = 3) => (s.edge.hasDoor ? -weight : 0);
const length = (e: RoomEdge) => e.to - e.from;

/** Room on both sides of an item along its wall, for bedside tables and the like. */
const sideRoom = (s: WallSpot) => Math.min(alongOf(s, s.edge) - s.width / 2 - s.edge.from, s.edge.to - alongOf(s, s.edge) - s.width / 2);

function bedroom(l: Layout, primary: boolean) {
  const area = l.ctx.area;
  const beds: FurnitureKind[] = primary ? ["bed_king", "bed_double", "bed_single"] : area >= 9 ? ["bed_double", "bed_single"] : ["bed_single", "bed_double"];
  let bed: WallSpot | null = null;
  for (const kind of beds) {
    bed = l.wall(kind, (s) => doorPenalty(s) - s.offCentre * 0.4 + (sideRoom(s) >= 0.5 ? 1.5 : 0) + (l.windowOn(s.edge) ? -0.5 : 0));
    if (bed) break;
  }
  l.add(bed, beds[0]);
  if (bed) {
    const back = backDirection(bed.rotation);
    const along = bed.edge.horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const table = FURNITURE_CATALOG.bedside_table;
    for (const side of [-1, 1]) {
      const offset = bed.width / 2 + table.width / 2 + 0.03;
      const shift = (bed.depth - table.depth) / 2;
      const position = {
        x: bed.position.x + along.x * side * offset + back.x * shift,
        y: bed.position.y + along.y * side * offset + back.y * shift,
      };
      l.add(l.at("bedside_table", position, bed.rotation));
    }
  }
  l.add(
    l.wallSized("wardrobe", primary ? [2.4, 1.8, 1.2] : [1.8, 1.2, 0.9], (s) => s.width * 1.5 + (s.flush ? 1 : 0) + doorPenalty(s, 0.5)),
    "wardrobe",
  );
  if (primary || area >= 12) l.add(l.wall("chest_of_drawers", (s) => (s.flush ? 0.5 : 0) + doorPenalty(s, 1)));
  if (!primary && area >= 13) l.add(l.wall("desk", (s) => (l.windowOn(s.edge) ? 2 : 0) + doorPenalty(s, 1)));
}

function living(l: Layout) {
  const sofaScore = (s: WallSpot) => doorPenalty(s) - s.offCentre * 0.3 + length(s.edge) * 0.1 + (l.windowOn(s.edge) ? -0.5 : 0);
  const sofa = l.wall("sofa_3", sofaScore) ?? l.wall("sofa_2", sofaScore);
  l.add(sofa, "sofa_3");
  if (!sofa) return;
  const back = backDirection(sofa.rotation);
  const along = sofa.edge.horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const table = FURNITURE_CATALOG.coffee_table;
  const reach = sofa.depth / 2 + 0.4 + table.depth / 2;
  const tablePos = { x: sofa.position.x - back.x * reach, y: sofa.position.y - back.y * reach };
  const coffee = l.add(l.at("coffee_table", tablePos, sofa.rotation));
  // A TV on the wall facing the sofa.
  const sofaAlong = alongOf(sofa, sofa.edge);
  l.add(
    l.wall("tv_unit", (s) => {
      const facing = s.edge.normal.x === -back.x && s.edge.normal.y === -back.y;
      return (facing ? 4 : 0) - Math.abs(alongOf(s, s.edge) - sofaAlong) + doorPenalty(s, 1);
    }),
  );
  // An armchair at one end of the coffee table, turned towards it.
  if (coffee) {
    const chair = FURNITURE_CATALOG.armchair;
    for (const side of [1, -1]) {
      const offset = table.width / 2 + 0.4 + chair.depth / 2;
      const position = { x: coffee.position.x + along.x * side * offset, y: coffee.position.y + along.y * side * offset };
      const placed = l.add(l.at("armchair", position, rotationFacing({ x: along.x * side, y: along.y * side })));
      if (placed) break;
    }
  }
  if (l.ctx.area >= 18) l.add(l.wall("bookcase", (s) => (s.flush ? 1 : 0) + doorPenalty(s, 1)));
  if (l.ctx.area >= 14) plant(l);
}

function plant(l: Layout) {
  const b = l.ctx.bounds;
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  l.add(l.free("plant", [0], (p) => -Math.min(...corners.map((c) => dist(c, p.position)))));
}

/** Kitchen units along the best wall, and a fridge at one end. Returns the units. */
export function kitchenRun(l: Layout): WallSpot | null {
  const run = l.wallSized("kitchen_run", [4.2, 3.6, 3, 2.4, 1.8, 1.2], (s) => s.width * 1.2 + doorPenalty(s, 2) + (s.flush ? 0.5 : 0));
  l.add(run, "kitchen_run");
  if (run) {
    const ends = [-1, 1].map((side) => {
      const a = alongOf(run, run.edge) + side * (run.width / 2);
      return run.edge.horizontal ? { x: a, y: run.position.y } : { x: run.position.x, y: a };
    });
    l.add(l.wall("fridge", (s) => -Math.min(...ends.map((e) => dist(e, s.position))) + doorPenalty(s, 1)));
  }
  return run;
}

/** An island parallel to the units, a comfortable walk in front of them. */
export function islandSpot(l: Layout, run: Placement | null, size?: SizeOverride): Placement | null {
  if (!run) return l.free("kitchen_island", [0, 90], (p) => -dist(p.position, centre(l.ctx.bounds)), size);
  const back = backDirection(run.rotation);
  const rotation = run.rotation === 90 || run.rotation === 270 ? 90 : 0;
  const depth = size?.depth ?? FURNITURE_CATALOG.kitchen_island.depth;
  const target = 1.1 + run.depth / 2 + depth / 2;
  const ideal = { x: run.position.x - back.x * target, y: run.position.y - back.y * target };
  return l.free("kitchen_island", [rotation], (p) => -dist(p.position, ideal), size);
}

export function diningSet(l: Layout, awayFrom: Placement | null) {
  const middle = centre(l.ctx.bounds);
  const score = (p: Placement) => (awayFrom ? dist(p.position, awayFrom.position) * 0.6 : 0) - dist(p.position, middle) * 0.5;
  const set = l.free("dining_set_6", [0, 90], score) ?? l.free("dining_set_4", [0, 90], score);
  return l.add(set, "dining_set_4");
}

function kitchen(l: Layout, dining: boolean) {
  const run = kitchenRun(l);
  if (dining) diningSet(l, run);
  else if (l.ctx.area >= 15) l.add(islandSpot(l, run));
  if (dining && l.ctx.area >= 26) l.add(islandSpot(l, run));
}

function diningRoom(l: Layout) {
  diningSet(l, null);
  l.add(l.wall("sideboard", (s) => -s.offCentre * 0.2 + doorPenalty(s, 2)));
  if (l.ctx.area >= 14) plant(l);
}

function bathroom(l: Layout, kinds: "bathroom" | "ensuite" | "wc") {
  if (kinds === "bathroom") {
    const bath = l.wall("bath", (s) => (s.flush ? 2 : 0) + doorPenalty(s) - (length(s.edge) - s.width) * 0.2);
    l.add(bath);
    if (!bath || l.ctx.area >= 7) l.add(l.wall("shower", (s) => (s.flush ? 2 : 0) + doorPenalty(s)), bath ? undefined : "bath");
  } else if (kinds === "ensuite") {
    l.add(l.wall("shower", (s) => (s.flush ? 2 : 0) + doorPenalty(s)), "shower");
  }
  l.add(l.wall("toilet", (s) => doorPenalty(s, 1) + (s.flush ? -0.5 : 0) - s.offCentre * 0.1), "toilet");
  l.add(l.wall("basin", (s) => doorPenalty(s, 0.5) + (l.windowOn(s.edge) ? -0.3 : 0)), "basin");
}

function utility(l: Layout) {
  const washer = l.add(l.wall("washing_machine", (s) => (s.flush ? 1 : 0) + doorPenalty(s, 1)), "washing_machine");
  l.add(l.wallSized("worktop", [1.8, 1.2, 0.6], (s) => s.width + (washer && s.edge === washer.edge ? 1 : 0) + doorPenalty(s, 1)));
  if (l.ctx.area >= 5) l.add(l.wall("shelving", (s) => (s.flush ? 1 : 0) + doorPenalty(s, 1)));
}

function office(l: Layout) {
  l.add(l.wall("desk", (s) => (l.windowOn(s.edge) ? 2 : 0) + doorPenalty(s, 1) - s.offCentre * 0.1), "desk");
  l.add(l.wall("bookcase", (s) => (s.flush ? 1 : 0) + doorPenalty(s, 1)));
  if (l.ctx.area >= 10) l.add(l.free("armchair", [0, 90, 180, 270], (p) => -dist(p.position, centre(l.ctx.bounds)) * 0.2));
}

function storage(l: Layout) {
  for (let i = 0; i < 3; i++) {
    const shelf = l.wallSized("shelving", [2, 1.5, 1, 0.6], (s) => s.width + doorPenalty(s, 1));
    if (!l.add(shelf)) break;
  }
}

function garage(l: Layout) {
  const middle = centre(l.ctx.bounds);
  l.add(l.free("car", [0, 90], (p) => -dist(p.position, middle)), "car");
  l.add(l.wallSized("shelving", [2, 1, 0.6], (s) => s.width + doorPenalty(s, 1)));
  l.add(l.wallSized("worktop", [1.8, 1.2], (s) => s.width + doorPenalty(s, 1)));
}

const RECIPES: Partial<Record<RoomType, (l: Layout) => void>> = {
  living,
  kitchen: (l) => kitchen(l, false),
  kitchen_dining: (l) => kitchen(l, true),
  dining: diningRoom,
  bedroom: (l) => bedroom(l, false),
  primary_bedroom: (l) => bedroom(l, true),
  bathroom: (l) => bathroom(l, "bathroom"),
  ensuite: (l) => bathroom(l, "ensuite"),
  wc: (l) => bathroom(l, "wc"),
  utility,
  office,
  storage,
  garage,
};

/** Whether furnishing a room of this type places anything. */
export const canFurnish = (type: RoomType) => !!RECIPES[type];

export const toFurniture = (p: Placement, id: Id): Furniture => ({
  id,
  kind: p.kind,
  position: p.position,
  rotation: p.rotation,
  width: p.width,
  depth: p.depth,
  height: p.height,
});

/** A layout for one room. Null when the room isn't on the plan. */
export function furnishRoom(level: Level, roomId: Id, idPrefix: string, options: FurnishOptions = {}): FurnishResult | null {
  const room = level.rooms[roomId];
  if (!room) return null;
  const existing = furnitureInRoom(level, roomId).map((f) => f.id);
  const ctx = roomContext(level, roomId, options.keepExisting ? new Set() : new Set(existing), options.keepOut);
  if (!ctx) return null;
  const layout = new Layout(ctx, options.seed ?? 0);
  RECIPES[room.type]?.(layout);
  return {
    items: layout.placed.map((p, i) => toFurniture(p, `${idPrefix}-f${i + 1}`)),
    remove: options.keepExisting ? [] : existing,
    missing: layout.missing,
  };
}

/** Runs a room-planning step with a Layout, for callers that add one kind of piece. */
export function withLayout<T>(level: Level, roomId: Id, run: (l: Layout) => T): T | null {
  const ctx = roomContext(level, roomId);
  return ctx ? run(new Layout(ctx)) : null;
}

/**
 * Furnishes every room of a floor (the ground floor by default) as one
 * command, keeping clear of the stairs. Rooms that already hold furniture are
 * left as they are unless `replace`; pinned rooms always are.
 */
export function furnishPlanCommand(document: PlanDocument, idPrefix: string, replace = false, levelId?: Id, seed = 0): PlanCommand | null {
  const level = (levelId && levelById(document, levelId)) || groundLevel(document);
  const keepOut = levelKeepOut(document, level.id);
  const remove: Id[] = [];
  const add: Furniture[] = [];
  for (const room of Object.values(level.rooms)) {
    if (!canFurnish(room.type) || room.locked) continue;
    if (!replace && furnitureInRoom(level, room.id).length) continue;
    const result = furnishRoom(level, room.id, `${idPrefix}-${room.id}`, { keepOut, seed });
    if (!result) continue;
    remove.push(...result.remove);
    add.push(...result.items);
  }
  if (!remove.length && !add.length) return null;
  return document.levels.length > 1 ? { type: "replaceFurniture", levelId: level.id, remove, add } : { type: "replaceFurniture", remove, add };
}

/** The plan with every room on every floor furnished; a floor stays as it was if that fails. */
export function furnishPlan(document: PlanDocument, idPrefix: string): PlanDocument {
  let doc = document;
  for (const level of document.levels) {
    const command = furnishPlanCommand(doc, idPrefix, false, level.id);
    if (!command) continue;
    const result = applyCommand(doc, command);
    if (result.ok) doc = result.document;
  }
  return doc;
}
