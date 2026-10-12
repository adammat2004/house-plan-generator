import { EPS, roundToPrecision } from "../geometry/numeric";
import { OPPOSITE_SIDE, outlineEdges, type EnvelopeSide, type OutlineEdge } from "../geometry/outline";
import { DEFAULT_PARTITION, partitionOutline, sharedSide, type OutlinePartition } from "../geometry/partition";
import type { Ring } from "../geometry/polygons";
import type { Rect } from "../geometry/vector";
import { annexLayouts, doorwaysOn, type Annex } from "./annexPlanner";
import { DOWN, LIVING, UP } from "./bands";
import { frameOf } from "./zonePlanner";
import type { Program, SpaceSpec } from "./program";
import { ROOM_KINDS, ROOM_RULES } from "./roomRules";
import { planStoreys, type StoreyOptions, type StoreyPlan } from "./storeyPlanner";
import type { LabeledRoom } from "./wingLayout";

/**
 * Two-storey layouts in houses that aren't rectangles. The outline is split
 * into rectangles (`partitionOutline`); one that reaches the street, the
 * "core", is planned as a two-storey rectangle (`planStoreys`), and the
 * others are wings of ground-floor rooms opening off the core's rooms where
 * they meet it (`annexLayouts`).
 *
 * Upstairs covers the core alone (a "setback": the wings are single-storey,
 * under flat roofs), or the whole outline ("full"): over a bay or a notch
 * the rooms beside it grow into it, and over a wing a bedroom that meets it
 * does, or it is a study off the landing. Pure and deterministic.
 */

export type StackKind = "setback" | "full";

export interface StackOptions extends StoreyOptions {
  /** Which kinds of upper floor to offer. */
  kinds: readonly StackKind[];
  /** A core to try first: the part a house sized from the rooms was sized round. */
  prefer?: Rect;
}

interface Stack {
  /** Which partition, which of its cores, and which part of that core: stable, for ids. */
  tag: string;
  core: Rect;
  partition: OutlinePartition;
  /** The other cores, each hanging off the core or a wing nearer it. */
  annexes: Annex[];
}

interface Split {
  core: SpaceSpec[];
  /** Each wing's rooms, in the order of the stack's annexes. */
  annexes: SpaceSpec[][];
  tag: string;
  score: number;
}

/** Most cores tried, and plans kept for each way of dividing the rooms. */
const MAX_STACKS = 8;
/**
 * Widths along the street of the part of a wide core that takes the floor
 * above, m; the rest of the core is a wing. The stairs and a column of rooms
 * beside them need about six; past nine and a half the rooms don't fill it.
 */
const STACK_WIDTHS = [6.5, 7.5, 8.5, 9.5];
const PLANS_PER_SPLIT = 6;
const MAX_SPLITS = 3;
/** The front door needs this much of the hall on the street side, and a room with a window this much outside wall, m. */
const STREET_REACH = 1.2;
const WINDOW_REACH = 1;

const area = (r: Rect) => (r.maxX - r.minX) * (r.maxY - r.minY);
const sameRect = (a: Rect, b: Rect) => Math.abs(a.minX - b.minX) < EPS && Math.abs(a.maxX - b.maxX) < EPS && Math.abs(a.minY - b.minY) < EPS && Math.abs(a.maxY - b.maxY) < EPS;

/** The axis ring of a rectangle, counterclockwise. */
export const rectRing = (r: Rect): Ring => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

/**
 * How much of a rectangle's side facing `side` is outside wall: the outline
 * along it, or just beyond it past a bay.
 */
export function outsideReach(rect: Rect, side: EnvelopeSide, edges: readonly OutlineEdge[]): number {
  const face = side === "north" ? rect.maxY : side === "south" ? rect.minY : side === "east" ? rect.maxX : rect.minX;
  const across = side === "north" || side === "south";
  const [a, b] = across ? [rect.minX, rect.maxX] : [rect.minY, rect.maxY];
  let total = 0;
  for (const e of edges) {
    if (e.facing !== side) continue;
    const beyond = side === "north" || side === "east" ? e.line - face : face - e.line;
    if (beyond < -EPS || beyond > DEFAULT_PARTITION.maxFringe + EPS) continue;
    total += Math.max(0, Math.min(b, e.max) - Math.max(a, e.min));
  }
  return total;
}

