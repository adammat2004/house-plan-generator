import { applyCommand } from "@/domain/commands";
import { deriveLevelGeometry, openingHostIntervals } from "@/domain/geometry/derive";
import { roundToPrecision } from "@/domain/geometry/numeric";
import { levelOf } from "@/domain/plan/levels";
import type { Id, Opening } from "@/domain/plan/types";
import { editor, editorStores } from "../../state/editor";
import { newIdPrefix } from "../../state/ids";

/*
 * One-click plan changes offered beside a selection (the selection toolbar
 * and the inspector): each is one validated command, so one undo.
 */

/**
 * A door or window of the usual size in the middle of a wall: the stretch
 * clear of other walls that holds the middle, else the longest, moved along
 * until it misses any door or window already there.
 */
export function addOpeningHere(wallId: Id, kind: "door" | "window") {
  const doc = editor.current();
  const level = levelOf(doc, wallId) ?? editor.activeLevel();
  const geometry = deriveLevelGeometry(level);
  const axis = geometry.axes.get(wallId);
  if (!axis) return;
  const s = editorStores.session.getState().settings;
  const preset = kind === "door" ? s.door : s.window;
  const intervals = [...openingHostIntervals(geometry, wallId)].sort((a, b) => {
    const holds = (i: [number, number]) => (axis.length / 2 >= i[0] && axis.length / 2 <= i[1] ? 0 : 1);
    return holds(a) - holds(b) || b[1] - b[0] - (a[1] - a[0]);
  });
  const id = `${newIdPrefix()}-${kind}`;
  for (const [lo, hi] of intervals) {
    const width = roundToPrecision(Math.min(preset.width, hi - lo - 0.1));
    if (width < 0.4) continue;
    const mid = (lo + hi) / 2;
    // From the middle outwards, both ways.
    for (let step = 0; step * 0.1 <= (hi - lo) / 2; step++) {
      for (const sign of step ? [1, -1] : [1]) {
        const offset = roundToPrecision(mid - width / 2 + sign * step * 0.1);
        if (offset < lo - 1e-9 || offset + width > hi + 1e-9) continue;
        const opening: Opening =
          kind === "door"
            ? { id, wallId, kind, offset, width, height: s.door.height, hinge: "start", swingSide: "left" }
            : { id, wallId, kind, offset, width, height: s.window.height, sillHeight: s.window.sillHeight };
        if (!applyCommand(doc, { type: "addOpening", opening }).ok) continue;
        if (editor.dispatch({ type: "addOpening", opening }).ok) editor.select({ kind: "opening", id });
        return;
      }
    }
  }
  editor.notify("info", `There's no room for a ${kind} on this wall.`);
}

/** Centres a door or window in the stretch of wall it's in. */
export function centreOpening(opening: Opening) {
  const level = levelOf(editor.current(), opening.id) ?? editor.activeLevel();
  const geometry = deriveLevelGeometry(level);
  const centre = opening.offset + opening.width / 2;
  const interval = openingHostIntervals(geometry, opening.wallId).find(([lo, hi]) => centre >= lo && centre <= hi);
  if (!interval) return;
  const offset = roundToPrecision((interval[0] + interval[1]) / 2 - opening.width / 2);
  if (Math.abs(offset - opening.offset) > 1e-9) editor.dispatch({ type: "updateOpening", openingId: opening.id, changes: { offset } });
}
