import { EPS, roundToPrecision } from "../geometry/numeric";
import { OPPOSITE_SIDE, type EnvelopeSide } from "../geometry/outline";
import type { Rect } from "../geometry/vector";
import { bandOf, LIVING, type BandRules, type Contact, type Parent } from "./bands";
import type { SpaceSpec } from "./program";
import type { LabeledRoom } from "./wingLayout";
import { frameOf, type Frame, type Placed } from "./zonePlanner";

/**
 * Wings beside the part of a house that has a floor above: rectangles of
 * the outline (from `partitionOutline`) filled with rooms that open off the
 * rooms already placed where the wing meets them, the hall or a living
 * space. Pure and deterministic; coordinates are wall centrelines.
 *
 *            garden
 *     ┌─────────┬────────┐
 *     │ Kitchen │ Util.  │   the wing: a band of rooms along the junction
 *     ├──door───┴────────┤ ← the junction with the part below the floor above
 *     │ Living   │ Hall  │
 *     └──────────┴───────┘
 *            street
 */

export interface Annex {
  /** Its index among the partition's cores. */
  index: number;
  rect: Rect;
  /** The side of the wing that meets what it hangs off. */
  side: EnvelopeSide;
  /** The stretch they share, along that side, in plan. */
  lo: number;
  hi: number;
  /** The core it hangs off: the stacked one (-1) or another wing (its core index). */
  parent: number;
}

/** A stretch of the junction where a room on the other side meets the wing, along the junction in plan. */
export interface Doorway {
  from: "hall" | Parent;
  lo: number;
  hi: number;
}

export interface AnnexLayout {
  tag: string;
  rooms: LabeledRoom[];
  score: number;
}

/** A door swings about this far from its wall; doors through the junction keep this far from the stairs. */
const STAIR_REACH = 1;

const horizontalSide = (side: EnvelopeSide) => side === "north" || side === "south";

/** Where the wing's junction runs: the line it lies on. */
function junctionLine(annex: Annex): number {
  const r = annex.rect;
  return annex.side === "north" ? r.maxY : annex.side === "south" ? r.minY : annex.side === "east" ? r.maxX : r.minX;
}

/**
 * The stretches of the wing's junction each room on the other side meets,
 * clear of the stairs where they climb within a door's swing of it.
 */
export function doorwaysOn(annex: Annex, rooms: readonly LabeledRoom[], stairs: readonly Rect[] = []): Doorway[] {
  const line = junctionLine(annex);
  const across = horizontalSide(annex.side);
  const out: Doorway[] = [];
  for (const room of rooms) {
    for (const q of room.rects) {
      // The room's side that lies on the junction, from the other side.
      const edge = annex.side === "north" ? q.minY : annex.side === "south" ? q.maxY : annex.side === "east" ? q.minX : q.maxX;
      if (Math.abs(edge - line) > EPS) continue;
      const [a, b] = across ? [q.minX, q.maxX] : [q.minY, q.maxY];
      let pieces: Array<[number, number]> = [[Math.max(a, annex.lo), Math.min(b, annex.hi)]];
      if (room.kind === "hall") {
        for (const s of stairs) {
          const [near0, near1] = across ? [s.minY, s.maxY] : [s.minX, s.maxX];
          const gap = line < near0 ? near0 - line : line > near1 ? line - near1 : 0;
          if (gap >= STAIR_REACH) continue;
          const [c, d] = across ? [s.minX - 0.05, s.maxX + 0.05] : [s.minY - 0.05, s.maxY + 0.05];
          pieces = pieces.flatMap(([x0, x1]): Array<[number, number]> => (d <= x0 || c >= x1 ? [[x0, x1]] : [[x0, Math.min(x1, c)], [Math.max(x0, d), x1]]));
        }
      }
      const from: Doorway["from"] = room.kind === "hall" ? "hall" : { key: room.key, type: room.type };
      for (const [lo, hi] of pieces) if (hi - lo > EPS) out.push({ from, lo: roundToPrecision(lo), hi: roundToPrecision(hi) });
    }
  }
  return out;
}

/** The frame for a wing with u running away from its junction, for each side the junction is on. */
const ROW_REAR: Record<EnvelopeSide, EnvelopeSide> = { west: "north", east: "south", north: "east", south: "west" };

/** Along the junction in plan, as u in a frame whose v starts at the junction. */
function spanIn(frame: Frame, annex: Annex, lo: number, hi: number): [number, number] {
  const line = junctionLine(annex);
  const p = horizontalSide(annex.side) ? [{ x: lo, y: line }, { x: hi, y: line }] : [{ x: line, y: lo }, { x: line, y: hi }];
  const [u0, u1] = p.map((q) => frame.local(q).u);
  return [roundToPrecision(Math.min(u0, u1)), roundToPrecision(Math.max(u0, u1))];
}

function labelled(frame: Frame, p: Placed): LabeledRoom {
  return {
    key: p.key,
    kind: p.kind,
    name: p.name,
    type: p.type,
    ...(p.target !== undefined && p.kind !== "storage" ? { target: p.target } : {}),
    window: p.window,
    rects: [frame.world(p.box)],
    ...(p.via !== "hall" || p.kind === "ensuite" ? { via: p.via } : {}),
    ...(p.of ? { of: p.of } : {}),
    // Living spaces in a wing open to the garden where the wing reaches it.
    ...(LIVING.has(p.type) ? { gardenDoor: true } : {}),
  };
}

/**
 * Ways to fill a wing with its rooms, best first: side by side along the
 * junction, each with a door through it ("band"), or one after another away
 * from it, the first opening through the junction and the rest off the room
 * before ("row"). Empty if neither works.
 */
export function annexLayouts(annex: Annex, spaces: SpaceSpec[], doorways: readonly Doorway[], rules: BandRules, opts: { doorWidth: number }): AnnexLayout[] {
  const door = opts.doorWidth;
  const out: AnnexLayout[] = [];
  // Side by side along the junction.
  const band = frameOf(annex.rect, OPPOSITE_SIDE[annex.side]);
  const contacts: Contact[] = doorways.map((d) => ({ span: spanIn(band, annex, d.lo, d.hi), from: d.from }));
  const across = bandOf(spaces, [0, band.W], [0, band.V], contacts, false, rules, door);
  if (across) out.push({ tag: "b", rooms: across.rooms.map((p) => labelled(band, p)), score: across.score });
  // One after another away from it, through whichever doorway costs least.
  const row = frameOf(annex.rect, ROW_REAR[annex.side]);
  let best: AnnexLayout | null = null;
  for (const d of doorways) {
    if (d.hi - d.lo < door + 0.3 - EPS) continue;
    const through: BandRules = { hall: (s) => (d.from === "hall" ? rules.hall(s) : rules.via(d.from, s)), via: rules.via };
    const placed = bandOf(spaces, [0, row.W], [0, row.V], [], true, through, door);
    if (!placed || (best && placed.score >= best.score - EPS)) continue;
    const from = d.from;
    const rooms = placed.rooms.map((p) => (p.via === "hall" && from !== "hall" ? { ...p, via: from.key, ...(p.kind === "ensuite" ? { of: from.key } : {}) } : p));
    best = { tag: "r", rooms: rooms.map((p) => labelled(row, p)), score: placed.score };
  }
  if (best) out.push(best);
  return out.sort((a, b) => a.score - b.score);
}