const SIDES: readonly EnvelopeSide[] = ["north", "south", "east", "west"];

/** The other cores as wings, each hanging off the core or a wing already placed; null if one hangs off nothing. */
function annexTree(cores: readonly Rect[], root: number): Annex[] | null {
  const placed = [root];
  const out: Annex[] = [];
  while (placed.length < cores.length) {
    let found = false;
    for (let i = 0; i < cores.length && !found; i++) {
      if (placed.includes(i)) continue;
      for (const p of placed) {
        const s = sharedSide(cores[i], cores[p]);
        if (!s) continue;
        const across = s.side === "north" || s.side === "south";
        const [a, b] = [cores[i], cores[p]];
        const lo = roundToPrecision(across ? Math.max(a.minX, b.minX) : Math.max(a.minY, b.minY));
        const hi = roundToPrecision(across ? Math.min(a.maxX, b.maxX) : Math.min(a.maxY, b.maxY));
        out.push({ index: i, rect: a, side: s.side, lo, hi, parent: p === root ? -1 : p });
        placed.push(i);
        found = true;
        break;
      }
    }
    if (!found) return null;
  }
  return out;
}

/** Parts of the outline that could take a floor above, best first: those reaching the street, the preferred one first, then the biggest. */
export function stackCores(ring: Ring, rear: EnvelopeSide, prefer?: Rect): { stacks: Stack[]; problem: string | null } {
  const front = OPPOSITE_SIDE[rear];
  const edges = outlineEdges(ring);
  const parts = partitionOutline(ring, { limit: 8 });
  if (!parts.length) return { stacks: [], problem: "the house can't be split into parts deep enough for rooms." };
  const stacks: Stack[] = [];
  const seen = new Set<string>();
  const add = (tag: string, partition: OutlinePartition, cores: Rect[], ci: number) => {
    const core = cores[ci];
    if (outsideReach(core, front, edges) < STREET_REACH - EPS) return;
    const key = JSON.stringify([core, [...cores].sort((a, b) => a.minY - b.minY || a.minX - b.minX)]);
    if (seen.has(key)) return;
    const annexes = annexTree(cores, ci);
    if (!annexes) return;
    seen.add(key);
    stacks.push({ tag, core, partition, annexes });
  };
  for (const [pi, partition] of parts.entries()) {
    for (const [ci, core] of partition.cores.entries()) {
      add(`${pi}${ci}`, partition, partition.cores, ci);
      // Part of a wide core, at either end along the street, with the rest of it a wing.
      const frame = frameOf(core, rear);
      for (const w of STACK_WIDTHS) {
        if (frame.W - w < DEFAULT_PARTITION.minCore - EPS) continue;
        for (const [end, kept, rest] of [
          ["a", { u0: 0, u1: w, v0: 0, v1: frame.V }, { u0: w, u1: frame.W, v0: 0, v1: frame.V }],
          ["b", { u0: frame.W - w, u1: frame.W, v0: 0, v1: frame.V }, { u0: 0, u1: frame.W - w, v0: 0, v1: frame.V }],
        ] as const) {
          const cores = partition.cores.map((c, i) => (i === ci ? frame.world(kept) : c));
          add(`${pi}${ci}${end}${w * 10}`, partition, [...cores, frame.world(rest)], ci);
        }
      }
    }
  }
  if (!stacks.length) return { stacks, problem: "no part of the house reaches the street to take the stairs." };
  const preferred = (s: Stack) => (prefer && sameRect(s.core, prefer) ? 0 : 1);
  stacks.sort((a, b) => preferred(a) - preferred(b) || area(b.core) - area(a.core) || a.annexes.length - b.annexes.length || a.tag.localeCompare(b.tag));
  return { stacks, problem: null };
}

