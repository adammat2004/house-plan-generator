import { applyCommand } from "../commands/apply";
import { pinnedRoomChanges } from "../commands/locks";
import type { PlanCommand } from "../commands/types";
import { furnishRoom } from "../furniture/furnish";
import { deriveLevelGeometry, deriveRoomRegions, openingPlacement, roomFaceIndices } from "../geometry/derive";
import { EPS, roundToPrecision } from "../geometry/numeric";
import { polygonArea } from "../geometry/polygons";
import type { Rect } from "../geometry/vector";
import { DEFAULT_HOUSE } from "../plan/defaults";
import type { Id, Level, PlanDocument, Point2, RoomType } from "../plan/types";
import { gardenWallIds, roomAtPoint } from "./analysis";
import { fitOpening, GARDEN_DOOR, WINDOW_WIDTH, type Run } from "./layoutEmitter";
import type { PlanCandidate, PlanningIssue } from "./planner";
import { floorFor, type SpaceSpec } from "./program";
import { clearMin, proportionOk, ROOM_RULES, SLOT_WALL } from "./roomRules";
import { assessSense, bySense } from "./sense";
import { distributeWidths } from "./wingLayout";

/**
 * "Regenerate selection": the same rooms laid out again inside the space
 * they share, everything else left exactly as it is.
 *
 *     ┌──────── hall ────────┐            ┌──────── hall ────────┐
 *     │ Bed 2 │ Bath │ Bed 3 │    ──►     │ Bath │ Bed 2 │ Bed 3 │
 *     └──────────────────────┘            └──────────────────────┘
 *
 * Band mode: the selected rooms must together fill a rectangle. Its inner
 * walls go, and new ones cut it into the same rooms in another order and at
 * other widths, each within its room rules. Every room gets a door into what
 * it is reached from (the hall or another room across the rectangle's long
 * side, or its neighbour in the row, by the same preferences as the zone
 * planner), windows on outside walls and, for living spaces, garden doors.
 * The front door stays where it is. Options are judged with the plan-sense
 * checker; pinned rooms nearby are never touched.
 */

export interface RegionOptions {
  idPrefix: string;
  count: number;
  doorWidth: number;
  /** Options already offered (their variant keys), to leave out. */
  exclude?: ReadonlySet<string>;
}

type Result = { candidates: PlanCandidate[]; issues: PlanningIssue[] };

const LIVING: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining"]);
const ENTRY: ReadonlySet<RoomType> = new Set(["hall", "living", "kitchen", "kitchen_dining", "dining"]);
/** Most rooms re-ordered at once: every order is tried. */
const MAX_ROOMS = 6;
/** Orders built and judged per request, best by their layout score. */
const MAX_BUILDS = 8;

/** What it costs for `child` to open off `parent`; Infinity when it shouldn't. */
function edgeCost(parent: RoomType, child: RoomType): number {
  if (parent === "hall") return LIVING.has(child) ? 0.5 : 0;
  if (child === "ensuite") return parent === "primary_bedroom" ? 0 : parent === "bedroom" ? 0.5 : Infinity;
  if (parent === "utility") return child === "garage" ? 0.5 : Infinity;
  if (!LIVING.has(parent)) return Infinity;
  if (LIVING.has(child)) return 0;
  if (child === "utility") return parent === "kitchen" || parent === "kitchen_dining" ? 0 : 2;
  if (child === "office") return 1;
  if (child === "wc") return 2;
  return Infinity;
}

const fail = (message: string): Result => ({ candidates: [], issues: [{ code: "does-not-fit", message }] });

