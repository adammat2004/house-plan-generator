import { applyCommand, createPlanDocument } from "@/domain/commands";
import type { PlanDocument } from "@/domain/plan/types";

/**
 * A representative large plan: a 30 × 24 m envelope partitioned into a grid
 * of rooms by full-length walls, split into segments at every crossing, plus
 * doors on many segments. Yields more than 100 walls.
 */
export function buildLargePlan(): PlanDocument {
  const width = 30;
  const depth = 24;
  const t = 0.3;
  let doc = createPlanDocument({ id: "large", name: "Large plan", width, depth, externalThickness: t, wallHeight: 2.6 });
  const west = t / 2;
  const east = width - t / 2;
  const south = t / 2;
  const north = depth - t / 2;
  const xs = [3, 6, 9, 12, 15, 18, 21, 24, 27];
  const ys = [3, 6, 9, 12, 15, 18, 21];
  const apply = (command: Parameters<typeof applyCommand>[1]) => {
    const result = applyCommand(doc, command);
    if (!result.ok) throw new Error(result.issues[0].message);
    doc = result.document;
  };
  // Vertical walls, one segment per row band, so crossings become shared vertices.
  const yLines = [south, ...ys, north];
  const xLines = [west, ...xs, east];
  let n = 0;
  for (const x of xs) {
    for (let i = 0; i + 1 < yLines.length; i++) {
      apply({ type: "addWall", wallId: `v${n++}`, start: { x, y: yLines[i] }, end: { x, y: yLines[i + 1] }, thickness: 0.1, idPrefix: `v${n}` });
    }
  }
  for (const y of ys) {
    for (let i = 0; i + 1 < xLines.length; i++) {
      apply({ type: "addWall", wallId: `h${n++}`, start: { x: xLines[i], y }, end: { x: xLines[i + 1], y }, thickness: 0.1, idPrefix: `h${n}` });
    }
  }
  let d = 0;
  for (const wall of Object.values(doc.levels[0].walls)) {
    if (wall.role !== "internal" || d > 60) continue;
    apply({
      type: "addOpening",
      opening: { id: `door${d++}`, wallId: wall.id, kind: "door", offset: 1, width: 0.8, height: 2.1, hinge: "start", swingSide: "left" },
    });
  }
  return doc;
}