/** A living room to fill a wing the brief has nothing for. */
const snug = (i: number, size: number): SpaceSpec => ({
  key: `snug${i}`,
  type: "living",
  name: "Snug",
  target: Math.max(ROOM_KINDS.snug.target, roundToPrecision(Math.floor(size * 0.8))),
  minWidth: ROOM_KINDS.snug.minSlot,
  zone: "day",
  window: ROOM_RULES.living.window,
  ensuite: false,
});

/**
 * Ways to divide the downstairs rooms between the core and its wings, best
 * first: the hall's WC and at least one living space stay in the core, and
 * each wing gets rooms that come close to filling it, or none (it extends a
 * living space beside it, or becomes a snug).
 */
export function splitGround(spaces: readonly SpaceSpec[], annexes: readonly Annex[], core: Rect): Split[] {
  const k = annexes.length;
  // Roughly what the core's ground floor has for rooms once the hall and stairs are in.
  const coreRoom = area(core) * 0.72;
  const wc = spaces.find((s) => s.type === "wc");
  const movable = spaces.filter((s) => s !== wc);
  if (movable.length > 8) return [];
  const sizes = annexes.map((a) => area(a.rect));
  const out: Split[] = [];
  const total = (k + 1) ** movable.length;
  for (let code = 0; code < total; code++) {
    // Each movable room's place: the core (0) or a wing (1 to k).
    const where = movable.map((_, i) => Math.floor(code / (k + 1) ** i) % (k + 1));
    const kept = movable.filter((_, i) => where[i] === 0);
    if (!kept.some((s) => LIVING.has(s.type))) continue;
    const wings = annexes.map((_, w) => movable.filter((__, i) => where[i] === w + 1));
    // The core's ground floor full, but not overfull, with what it keeps.
    let score = Math.abs(1 - ([...kept, ...(wc ? [wc] : [])].reduce((sum, s) => sum + s.target, 0) * 1.15) / coreRoom);
    let ok = true;
    for (const [w, list] of wings.entries()) {
      if (!list.length) {
        score += 0.8;
        continue;
      }
      const need = list.reduce((sum, s) => sum + s.target, 0) * 1.15;
      const ratio = need / sizes[w];
      if (ratio < 0.5 || ratio > 1.5) {
        ok = false;
        break;
      }
      score += Math.abs(1 - ratio);
    }
    if (!ok) continue;
    out.push({ core: [...kept, ...(wc ? [wc] : [])], annexes: wings, tag: where.map((w) => (w ? String(w - 1) : "c")).join(""), score });
  }
  out.sort((a, b) => a.score - b.score || a.tag.localeCompare(b.tag));
  // Every room in the core, the wings extending it, is always worth a try.
  const all = out.find((x) => x.annexes.every((list) => !list.length));
  const best = out.slice(0, MAX_SPLITS);
  return all && !best.includes(all) ? [...best.slice(0, MAX_SPLITS - 1), all] : best;
}

/** Whether every room downstairs that wants a window keeps enough outside wall for one. */
function lit(rooms: readonly LabeledRoom[], edges: readonly OutlineEdge[]): boolean {
  return rooms.every((r) => r.kind !== "room" || r.window === "none" || r.rects.reduce((sum, q) => sum + SIDES.reduce((s, side) => s + outsideReach(q, side, edges), 0), 0) >= WINDOW_REACH - EPS);
}

/** How far a room opens into a wing it extends: wide enough to read as one space, m. */
const EXTEND_OPENING = 2.4;
/** The most a wing adds to the room it extends, against the room's own target area. */
const EXTEND_SHARE = 1.2;
const BEDROOMS: ReadonlySet<string> = new Set(["primary_bedroom", "bedroom"]);

/** A study to fill a wing upstairs the bedrooms don't. */
const study = (i: number, size: number): SpaceSpec => ({
  key: `study${i}`,
  type: "office",
  name: "Study",
  target: Math.max(ROOM_KINDS.office.target, roundToPrecision(Math.floor(size * 0.8))),
  minWidth: ROOM_KINDS.office.minSlot,
  zone: "night",
  window: ROOM_RULES.office.window,
  ensuite: false,
});

