import { DEFAULT_HOUSE, LIMITS } from "../../plan/defaults";
import { levelIndex, storeyName } from "../../plan/levels";
import type { Id, Level, PlanDocument, Wall } from "../../plan/types";
import type { IdSource } from "../ids";
import { pinnedMessage } from "../locks";
import { fail, requireLength } from "../ops";
import { stairsWithout, withStairs } from "./stairs";
import type { PlanCommand } from "../types";

type AddLevel = Extract<PlanCommand, { type: "addLevel" }>;
type UpdateLevel = Extract<PlanCommand, { type: "updateLevel" }>;

/** What a floor keeps when its outline is replaced: who it is and where it sits. */
export type LevelBase = Pick<Level, "id" | "name" | "elevation" | "defaultWallHeight" | "floorThickness">;

/**
 * A floor with `source`'s outline, wall by wall (same corners and
 * thicknesses), under fresh ids, with nothing inside. Vertex ids are taken
 * first, then wall ids, in ring order, as `outlineLevel` does.
 */
export function copyOutline(source: Level, base: LevelBase, ids: IdSource): Level {
  const ring: Wall[] = source.envelope.wallIds.map((id) => source.walls[id]);
  const vertexIds = ring.map(() => ids.next("v"));
  const wallIds = ring.map(() => ids.next("wall"));
  const vertices: Level["vertices"] = {};
  vertexIds.forEach((id, i) => (vertices[id] = { ...source.vertices[ring[i].startVertexId] }));
  const walls: Record<Id, Wall> = {};
  wallIds.forEach((id, i) => {
    walls[id] = {
      id,
      startVertexId: vertexIds[i],
      endVertexId: vertexIds[(i + 1) % ring.length],
      role: "external",
      thickness: ring[i].thickness,
      height: base.defaultWallHeight,
    };
  });
  const rear = source.rearWallId ? source.envelope.wallIds.indexOf(source.rearWallId) : -1;
  return {
    id: base.id,
    name: base.name,
    elevation: base.elevation,
    defaultWallHeight: base.defaultWallHeight,
    ...(base.floorThickness === undefined ? {} : { floorThickness: base.floorThickness }),
    vertices,
    walls,
    openings: {},
    rooms: {},
    furniture: {},
    envelope: { kind: "polygon", wallIds },
    rearWallId: rear >= 0 ? wallIds[rear] : null,
  };
}

function requireName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) fail("invalid-value", "Floor name can't be empty.");
  if (name.length > LIMITS.maxNameLength) fail("invalid-value", `Floor name must be at most ${LIMITS.maxNameLength} characters.`);
  return name;
}

const requireFloorThickness = (value: unknown) => requireLength(value, "Floor thickness", LIMITS.minFloorThickness, LIMITS.maxFloorThickness);

/** A new top floor over the whole of the floor below, ready to divide into rooms. */
export function addLevel(doc: PlanDocument, cmd: AddLevel, ids: IdSource): PlanDocument {
  if (doc.levels.length >= LIMITS.maxLevels) fail("level-limit", `A house can have at most ${LIMITS.maxLevels} floors.`);
  const top = doc.levels[doc.levels.length - 1];
  const level = copyOutline(
    top,
    {
      id: ids.next("level"),
      name: cmd.name === undefined ? storeyName(doc.levels.length) : requireName(cmd.name),
      // Restacked once the command settles.
      elevation: top.elevation,
      defaultWallHeight: cmd.wallHeight === undefined ? top.defaultWallHeight : requireLength(cmd.wallHeight, "Ceiling height", 1, LIMITS.maxWallHeight),
      floorThickness: cmd.floorThickness === undefined ? DEFAULT_HOUSE.floorThickness : requireFloorThickness(cmd.floorThickness),
    },
    ids,
  );
  return { ...doc, levels: [...doc.levels, level] };
}

/** Removes a floor and everything on it, and the storey from stairs that climb to it. The ground floor stays; pinned rooms keep their floor. */
export function removeLevel(doc: PlanDocument, levelId: Id): PlanDocument {
  const index = levelIndex(doc, levelId);
  if (index < 0) fail("not-found", "That floor no longer exists.", [levelId]);
  if (index === 0) fail("invalid-value", "The ground floor can't be removed.", [levelId]);
  const pinned = Object.values(doc.levels[index].rooms).find((room) => room.locked);
  if (pinned) fail("room-pinned", pinnedMessage(pinned.name), [pinned.id]);
  const levels = doc.levels.filter((_, i) => i !== index);
  return doc.staircases ? withStairs({ ...doc, levels }, stairsWithout(doc, index)) : { ...doc, levels };
}

/** Renames a floor, sets its ceiling height on every wall, or sets the depth of the floor it stands on. */
export function updateLevel(doc: PlanDocument, index: number, cmd: UpdateLevel): Level {
  const level = doc.levels[index];
  let next = level;
  if (cmd.name !== undefined) {
    const name = requireName(cmd.name);
    if (name !== next.name) next = { ...next, name };
  }
  if (cmd.wallHeight !== undefined) {
    const height = requireLength(cmd.wallHeight, "Ceiling height", 1, LIMITS.maxWallHeight);
    const changed = Object.values(next.walls).filter((w) => w.height !== height);
    if (changed.length) {
      const walls = { ...next.walls };
      for (const w of changed) walls[w.id] = { ...w, height };
      next = { ...next, walls };
    }
    if (next.defaultWallHeight !== height) next = { ...next, defaultWallHeight: height };
  }
  if (cmd.floorThickness !== undefined) {
    if (index === 0) fail("invalid-value", "The ground floor stands on the ground, so it has no floor thickness.", [level.id]);
    const thickness = requireFloorThickness(cmd.floorThickness);
    if (thickness !== next.floorThickness) next = { ...next, floorThickness: thickness };
  }
  return next;
}
