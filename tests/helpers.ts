import { applyCommand, createPlanDocument, type PlanCommand, type PlanIssue } from "@/domain/commands";
import { deriveLevelGeometry, deriveRoomRegions, roomFaceIndices } from "@/domain/geometry/derive";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Level, PlanDocument, Point2, Room } from "@/domain/plan/types";

export function newHouse(width = 8, depth = 10): PlanDocument {
  return createPlanDocument({ id: "doc-1", name: "Test house", width, depth, externalThickness: 0.3, wallHeight: 2.4 });
}

/** A house with the given outside-face outline, 300 mm external walls. */
export function newOutlineHouse(outline: Point2[]): PlanDocument {
  return createPlanDocument({ id: "doc-1", name: "Test house", outline, externalThickness: 0.3, wallHeight: 2.4 });
}

export const level = (doc: PlanDocument): Level => doc.levels[0];

export function apply(doc: PlanDocument, command: PlanCommand): PlanDocument {
  const result = applyCommand(doc, command);
  if (!result.ok) throw new Error(`Command ${command.type} failed: ${result.issues.map((i) => i.message).join("; ")}`);
  return result.document;
}

export function reject(doc: PlanDocument, command: PlanCommand): PlanIssue[] {
  const result = applyCommand(doc, command);
  if (result.ok) throw new Error(`Command ${command.type} unexpectedly succeeded`);
  return result.issues;
}

export function addWall(
  doc: PlanDocument,
  wallId: string,
  start: [number, number],
  end: [number, number],
  thickness = 0.1,
): PlanDocument {
  return apply(doc, {
    type: "addWall",
    wallId,
    start: { x: start[0], y: start[1] },
    end: { x: end[0], y: end[1] },
    thickness,
    idPrefix: wallId,
  });
}

export interface RoomSummary {
  id: string;
  name: string;
  type: Room["type"];
  clearArea: number;
}

/** Rooms with their clear areas, ordered by region (bottom-left first). */
export function rooms(doc: PlanDocument): RoomSummary[] {
  const lvl = level(doc);
  const regions = deriveRoomRegions(lvl);
  const indices = roomFaceIndices(lvl);
  return Object.values(lvl.rooms)
    .map((room) => ({ room, face: indices.get(room.id)! }))
    .sort((a, b) => a.face - b.face)
    .map(({ room, face }) => ({
      id: room.id,
      name: room.name,
      type: room.type,
      clearArea: round(regions[face].clearArea),
    }));
}

export function envelope(doc: PlanDocument) {
  const env = analyzeEnvelope(level(doc));
  if (!env.ok) throw new Error(env.message);
  return env.info;
}

export function faceCount(doc: PlanDocument): number {
  return deriveLevelGeometry(level(doc)).faces.length;
}

export const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

/** House centreline coordinates for the default 8 × 10 m, 300 mm house. */
export const AXIS = { west: 0.15, east: 7.85, south: 0.15, north: 9.85 } as const;
