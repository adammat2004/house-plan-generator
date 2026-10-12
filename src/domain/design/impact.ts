import { levelOf } from "../plan/levels";
import type { Id, PlanDocument } from "../plan/types";
import { compareRoom, roomFacts, type RoomChange } from "./analysis";
import { assessSense, type SenseFinding } from "./sense";

/**
 * What a room-level option would change, measured on the plans themselves:
 * the room's size before and after, the lines the comparison cards show, and
 * which plan-sense findings it would bring in or clear. Every number shown
 * beside an option comes from here, never from the planner's description.
 */
export interface ProposalImpact {
  roomId: Id;
  /** The room in the option (its id changes when it's merged with another). */
  afterRoomId: Id;
  areaBefore: number;
  areaAfter: number;
  /** m², after − before. */
  areaDelta: number;
  changes: RoomChange[];
  /** Findings the option would bring in on the room's floor: shown as "to check", never hidden. */
  introduced: SenseFinding[];
  /** Findings it would clear. */
  resolved: SenseFinding[];
}

const key = (f: SenseFinding) => `${f.rule}|${f.message}`;

/** The impact of one option on a room. Null when the room can't be found on either side. */
export function proposalImpact(source: PlanDocument, candidate: PlanDocument, roomId: Id, changedRoomIds: readonly Id[] = []): ProposalImpact | null {
  const before = levelOf(source, roomId);
  if (!before) return null;
  const after = candidate.levels.find((l) => l.id === before.id);
  if (!after) return null;
  // A room opened up into another carries on under the merged room's id.
  const afterRoomId = after.rooms[roomId] ? roomId : (changedRoomIds.find((id) => after.rooms[id]) ?? null);
  if (!afterRoomId) return null;
  const a = roomFacts(before, roomId);
  const b = roomFacts(after, afterRoomId);
  if (!a || !b) return null;
  const was = assessSense(before).findings;
  const now = assessSense(after).findings;
  const wasKeys = new Set(was.map(key));
  const nowKeys = new Set(now.map(key));
  return {
    roomId,
    afterRoomId,
    areaBefore: a.area,
    areaAfter: b.area,
    areaDelta: b.area - a.area,
    changes: compareRoom(before, after, roomId, afterRoomId),
    introduced: now.filter((f) => !wasKeys.has(key(f))),
    resolved: was.filter((f) => !nowKeys.has(key(f))),
  };
}

/** "+6.2 m²", "−1.0 m²", or null when the size barely changes. */
export function areaDeltaText(impact: Pick<ProposalImpact, "areaDelta">): string | null {
  const d = impact.areaDelta;
  if (Math.abs(d) < 0.1) return null;
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} m²`;
}