/**
 * The core's first floor with the wings built up too: each wing extends a
 * bedroom that meets it widely, the master first, or is a study off the
 * landing. Null if a wing can be neither.
 */
function withUpperAnnexes(plan: StoreyPlan, stack: Stack, door: number): { rooms: LabeledRoom[]; score: number; tag: string; notes: string[] } | null {
  let rooms = [...plan.upper.rooms];
  let score = 0;
  let tag = "";
  const notes: string[] = [];
  const extended = new Set<string>();
  for (const [i, annex] of stack.annexes.entries()) {
    const doorways = doorwaysOn(annex, rooms, [plan.stairs.rect]);
    const fits = (key: string) => {
      const room = rooms.find((r) => r.key === key);
      return !!room?.target && !extended.has(key) && area(annex.rect) <= room.target * EXTEND_SHARE + EPS;
    };
    const open = doorways
      .filter((d) => d.from !== "hall" && BEDROOMS.has(d.from.type) && d.hi - d.lo >= EXTEND_OPENING - EPS && fits(d.from.key))
      .sort((a, b) => Number(a.from !== "hall" && a.from.type !== "primary_bedroom") - Number(b.from !== "hall" && b.from.type !== "primary_bedroom") || b.hi - b.lo - (a.hi - a.lo))[0];
    if (open && open.from !== "hall") {
      const key = open.from.key;
      extended.add(key);
      rooms = rooms.map((r) => (r.key === key ? { ...r, rects: [...r.rects, annex.rect], target: undefined } : r));
      score += 0.4;
      tag += "e";
      continue;
    }
    const best = annexLayouts(annex, [study(i, area(annex.rect))], doorways.filter((d) => d.from === "hall"), UP, { doorWidth: door })[0];
    if (!best) return null;
    if (!notes.length) notes.push("A wing upstairs the bedrooms don't fill is a study.");
    rooms = [...rooms, ...best.rooms];
    score += 0.5 + area(annex.rect) / 40 + best.score;
    tag += best.tag;
  }
  return { rooms, score, tag, notes };
}

/**
 * The core's ground floor with the wings filled in, each opening off what
 * it meets; a wing with no rooms of its own extends the living space that
 * meets it most, or else is a snug. Null if a wing can't be reached.
 */
function withAnnexes(plan: StoreyPlan, stack: Stack, split: Split, door: number): { rooms: LabeledRoom[]; score: number; tag: string; notes: string[] } | null {
  let rooms = [...plan.ground.rooms];
  let score = 0;
  let tag = "";
  const notes: string[] = [];
  const extended = new Set<string>();
  for (const [i, annex] of stack.annexes.entries()) {
    const doorways = doorwaysOn(annex, rooms, [plan.stairs.rect]);
    if (!split.annexes[i].length) {
      // A living space that meets it widely, hasn't been extended yet, and wouldn't grow out of all proportion.
      const fits = (key: string) => {
        const room = rooms.find((r) => r.key === key);
        return !!room?.target && !extended.has(key) && area(annex.rect) <= room.target * EXTEND_SHARE + EPS;
      };
      const open = doorways.filter((d) => d.from !== "hall" && LIVING.has(d.from.type) && d.hi - d.lo >= EXTEND_OPENING - EPS && fits(d.from.key)).sort((a, b) => b.hi - b.lo - (a.hi - a.lo))[0];
      if (open && open.from !== "hall") {
        const key = open.from.key;
        extended.add(key);
        rooms = rooms.map((r) => (r.key === key ? { ...r, rects: [...r.rects, annex.rect], target: undefined } : r));
        score += 0.3;
        tag += "e";
        continue;
      }
    }
    const spaces = split.annexes[i].length ? split.annexes[i] : [snug(i, area(annex.rect))];
    const best = annexLayouts(annex, spaces, doorways, DOWN, { doorWidth: door })[0];
    if (!best) return null;
    if (!split.annexes[i].length) {
      // Rooms the brief didn't ask for weigh by how much of the house they take.
      score += 0.5 + area(annex.rect) / 40;
      if (!notes.length) notes.push("A wing the rooms don't fill is a snug.");
    }
    rooms = [...rooms, ...best.rooms];
    score += best.score;
    tag += best.tag;
  }
  return { rooms, score, tag, notes };
}