export function planRegion(source: PlanDocument, roomIds: readonly Id[], opts: RegionOptions): Result {
  const level = source.levels[0];
  const rooms = roomIds.map((id) => level.rooms[id]);
  if (rooms.some((r) => !r)) return { candidates: [], issues: [{ code: "invalid-source", message: "One of those rooms isn't on this plan any more." }] };
  const pinned = rooms.find((r) => r.locked);
  if (pinned) return { candidates: [], issues: [{ code: "room-pinned", message: `Unpin ${pinned.name} to lay it out again.` }] };
  if (rooms.some((r) => r.type === "hall")) return fail("Leave the hall out: these rooms are laid out again around it.");
  if (rooms.length > MAX_ROOMS) return fail(`Pick up to ${MAX_ROOMS} rooms at a time.`);

  // The selection must fill a rectangle exactly.
  const regions = deriveRoomRegions(level);
  const faceOf = roomFaceIndices(level);
  const faces = rooms.map((r) => regions[faceOf.get(r.id) ?? -1]?.face);
  if (faces.some((f) => !f)) return fail("One of those rooms has no floor.");
  const R: Rect = {
    minX: Math.min(...faces.map((f) => f!.bounds.minX)),
    maxX: Math.max(...faces.map((f) => f!.bounds.maxX)),
    minY: Math.min(...faces.map((f) => f!.bounds.minY)),
    maxY: Math.max(...faces.map((f) => f!.bounds.maxY)),
  };
  const area = faces.reduce((sum, f) => sum + polygonArea(f!.polygon), 0);
  if (Math.abs(area - (R.maxX - R.minX) * (R.maxY - R.minY)) > 0.01) return fail("Pick rooms that together make a rectangle, such as rooms side by side along the hall.");
  const along: "x" | "y" = R.maxX - R.minX >= R.maxY - R.minY ? "x" : "y";
  const [a0, a1] = along === "x" ? [R.minX, R.maxX] : [R.minY, R.maxY];
  const [c0, c1] = along === "x" ? [R.minY, R.maxY] : [R.minX, R.maxX];
  const L = a1 - a0;
  const T = c1 - c0;
  const at = (a: number, c: number): Point2 => (along === "x" ? { x: a, y: c } : { x: c, y: a });

  // Inner walls go; a wall that runs on past the rectangle can't.
  const geometry = deriveLevelGeometry(level);
  const inside = (p: Point2) => p.x >= R.minX - EPS && p.x <= R.maxX + EPS && p.y >= R.minY - EPS && p.y <= R.maxY + EPS;
  const onEdge = (p: Point2) => Math.abs(p.x - R.minX) < EPS || Math.abs(p.x - R.maxX) < EPS || Math.abs(p.y - R.minY) < EPS || Math.abs(p.y - R.maxY) < EPS;
  const inner: Id[] = [];
  for (const [id, axis] of geometry.axes) {
    if (axis.wall.role !== "internal") continue;
    const mid = { x: (axis.start.x + axis.end.x) / 2, y: (axis.start.y + axis.end.y) / 2 };
    const midInside = mid.x > R.minX + EPS && mid.x < R.maxX - EPS && mid.y > R.minY + EPS && mid.y < R.maxY - EPS;
    const lies = axis.orientation === "horizontal" ? mid.y > R.minY + EPS && mid.y < R.maxY - EPS : mid.x > R.minX + EPS && mid.x < R.maxX - EPS;
    if (!midInside || !lies) continue;
    if (!inside(axis.start) || !inside(axis.end)) return fail("A wall inside those rooms carries on into other rooms, so they can't be laid out again on their own.");
    inner.push(id);
  }

  // Openings in the rectangle's edges belong to the selected rooms and are placed again, except the front door.
  const garden = gardenWallIds(level);
  const removed: Id[] = [];
  let front: Point2 | null = null;
  for (const o of Object.values(level.openings)) {
    const place = openingPlacement(geometry, o);
    if (!place || inner.includes(o.wallId)) continue;
    const mid = place.centre;
    if (!onEdge(mid) || !inside(mid)) continue;
    const external = place.axis.wall.role === "external";
    if (o.kind === "door" && external && !garden.has(o.wallId)) {
      front = mid;
      continue;
    }
    // A door into a pinned room next door can't move.
    if (!external) {
      const n = place.axis.normal;
      const out = [1, -1].map((k) => roomAtPoint(level, { x: mid.x + n.x * 0.3 * k, y: mid.y + n.y * 0.3 * k })).find((id) => id && !roomIds.includes(id));
      if (out && level.rooms[out]?.locked) return fail(`${level.rooms[out].name} is pinned and has a door into these rooms. Unpin it, or leave out the room beside it.`);
    }
    removed.push(o.id);
  }

  // What lies across each long side and each end, by position along the rectangle.
  const across = (side: "lo" | "hi", a: number): Id | "outside" | null => {
    const c = side === "lo" ? c0 - 0.3 : c1 + 0.3;
    const p = at(a, c);
    return roomAtPoint(level, p) ?? (isExternalAt(level, at(a, side === "lo" ? c0 : c1)) ? "outside" : null);
  };
  const beyondEnd = (end: "lo" | "hi"): Id | "outside" | null => {
    const a = end === "lo" ? a0 - 0.3 : a1 + 0.3;
    const p = at(a, (c0 + c1) / 2);
    return roomAtPoint(level, p) ?? (isExternalAt(level, at(end === "lo" ? a0 : a1, (c0 + c1) / 2)) ? "outside" : null);
  };
  const isGarden = (p: Point2) => [...garden].some((w) => {
    const axis = geometry.axes.get(w);
    if (!axis) return false;
    return axis.orientation === "horizontal" ? Math.abs(axis.line - p.y) < EPS && p.x >= axis.min - EPS && p.x <= axis.max + EPS : Math.abs(axis.line - p.x) < EPS && p.y >= axis.min - EPS && p.y <= axis.max + EPS;
  });

  const specs: SpaceSpec[] = rooms.map((r, i) => ({
    key: r.id,
    type: r.type,
    name: r.name,
    target: r.targetArea ?? polygonArea(faces[i]!.polygon),
    minWidth: ROOM_RULES[r.type].minWidth + SLOT_WALL,
    zone: ROOM_RULES[r.type].zone,
    window: ROOM_RULES[r.type].window,
    ensuite: false,
  }));
  // The order the rooms are in now, to leave out.
  const centreOf = (i: number) => (along === "x" ? (faces[i]!.bounds.minX + faces[i]!.bounds.maxX) / 2 : (faces[i]!.bounds.minY + faces[i]!.bounds.maxY) / 2);
  const current = specs.map((_, i) => i).sort((p, q) => centreOf(p) - centreOf(q)).map((i) => specs[i].key).join("|");

  interface Plan {
    order: SpaceSpec[];
    cuts: number[];
    parent: Array<{ kind: "slot"; index: number } | { kind: "across"; side: "lo" | "hi" } | { kind: "end"; end: "lo" | "hi" }>;
    score: number;
    variant: string;
  }
  const plans: Plan[] = [];
  for (const order of permutations(specs)) {
    const mins = order.map((s) => Math.max(s.minWidth, clearMin(s.type, T)));
    const cuts = order.length === 1 ? [0, L] : distributeWidths(L, order, mins);
    if (!cuts) continue;
    const slots = order.map((s, i) => ({ s, lo: a0 + cuts[i], hi: a0 + cuts[i + 1] }));
    if (slots.some((x) => !proportionOk(x.s.type, x.hi - x.lo, T))) continue;
    const sequence = order.map((s) => s.key).join("|");
    const variant = `region:${sequence}@${cuts.slice(1, -1).map((c) => c.toFixed(1)).join(",")}`;
    if (sequence === current || opts.exclude?.has(variant)) continue;
    // Who each slot could open into: its neighbours in the row, the rooms across its long sides, and beyond the ends.
    const options = slots.map((x, i) => {
      const mid = (x.lo + x.hi) / 2;
      const out: Array<{ to: Plan["parent"][number]; type: RoomType }> = [];
      for (const j of [i - 1, i + 1]) if (j >= 0 && j < slots.length) out.push({ to: { kind: "slot", index: j }, type: slots[j].s.type });
      for (const side of ["lo", "hi"] as const) {
        const id = across(side, mid);
        if (id && id !== "outside") out.push({ to: { kind: "across", side }, type: level.rooms[id].type });
      }
      for (const [end, k] of [["lo", 0], ["hi", slots.length - 1]] as const) {
        if (i !== k) continue;
        const id = beyondEnd(end);
        if (id && id !== "outside") out.push({ to: { kind: "end", end }, type: level.rooms[id].type });
      }
      return out;
    });
    // A cheapest tree from the rooms around the rectangle.
    const parent: Array<Plan["parent"][number] | null> = slots.map(() => null);
    let cost = 0;
    for (let added = 0; added < slots.length; added++) {
      let pick: { i: number; to: Plan["parent"][number]; c: number } | null = null;
      for (let i = 0; i < slots.length; i++) {
        if (parent[i]) continue;
        for (const o of options[i]) {
          if (o.to.kind === "slot" && !parent[o.to.index]) continue;
          const c = edgeCost(o.type, slots[i].s.type);
          if (Number.isFinite(c) && (!pick || c < pick.c)) pick = { i, to: o.to, c };
        }
      }
      if (!pick) break;
      parent[pick.i] = pick.to;
      cost += pick.c;
    }
    if (parent.some((p) => !p)) continue;
    // Daylight: rooms people live in need an outside wall.
    const outsideAt = (i: number) => {
      const mid = (slots[i].lo + slots[i].hi) / 2;
      return across("lo", mid) === "outside" || across("hi", mid) === "outside" || (i === 0 && beyondEnd("lo") === "outside") || (i === slots.length - 1 && beyondEnd("hi") === "outside");
    };
    if (slots.some((x, i) => ROOM_RULES[x.s.type].habitable && !outsideAt(i))) continue;
    // The front door stays, so the room it opens into must be one a front door can open into.
    if (front) {
      const f = along === "x" ? front.x : front.y;
      const holder = slots.find((x) => f > x.lo - EPS && f < x.hi + EPS);
      if (holder && !ENTRY.has(holder.s.type)) continue;
    }
    let score = cost;
    for (const x of slots) score += Math.abs((x.hi - x.lo) * T - x.s.target) / Math.max(x.s.target, 2);
    plans.push({ order, cuts, parent: parent as Plan["parent"], score, variant });
  }
  if (!plans.length) return fail("I couldn't find another way to lay out those rooms that keeps every room reachable, lit and in proportion.");
  plans.sort((p, q) => p.score - q.score || p.variant.localeCompare(q.variant));

  // Build the best few and keep the ones that make the most sense.
  const built: Array<{ plan: Plan; document: PlanDocument }> = [];
  for (const [n, plan] of plans.slice(0, MAX_BUILDS).entries()) {
    const document = build(source, plan, { R, along, a0, c0, c1, inner, removed, across, isGarden, prefix: `${opts.idPrefix}-${n}`, doorWidth: opts.doorWidth, front });
    if (!document) continue;
    if (pinnedRoomChanges(level, document.levels[0], { furniture: true }).length) continue;
    built.push({ plan, document });
  }
  if (!built.length) return fail("Those rooms can't be laid out again without breaking the walls around them.");
  const judged = built.map((b) => ({ ...b, sense: assessSense(b.document.levels[0]) })).sort((p, q) => bySense(p.sense, q.sense));
  const candidates = judged.slice(0, opts.count).map(({ plan, document }, seed): PlanCandidate => {
    const names = plan.order.map((s) => s.name);
    const changed = Object.values(document.levels[0].rooms).filter((r) => {
      const c = roomAtPoint(document.levels[0], r.seed);
      return c === r.id && inside(r.seed);
    });
    return {
      document,
      summary: `The same rooms in a new order: ${names.join(", ")}.`,
      notes: [],
      seed,
      title: `${names[0]} first`,
      variant: plan.variant,
      changedRoomIds: changed.map((r) => r.id),
    };
  });
  return { candidates, issues: [] };
}

