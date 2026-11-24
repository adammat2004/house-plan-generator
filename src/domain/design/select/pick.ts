import { canFurnish, furnishRoom } from "../../furniture/furnish";
import type { PlanDocument } from "../../plan/types";
import { compareIdeas, ideaOf } from "../eval/metrics";
import { bySense, hardCount } from "../sense";

/**
 * Which candidates to show: the best plan, then the best plans that are a
 * different design idea from those already picked, then variations of the
 * same idea (a different house size first, if nearly as good), and only then
 * plans that break more hard rules. A plan that is the same as one already picked, mirrored
 * or with bedrooms swapped, is never shown twice.
 *
 * "A different idea" comes from `compareIdeas` (eval/metrics.ts). A
 * different idea has to be nearly as good to be shown ahead of a variation:
 * within QUALITY_MARGIN points of plan sense of the best plan.
 */

/** How far below the best plan's sense score a different idea may be and still come before a variation of the best. */
export const QUALITY_MARGIN = 20;

interface Judged {
  document: PlanDocument;
  sense?: { findings: ReadonlyArray<{ rule: string }>; score: number };
  footprint?: { width: number; depth: number };
}

/** Whether a plan is the same as one of these: mirrored, or with rooms of a kind swapped, in a house of the same size. */
export const repeats = (doc: PlanDocument, docs: readonly PlanDocument[]) => docs.some((d) => compareIdeas(ideaOf(d), ideaOf(doc)).identical);

/** What each piece of essential furniture a plan's rooms can't take costs its plan sense, and how many of the best plans are furnished to find out. */
export const MISSING_FURNITURE_COST = 2;
export const FURNISHED_JUDGED = 6;

/** Pieces of the furniture its rooms are for (a bed, a sofa, a table) that don't fit, on every floor. */
export function missingFurniture(doc: PlanDocument): number {
  let missing = 0;
  for (const level of doc.levels) for (const room of Object.values(level.rooms)) if (canFurnish(room.type)) missing += furnishRoom(level, room.id, "judge")?.missing.length ?? 0;
  return missing;
}

/**
 * The best few plans charged for furniture that won't fit: laid out as they
 * would be furnished, each missing piece costs plan sense, so a room too
 * awkward for its bed ranks below one that takes it. The rest keep their
 * score. Copies; the candidates are left as they are.
 */
export function chargeFurniture<T extends Judged>(candidates: readonly T[], top = FURNISHED_JUDGED): T[] {
  const ranked = candidates.map((c, i) => ({ c, i })).sort((a, b) => (a.c.sense && b.c.sense ? bySense(a.c.sense, b.c.sense) : 0) || a.i - b.i);
  const charged = new Set(ranked.slice(0, top).map((x) => x.c));
  return candidates.map((c) => {
    if (!charged.has(c) || !c.sense) return c;
    const missing = missingFurniture(c.document);
    return missing ? { ...c, sense: { ...c.sense, score: c.sense.score - MISSING_FURNITURE_COST * missing } } : c;
  });
}

/**
 * `placed`, when the brief places rooms: how far a plan's rooms are from
 * where they were placed if it honours every placement, else null. Plans
 * that honour them, closest first, are picked before any that don't, but
 * only among plans that break no more hard rules and are within
 * QUALITY_MARGIN of the best: a placement never brings in a worse plan.
 */
export function pickIdeas<T extends Judged>(candidates: readonly T[], count: number, placed?: (c: T) => number | null): T[] {
  // Stable: candidates without a judgement keep their place.
  const ranked = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.sense && b.c.sense ? bySense(a.c.sense, b.c.sense) : 0) || a.i - b.i)
    .map((x) => x.c);
  const hard = (c: T) => (c.sense ? hardCount(c.sense.findings) : 0);
  const fewest = Math.min(...ranked.map(hard));
  const best = ranked[0]?.sense?.score ?? 0;
  const sound = (c: T) => hard(c) === fewest;
  // The plans that honour the placements, closest first, among those as sound and nearly as good as the best.
  const costs = placed ? new Map(ranked.map((c) => [c, sound(c) && (c.sense?.score ?? best) >= best - QUALITY_MARGIN ? placed(c) : null])) : null;
  const honouring = costs ? ranked.filter((c) => costs.get(c) != null).sort((a, b) => costs.get(a)! - costs.get(b)! || ranked.indexOf(a) - ranked.indexOf(b)) : [];
  if (count <= 1 || ranked.length <= 1) return [...honouring, ...ranked.filter((c) => !honouring.includes(c))].slice(0, Math.max(0, count));
  const sizeOf = (c: T) => (c.footprint ? `${c.footprint.width}x${c.footprint.depth}` : "");
  const picked: T[] = [];
  const differences = (c: T) => picked.map((p) => compareIdeas(ideaOf(p.document), ideaOf(c.document)));
  const take = (accept: (c: T) => boolean) => {
    for (const c of ranked) {
      if (picked.length >= count) return;
      if (picked.includes(c) || !accept(c)) continue;
      const diff = differences(c);
      if (diff.some((d) => d.identical)) continue;
      picked.push(c);
    }
  };
  const distinct = (c: T) => differences(c).every((d) => d.distinct);
  const nearBest = (c: T) => (c.sense?.score ?? best) >= best - QUALITY_MARGIN;
  // Placed rooms first: the plans that honour them, as ideas and then as variations, before any that don't.
  if (honouring.length) {
    const among = new Set(honouring);
    for (const c of honouring) {
      if (picked.length >= count) break;
      if (picked.length && !distinct(c)) continue;
      if (!differences(c).some((d) => d.identical)) picked.push(c);
    }
    take((c) => among.has(c));
  }
  // The best plan, then different ideas that are nearly as good.
  take((c) => sound(c) && (picked.length === 0 || (nearBest(c) && distinct(c))));
  // Variations of those ideas: in another house size first, if nearly as good; then the best of the rest.
  take((c) => sound(c) && nearBest(c) && !!sizeOf(c) && !picked.some((p) => sizeOf(p) === sizeOf(c)));
  take(sound);
  // Plans that break more hard rules, only to make up the number.
  take(() => true);
  return picked;
}
