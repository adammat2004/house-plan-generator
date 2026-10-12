import { describe, expect, it } from "vitest";
import type { Point2 } from "@/domain/plan/types";
import { activeLevelOf, createEditorActions, createEditorStores } from "@/editor/state/stores";
import { createToolController } from "@/editor/tools/controller";
import { fitRect, worldToScreen } from "@/editor/viewport/viewport";
import { AXIS, newHouse } from "../helpers";

function setup() {
  const stores = createEditorStores(newHouse());
  const actions = createEditorActions(stores);
  const controller = createToolController(stores, actions);
  stores.session.setState((s) => ({
    viewport: { ...fitRect({ ...s.viewport, width: 1000, height: 1200 }, { minX: 0, minY: 0, maxX: 8, maxY: 10 }, 100), scale: 100 },
  }));
  const doc = () => stores.documents.getState().history.present;
  const active = () => activeLevelOf(doc(), stores.session.getState().activeLevelId);
  const wallAt = (x: number) => ({ type: "addWall" as const, start: { x, y: AXIS.south }, end: { x, y: AXIS.north }, thickness: 0.1 });
  const input = (p: Point2) => ({ screen: worldToScreen(stores.session.getState().viewport, p), button: 0, shiftKey: false, altKey: false });
  return { stores, actions, controller, doc, active, wallAt, input };
}

describe("editing a house of several floors", () => {
  it("adds a floor and shows it; new walls go on the floor on show", () => {
    const { stores, actions, doc, active, wallAt } = setup();
    expect(actions.addFloor().ok).toBe(true);
    expect(doc().levels).toHaveLength(2);
    expect(active().id).toBe(doc().levels[1].id);
    expect(stores.documents.getState().notice?.message).toMatch(/Added the first floor/);
    const ground = doc().levels[0];
    expect(actions.dispatch(wallAt(4)).ok).toBe(true);
    expect(doc().levels[0]).toBe(ground);
    expect(Object.keys(doc().levels[1].rooms)).toHaveLength(2);
  });

  it("draws walls with the tool on the floor on show", () => {
    const { actions, controller, doc, input } = setup();
    actions.addFloor();
    actions.setTool("wall");
    controller.pointerDown(input({ x: 3, y: AXIS.south }));
    controller.pointerDown(input({ x: 3, y: AXIS.north }));
    expect(Object.values(doc().levels[1].walls).filter((w) => w.role === "internal")).toHaveLength(1);
    expect(Object.values(doc().levels[0].walls).filter((w) => w.role === "internal")).toHaveLength(0);
  });

  it("switches floors, dropping the selection, and undo shows the floor it changed", () => {
    const { stores, actions, doc, active, wallAt } = setup();
    actions.addFloor();
    actions.dispatch(wallAt(4));
    actions.select({ kind: "house", id: active().id });
    actions.setActiveLevel(doc().levels[0].id);
    expect(stores.session.getState().activeLevelId).toBeNull();
    expect(stores.session.getState().selection).toBeNull();
    expect(actions.undo()).toBe(true);
    expect(active().id).toBe(doc().levels[1].id);
    expect(stores.documents.getState().notice?.message).toBe("Undone on the first floor.");
  });

  it("goes back to the ground floor when the floor on show goes", () => {
    const { stores, actions, doc } = setup();
    actions.addFloor();
    const first = doc().levels[1].id;
    expect(actions.removeFloor(first).ok).toBe(true);
    expect(doc().levels).toHaveLength(1);
    expect(stores.session.getState().activeLevelId).toBeNull();
    actions.undo();
    expect(doc().levels).toHaveLength(2);
    // Adding the floor again by redo keeps the ground floor on show.
    actions.redo();
    expect(stores.session.getState().activeLevelId).toBeNull();
  });

  it("looks at floors on phones, but doesn't add them", () => {
    const { actions, doc, active } = setup();
    actions.addFloor();
    actions.setActiveLevel(null);
    actions.setReadOnly(true);
    actions.setActiveLevel(doc().levels[1].id);
    expect(active().id).toBe(doc().levels[1].id);
    expect(actions.addFloor().ok).toBe(false);
    expect(doc().levels).toHaveLength(2);
  });

  it("keeps the floor number when switching to another plan", () => {
    const { stores, actions, doc } = setup();
    actions.addFloor();
    const copy = actions.duplicatePlan(undefined, false)!;
    actions.switchPlan(copy);
    expect(stores.session.getState().activeLevelId).toBe(doc().levels[1].id);
  });

  it("sets each floor's ceiling height on its own, moving the floors above", () => {
    const { actions, doc } = setup();
    actions.addFloor();
    expect(actions.setWallHeights(2.7).ok).toBe(true);
    expect(doc().levels[0].defaultWallHeight).toBe(2.7);
    expect(doc().levels[1].elevation).toBeCloseTo(3, 9);
    expect(actions.setWallHeights(2.5, doc().levels[1].id).ok).toBe(true);
    expect(doc().levels[1].defaultWallHeight).toBe(2.5);
  });

  it("furnishes the floor on show", () => {
    const { actions, doc } = setup();
    actions.addFloor();
    const room = Object.values(doc().levels[1].rooms)[0];
    actions.dispatch({ type: "updateRoom", roomId: room.id, changes: { type: "bedroom" } });
    expect(actions.furnishAll(false)).toBeGreaterThan(0);
    expect(Object.keys(doc().levels[1].furniture).length).toBeGreaterThan(0);
    expect(Object.keys(doc().levels[0].furniture)).toHaveLength(0);
  });

  it("places stairs with the tool, flush against a wall, and drags them", () => {
    const { stores, actions, controller, doc, input } = setup();
    actions.addFloor();
    actions.setActiveLevel(null);
    actions.setTool("stairs");
    // Near the west wall: the stairs settle against its inside face.
    controller.pointerMove(input({ x: 0.85, y: 3 }));
    expect(stores.session.getState().stairsDraft?.valid).toBe(true);
    controller.pointerDown(input({ x: 0.85, y: 3 }));
    const stairs = Object.values(doc().staircases ?? {});
    expect(stairs).toHaveLength(1);
    expect(stairs[0]).toMatchObject({ fromLevelId: doc().levels[0].id, toLevelId: doc().levels[1].id });
    expect(stairs[0].foot.x - stairs[0].width / 2).toBeCloseTo(0.3, 6);
    expect(stores.session.getState().selection).toEqual({ kind: "stairs", id: stairs[0].id });
    expect(stores.session.getState().tool).toBe("select");

    controller.pointerDown(input({ x: 0.9, y: 3 }));
    controller.pointerMove(input({ x: 2.4, y: 3.5 }));
    controller.pointerUp();
    const moved = Object.values(doc().staircases ?? {})[0];
    expect(moved.foot.x).toBeGreaterThan(stairs[0].foot.x + 1);

    // Delete removes the selected stairs.
    actions.select({ kind: "stairs", id: moved.id });
    actions.dispatch({ type: "deleteStairs", staircaseId: moved.id });
    expect(doc().staircases).toBeUndefined();
  });

  it("from the top floor, places stairs up from the floor below", () => {
    const { actions, controller, doc, input } = setup();
    actions.addFloor();
    actions.setTool("stairs");
    controller.pointerDown(input({ x: 1, y: 3 }));
    expect(Object.values(doc().staircases ?? {})[0]).toMatchObject({ fromLevelId: doc().levels[0].id, toLevelId: doc().levels[1].id });
  });
});
