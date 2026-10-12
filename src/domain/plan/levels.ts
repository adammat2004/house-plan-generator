import { DEFAULT_HOUSE } from "./defaults";
import type { Id, Level, PlanDocument } from "./types";

/**
 * Floors of a house. `levels` runs from the ground up; each floor stands on
 * the one below. Code that only ever meant "the house" reads the ground
 * floor through `groundLevel`, so single-storey assumptions stay findable.
 */

const STOREY_NAMES = ["Ground floor", "First floor", "Second floor", "Third floor"];

/** The usual name of the floor at an index: "Ground floor", "First floor", … */
export const storeyName = (index: number): string => STOREY_NAMES[index] ?? `Floor ${index + 1}`;

/** "single-storey", "two-storey", "three-storey". */
export const storeysWord = (count: number): string => `${["single", "two", "three", "four"][count - 1] ?? count}-storey`;

const SHORT_NAMES = ["Ground", "First", "Second", "Third"];

/** A floor's name for tight spaces: "Ground", "First", or its own name if it was renamed. */
export function floorLabel(doc: PlanDocument, index: number): string {
  const level = doc.levels[index];
  return level.name === storeyName(index) ? (SHORT_NAMES[index] ?? level.name) : level.name;
}

export const groundLevel = (doc: PlanDocument): Level => doc.levels[0];

export const levelIndex = (doc: PlanDocument, levelId: Id): number => doc.levels.findIndex((l) => l.id === levelId);

export const levelById = (doc: PlanDocument, levelId: Id): Level | undefined => doc.levels.find((l) => l.id === levelId);

export function levelAbove(doc: PlanDocument, levelId: Id): Level | undefined {
  const i = levelIndex(doc, levelId);
  return i < 0 ? undefined : doc.levels[i + 1];
}

export function levelBelow(doc: PlanDocument, levelId: Id): Level | undefined {
  const i = levelIndex(doc, levelId);
  return i <= 0 ? undefined : doc.levels[i - 1];
}

/** Whether a level holds an entity: a wall, vertex, opening, room or piece of furniture, or the level itself. */
export const levelHas = (level: Level, id: Id): boolean =>
  level.id === id || id in level.walls || id in level.vertices || id in level.openings || id in level.rooms || id in level.furniture;

/** The floor holding an entity. Ids are unique across floors. */
export const levelOf = (doc: PlanDocument, id: Id): Level | undefined => doc.levels.find((l) => levelHas(l, id));

/** The depth of the floor structure a level stands on; nothing for the ground floor. */
export const floorThicknessOf = (doc: PlanDocument, index: number): number =>
  index === 0 ? 0 : (doc.levels[index].floorThickness ?? DEFAULT_HOUSE.floorThickness);

/** From one floor's finished floor to the next one's: its ceiling height plus the floor above's structure. */
export const floorToFloor = (doc: PlanDocument, index: number): number =>
  doc.levels[index].defaultWallHeight + floorThicknessOf(doc, index + 1);

/** Where each floor must sit: the ground floor stays put and every other floor stands on the one below. */
export function stackedElevations(doc: PlanDocument): number[] {
  const out: number[] = [];
  doc.levels.forEach((level, i) => {
    out.push(i === 0 ? level.elevation : Math.round((out[i - 1] + doc.levels[i - 1].defaultWallHeight + floorThicknessOf(doc, i)) * 1e6) / 1e6);
  });
  return out;
}

/** Puts every floor at its stacked elevation. Returns the same document when nothing moves. */
export function restack(doc: PlanDocument): PlanDocument {
  const elevations = stackedElevations(doc);
  if (doc.levels.every((l, i) => l.elevation === elevations[i])) return doc;
  return { ...doc, levels: doc.levels.map((l, i) => (l.elevation === elevations[i] ? l : { ...l, elevation: elevations[i] })) };
}

export function replaceLevel(doc: PlanDocument, index: number, level: Level): PlanDocument {
  if (doc.levels[index] === level) return doc;
  return { ...doc, levels: doc.levels.map((l, i) => (i === index ? level : l)) };
}

/**
 * The document as if it had only one floor, for code that works on a single
 * floor (room planners, analysis). Write the result back with `spliceLevel`.
 * Edits in a view only see its floor's ids, so they need an id prefix of
 * their own; `validateDocument` catches a clash.
 */
export function levelView(doc: PlanDocument, levelId: Id): PlanDocument {
  const level = levelById(doc, levelId);
  if (!level) throw new Error(`No floor ${levelId}.`);
  return doc.levels.length === 1 ? doc : { ...doc, levels: [level] };
}

/** Puts a one-floor view's floor back into the whole document. */
export function spliceLevel(doc: PlanDocument, levelId: Id, view: PlanDocument): PlanDocument {
  const index = levelIndex(doc, levelId);
  if (index < 0) throw new Error(`No floor ${levelId}.`);
  const level = view.levels.find((l) => l.id === levelId) ?? view.levels[0];
  return { ...replaceLevel(doc, index, level), name: view.name };
}

/**
 * The lowest floor an edit changed, found by identity: an edit that carries
 * up, or restacks the floors above, starts there. Null when nothing changed
 * or floors were added or removed.
 */
export function changedLevelId(before: PlanDocument, after: PlanDocument): Id | null {
  if (before.levels.length !== after.levels.length) return null;
  return after.levels.find((l, i) => l !== before.levels[i])?.id ?? null;
}
