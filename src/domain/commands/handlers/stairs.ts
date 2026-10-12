import { deriveRoomRegions, roomFaceIndices } from "../../geometry/derive";
import { roundToPrecision } from "../../geometry/numeric";
import { overlapArea, rectToPolygon } from "../../geometry/polygons";
import { staircasePlan, stairSpan } from "../../geometry/stairs";
import { STAIR_PRESET } from "../../plan/defaults";
import { levelIndex } from "../../plan/levels";
import { STAIR_SHAPES } from "../../plan/schema";
import type { Id, PlanDocument, Staircase } from "../../plan/types";
import type { IdSource } from "../ids";
import { pinnedMessage } from "../locks";
import { fail, requireFinite, requireLength } from "../ops";
import type { StairChanges } from "../types";

/**
 * Stairs belong to the house rather than one floor: they run from one floor
 * up to another. These handlers check the record itself and pinned rooms;
 * whether the stairs fit (inside the house, clear of walls, room to step on
 * and off) is checked with the other floors in validateStack.
 */

const ROTATIONS: readonly number[] = [0, 90, 180, 270];

function normalise(doc: PlanDocument, input: Staircase): Staircase {
  const id = input.id;
  if (!(STAIR_SHAPES as readonly string[]).includes(input.shape)) fail("invalid-value", "Stairs are straight, L-shaped or U-shaped.", [id]);
  if (!ROTATIONS.includes(input.rotation)) fail("invalid-value", "Stairs turn in quarter turns: 0, 90, 180 or 270 degrees.", [id]);
  const from = levelIndex(doc, input.fromLevelId);
  const to = levelIndex(doc, input.toLevelId);
  if (from < 0 || to < 0) fail("not-found", "That floor no longer exists.", [id]);
  if (to <= from) fail("stairs-invalid", "Stairs have to go up to a higher floor.", [id]);
  const turn = input.shape === "straight" ? undefined : input.turn === "left" ? "left" : "right";
  return {
    id,
    fromLevelId: input.fromLevelId,
    toLevelId: input.toLevelId,
    shape: input.shape,
    ...(turn ? { turn } : {}),
    foot: {
      x: roundToPrecision(requireFinite(input.foot?.x, "Stairs position")),
      y: roundToPrecision(requireFinite(input.foot?.y, "Stairs position")),
    },
    rotation: input.rotation,
    width: requireLength(input.width, "Stair width", STAIR_PRESET.minWidth, STAIR_PRESET.maxWidth),
    going: requireLength(input.going, "Tread depth", STAIR_PRESET.minGoing, STAIR_PRESET.maxGoing),
  };
}

/** Stairs can't be put into a pinned room on any floor they serve. */
function checkPins(doc: PlanDocument, s: Staircase) {
  const span = stairSpan(doc, s);
  if (!span) return;
  const footprint = staircasePlan(doc, s).footprint.map(rectToPolygon);
  for (let k = span.from; k <= span.to; k++) {
    const level = doc.levels[k];
    const pinned = Object.values(level.rooms).filter((room) => room.locked);
    if (!pinned.length) continue;
    const regions = deriveRoomRegions(level);
    const faces = roomFaceIndices(level);
    for (const room of pinned) {
      const clear = regions[faces.get(room.id) ?? -1]?.clear ?? [];
      if (clear.some((poly) => footprint.some((r) => overlapArea(poly, r) > 1e-6))) fail("room-pinned", pinnedMessage(room.name), [room.id, s.id]);
    }
  }
}

/** The document with these stairs; the record is left out when there are none, as in a house without stairs. */
export function withStairs(doc: PlanDocument, staircases: Record<Id, Staircase>): PlanDocument {
  if (Object.keys(staircases).length) return { ...doc, staircases };
  const rest = { ...doc };
  delete rest.staircases;
  return rest;
}

export function addStairs(doc: PlanDocument, input: Staircase, ids: IdSource): PlanDocument {
  if (!input || typeof input.id !== "string" || !input.id) fail("invalid-value", "Stairs need an id.");
  if (ids.isTaken(input.id)) fail("invalid-value", "An entity with that id already exists.", [input.id]);
  const staircase = normalise(doc, input);
  checkPins(doc, staircase);
  ids.reserve(staircase.id);
  return withStairs(doc, { ...doc.staircases, [staircase.id]: staircase });
}

export function updateStairs(doc: PlanDocument, staircaseId: Id, changes: StairChanges): PlanDocument {
  const current = doc.staircases?.[staircaseId];
  if (!current) fail("not-found", "Those stairs no longer exist.", [staircaseId]);
  if (!changes || typeof changes !== "object") fail("invalid-value", "Nothing to change.", [staircaseId]);
  const { turn, ...rest } = changes;
  const merged: Staircase = { ...current, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
  if (turn !== undefined) merged.turn = turn ?? undefined;
  const staircase = normalise(doc, merged);
  if (JSON.stringify(staircase) === JSON.stringify(current)) return doc;
  checkPins(doc, staircase);
  return withStairs(doc, { ...doc.staircases, [staircaseId]: staircase });
}

export function deleteStairs(doc: PlanDocument, staircaseId: Id): PlanDocument {
  if (!doc.staircases?.[staircaseId]) fail("not-found", "Those stairs no longer exist.", [staircaseId]);
  const staircases = { ...doc.staircases };
  delete staircases[staircaseId];
  return withStairs(doc, staircases);
}

/**
 * The stairs left when floor `index` goes: stairs that only reached it or
 * only left from it go too; stairs passing through, or climbing past it,
 * lose that storey.
 */
export function stairsWithout(doc: PlanDocument, index: number): Record<Id, Staircase> {
  const out: Record<Id, Staircase> = {};
  for (const s of Object.values(doc.staircases ?? {})) {
    const span = stairSpan(doc, s);
    if (!span || index < span.from || index > span.to) {
      out[s.id] = s;
      continue;
    }
    if (span.to - span.from === 1) continue;
    if (index === span.from) out[s.id] = { ...s, fromLevelId: doc.levels[index + 1].id };
    else if (index === span.to) out[s.id] = { ...s, toLevelId: doc.levels[index - 1].id };
    else out[s.id] = s;
  }
  return out;
}
