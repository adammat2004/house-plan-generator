import { applyCommand, createPlanDocument, type PlanCommand } from "@/domain/commands";
import { deriveLevelGeometry, roomFaceIndices } from "@/domain/geometry/derive";
import { findFaceIndexContaining } from "@/domain/geometry/faces";
import type { PlanDocument, Point2, RoomType } from "@/domain/plan/types";

/** A representative two-bedroom plan used for visual checks. */
export function buildSamplePlan(): PlanDocument {
  let doc = createPlanDocument({ id: "sample-house", name: "Sample house", width: 10, depth: 9, externalThickness: 0.3, wallHeight: 2.4, idPrefix: "s" });
  const run = (command: PlanCommand) => {
    const result = applyCommand(doc, command);
    if (!result.ok) throw new Error(`${command.type}: ${result.issues[0].message}`);
    doc = result.document;
  };
  const W = 0.15;
  const E = 9.85;
  const S = 0.15;
  const N = 8.85;
  const wall = (id: string, a: [number, number], b: [number, number]) =>
    run({ type: "addWall", wallId: id, start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: 0.1, idPrefix: id });
  wall("w-spine", [4.2, S], [4.2, N]);
  wall("w-kitchen", [W, 5], [4.2, 5]);
  wall("w-bed1", [4.2, 3.6], [E, 3.6]);
  wall("w-hall", [4.2, 5.8], [E, 5.8]);
  wall("w-bath", [7, 5.8], [7, N]);
  const [south, east, north, west] = doc.levels[0].envelope.wallIds;

  const door = (id: string, wallId: string, offset: number, hinge: "start" | "end", swingSide: "left" | "right", width = 0.9) =>
    run({ type: "addOpening", opening: { id, wallId, kind: "door", offset, width, height: 2.1, hinge, swingSide } });
  const win = (id: string, wallId: string, offset: number, width: number) =>
    run({ type: "addOpening", opening: { id, wallId, kind: "window", offset, width, height: 1.2, sillHeight: 0.9 } });

  door("door-front", south, 2.5, "start", "left", 1.0);
  door("door-hall", "w-spine", 3.7, "end", "left");
  door("door-kitchen", "w-kitchen", 2.5, "start", "left");
  door("door-bed1", "w-bed1", 1.0, "start", "right");
  door("door-bath", "w-hall", 1.2, "start", "left", 0.8);
  door("door-bed2", "w-hall", 3.6, "end", "left");
  win("win-living", south, 0.5, 1.6);
  win("win-bed1", south, 6.8, 1.6);
  win("win-east", east, 1.2, 1.2);
  win("win-bed2", north, 0.8, 1.6);
  win("win-kitchen", north, 6.4, 1.8);
  win("win-west", west, 1.0, 1.2);
  run({ type: "setRearWall", wallId: north });

  const labels: Array<[Point2, string, RoomType]> = [
    [{ x: 2, y: 2 }, "Living room", "living"],
    [{ x: 2, y: 7 }, "Kitchen / dining", "kitchen_dining"],
    [{ x: 7, y: 2 }, "Bedroom 1", "bedroom"],
    [{ x: 7, y: 4.7 }, "Hall", "hall"],
    [{ x: 5.6, y: 7.3 }, "Bathroom", "bathroom"],
    [{ x: 8.4, y: 7.3 }, "Bedroom 2", "bedroom"],
  ];
  for (const [point, name, type] of labels) {
    const level = doc.levels[0];
    const face = findFaceIndexContaining(deriveLevelGeometry(level).faces, point);
    const roomId = [...roomFaceIndices(level)].find(([, index]) => index === face)?.[0];
    if (roomId) run({ type: "updateRoom", roomId, changes: { name, type } });
  }
  return doc;
}