function isExternalAt(level: Level, p: Point2): boolean {
  for (const axis of deriveLevelGeometry(level).axes.values()) {
    if (axis.wall.role !== "external") continue;
    const on = axis.orientation === "horizontal" ? Math.abs(axis.line - p.y) < EPS && p.x >= axis.min - EPS && p.x <= axis.max + EPS : Math.abs(axis.line - p.x) < EPS && p.y >= axis.min - EPS && p.y <= axis.max + EPS;
    if (on) return true;
  }
  return false;
}

interface BuildContext {
  R: Rect;
  along: "x" | "y";
  a0: number;
  c0: number;
  c1: number;
  inner: Id[];
  removed: Id[];
  across: (side: "lo" | "hi", a: number) => Id | "outside" | null;
  isGarden: (p: Point2) => boolean;
  prefix: string;
  doorWidth: number;
  front: Point2 | null;
}

/** Applies one layout of the rectangle: walls, room names, doors, windows and furniture; null if any step is refused. */
function build(source: PlanDocument, plan: { order: SpaceSpec[]; cuts: number[]; parent: Array<{ kind: "slot"; index: number } | { kind: "across"; side: "lo" | "hi" } | { kind: "end"; end: "lo" | "hi" }> }, ctx: BuildContext): PlanDocument | null {
  const { along, a0, c0, c1 } = ctx;
  const at = (a: number, c: number): Point2 => (along === "x" ? { x: roundToPrecision(a), y: roundToPrecision(c) } : { x: roundToPrecision(c), y: roundToPrecision(a) });
  let doc = source;
  const run = (command: PlanCommand): boolean => {
    const result = applyCommand(doc, command);
    if (!result.ok) return false;
    doc = result.document;
    return true;
  };
  for (const id of ctx.removed) if (!run({ type: "deleteOpening", openingId: id })) return null;
  for (const id of ctx.inner) if (doc.levels[0].walls[id] && !run({ type: "deleteWall", wallId: id })) return null;
  const slots = plan.order.map((s, i) => ({ s, lo: a0 + plan.cuts[i], hi: a0 + plan.cuts[i + 1] }));
  for (let i = 1; i < slots.length; i++) {
    if (!run({ type: "addWall", wallId: `${ctx.prefix}-w${i}`, start: at(slots[i].lo, c0), end: at(slots[i].lo, c1), thickness: DEFAULT_HOUSE.internalThickness })) return null;
  }
  // Names and uses, from a point in each slot.
  const ids: Id[] = [];
  for (const x of slots) {
    const roomId = roomAtPoint(doc.levels[0], at((x.lo + x.hi) / 2, (c0 + c1) / 2));
    if (!roomId) return null;
    ids.push(roomId);
    if (!run({ type: "updateRoom", roomId, changes: { name: x.s.name, type: x.s.type, targetArea: x.s.target, floorMaterial: floorFor(x.s.type) } })) return null;
  }
  // Doors into what each room is reached from, near the end of the wall nearer the front door.
  let n = 0;
  const toward = ctx.front ?? at(a0, c0);
  const runAlong = (lo: number, hi: number, c: number, inside: Point2): Run => (along === "x" ? { horizontal: true, line: c, lo, hi, inside } : { horizontal: false, line: c, lo, hi, inside });
  const runAcross = (a: number, inside: Point2): Run => (along === "x" ? { horizontal: false, line: a, lo: c0, hi: c1, inside } : { horizontal: true, line: a, lo: c0, hi: c1, inside });
  for (const [i, x] of slots.entries()) {
    const p = plan.parent[i];
    const mid = (x.lo + x.hi) / 2;
    const centre = at(mid, (c0 + c1) / 2);
    const narrow = x.s.type === "bathroom" || x.s.type === "wc" || x.s.type === "ensuite" || x.s.type === "storage";
    const width = narrow ? Math.min(ctx.doorWidth, 0.8) : ctx.doorWidth;
    let door: Run;
    if (p.kind === "slot") {
      // Each pair of neighbours shares one door, from the child's side.
      const between = p.index < i ? x.lo : x.hi;
      door = runAcross(between, centre);
    } else if (p.kind === "across") door = runAlong(x.lo, x.hi, p.side === "lo" ? c0 : c1, centre);
    else door = runAcross(p.end === "lo" ? a0 : x.hi, centre);
    const opening = fitOpening(doc.levels[0], door, "door", width, 0.3, "standard", `${ctx.prefix}-o${++n}`, toward);
    if (!opening || !run({ type: "addOpening", opening })) return null;
  }
  // Windows on outside walls, and garden doors from living spaces.
  for (const x of slots) {
    const mid = (x.lo + x.hi) / 2;
    const centre = at(mid, (c0 + c1) / 2);
    const outs: Run[] = [];
    for (const side of ["lo", "hi"] as const) if (ctx.across(side, mid) === "outside") outs.push(runAlong(x.lo, x.hi, side === "lo" ? c0 : c1, centre));
    if (!outs.length) continue;
    const garden = outs.find((o) => ctx.isGarden(o.horizontal ? { x: (o.lo + o.hi) / 2, y: o.line } : { x: o.line, y: (o.lo + o.hi) / 2 }));
    if (LIVING.has(x.s.type) && garden && garden.hi - garden.lo >= GARDEN_DOOR + 0.6) {
      const opening = fitOpening(doc.levels[0], garden, "door", GARDEN_DOOR, 0.6, "standard", `${ctx.prefix}-o${++n}`);
      if (opening) run({ type: "addOpening", opening });
    }
    const size = ROOM_RULES[x.s.type].window;
    if (size === "none") continue;
    const lit = [...outs].sort((p, q) => (p === garden && LIVING.has(x.s.type) ? 1 : 0) - (q === garden && LIVING.has(x.s.type) ? 1 : 0));
    const opening = fitOpening(doc.levels[0], lit[0], "window", WINDOW_WIDTH[size], 0.6, size, `${ctx.prefix}-o${++n}`);
    if (opening) run({ type: "addOpening", opening });
  }
  // Furniture laid out again for the new rooms.
  for (const [i, roomId] of ids.entries()) {
    const level = doc.levels[0];
    if (!level.rooms[roomId]) continue;
    const result = furnishRoom(level, roomId, `${ctx.prefix}-f${i}`);
    if (result) run({ type: "replaceFurniture", remove: result.remove, add: result.items });
  }
  return doc;
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
  }
}