/**
 * Two-storey layouts for a right-angle outline (its wall centrelines), best
 * first, with why not when there are none.
 */
export function planStacks(ring: Ring, ground: Program, upper: Program, opts: StackOptions): { plans: StoreyPlan[]; problem: string | null } {
  const { stacks, problem: none } = stackCores(ring, opts.rearSide, opts.prefer);
  if (!stacks.length) return { plans: [], problem: none };
  const edges = outlineEdges(ring);
  const front = OPPOSITE_SIDE[opts.rearSide];
  const plans: StoreyPlan[] = [];
  // Why not: what ruled out plans that were found, else that the rooms don't fit the biggest part that could take a floor.
  let problem: string | null = null;
  const biggest = stacks.reduce((a, b) => (area(b.core) > area(a.core) ? b : a)).core;
  const size = (v: number) => roundToPrecision(Math.round((v + opts.externalThickness) * 10) / 10);
  const tooSmall = `the stairs and the bedrooms over them don't fit the biggest part of the house that reaches the street, ${size(biggest.maxX - biggest.minX)} × ${size(biggest.maxY - biggest.minY)} m.`;
  for (const stack of stacks.slice(0, MAX_STACKS)) {
    const kinds = opts.kinds;
    if (!kinds.length) continue;
    const splits: Split[] = stack.annexes.length ? splitGround(ground.spaces, stack.annexes, stack.core) : [{ core: ground.spaces, annexes: [], tag: "", score: 0 }];
    if (!splits.length) problem = "the downstairs rooms don't divide between the main part of the house and its wings.";
    for (const split of splits) {
      const planned = planStoreys(stack.core, { ...ground, spaces: split.core }, upper, opts);
      let kept = 0;
      for (const plan of planned.plans) {
        if (kept >= PLANS_PER_SPLIT) break;
        const hall = plan.ground.rooms.find((r) => r.kind === "hall");
        if (!hall?.rects.some((q) => outsideReach(q, front, edges) >= STREET_REACH - EPS)) {
          problem = "the hall doesn't reach the street from the part of the house with a floor above.";
          continue;
        }
        const filled = withAnnexes(plan, stack, split, opts.doorWidth);
        if (!filled) {
          problem = "the rooms in the wing can't open off the rooms beside it.";
          continue;
        }
        if (!lit(filled.rooms, edges)) {
          problem = "the wings would leave rooms in the main part of the house without windows.";
          continue;
        }
        kept++;
        for (const kind of kinds) {
          // Over the wings too: they're built up, and the rooms beside them upstairs keep their windows.
          const above = kind === "full" && stack.annexes.length ? withUpperAnnexes(plan, stack, opts.doorWidth) : null;
          if (kind === "full" && stack.annexes.length && (!above || !lit(above.rooms, edges))) continue;
          const tag = `${kind === "setback" ? "s" : "w"}${stack.tag}-${split.tag}${filled.tag}${above ? `u${above.tag}` : ""}`;
          const id = plan.id.replace(/^(storeys-[lrab])\./, `$1.${tag}.`);
          plans.push({
            ...plan,
            id,
            ground: { ...plan.ground, id: `${id}.g`, rooms: filled.rooms, fringe: stack.partition.fringe, notes: [...filled.notes, ...(above?.notes ?? [])] },
            upper: kind === "full" ? { ...plan.upper, id: `${id}.u`, rooms: above?.rooms ?? plan.upper.rooms, fringe: stack.partition.fringe } : { ...plan.upper, id: `${id}.u` },
            ...(kind === "setback" ? { upperAxis: rectRing(stack.core) } : {}),
            stack: kind,
            core: stack.tag,
            wings: stack.annexes.length,
            main: stack.core,
            score: plan.score + filled.score + split.score + (above?.score ?? 0),
          });
        }
      }
    }
  }
  plans.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return { plans, problem: plans.length ? null : (problem ?? tooSmall) };
}
