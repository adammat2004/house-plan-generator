import { describe, expect, it } from "vitest";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { HISTORY_LIMIT } from "@/editor/state/history";
import { deriveRoomRegions } from "@/domain/geometry/derive";
import { AXIS, level, newHouse } from "../helpers";

function setup() {
  const stores = createEditorStores(newHouse());
  const actions = createEditorActions(stores);
  const doc = () => stores.documents.getState().history.present;
  return { stores, actions, doc };
}

describe("editor history", () => {
  it("undoes and redoes dependent geometry, room metadata and openings exactly", () => {
    const { actions, doc } = setup();
    const snapshots = [doc()];
    actions.dispatch({ type: "addWall", wallId: "v", start: { x: 4, y: AXIS.south }, end: { x: 4, y: AXIS.north }, thickness: 0.1 });
    snapshots.push(doc());
    const roomId = Object.keys(level(doc()).rooms)[0];
    actions.dispatch({ type: "updateRoom", roomId, changes: { name: "Kitchen", type: "kitchen" } });
    snapshots.push(doc());
    actions.dispatch({
      type: "addOpening",
      opening: { id: "d1", wallId: "v", kind: "door", offset: 2, width: 0.9, height: 2.1, hinge: "start", swingSide: "left" },
    });
    snapshots.push(doc());
    actions.dispatch({ type: "moveWall", wallId: "v", delta: 1 });
    snapshots.push(doc());
    actions.dispatch({ type: "resizeFootprint", width: 9 });
    snapshots.push(doc());

    for (let i = snapshots.length - 2; i >= 0; i--) {
      expect(actions.undo()).toBe(true);
      expect(doc()).toBe(snapshots[i]);
    }
    expect(actions.undo()).toBe(false);
    for (let i = 1; i < snapshots.length; i++) {
      expect(actions.redo()).toBe(true);
      expect(doc()).toEqual(snapshots[i]);
    }
    expect(deriveRoomRegions(level(doc())).length).toBe(2);
  });

  it("clears redo after a new edit", () => {
    const { actions, stores } = setup();
    actions.dispatch({ type: "resizeFootprint", width: 9 });
    actions.undo();
    expect(stores.documents.getState().history.future).toHaveLength(1);
    actions.dispatch({ type: "resizeFootprint", depth: 11 });
    expect(stores.documents.getState().history.future).toHaveLength(0);
  });

  it("keeps at most 100 undo entries", () => {
    const { actions, stores } = setup();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) actions.dispatch({ type: "resizeFootprint", width: 8 + (i + 1) * 0.01 });
    expect(stores.documents.getState().history.past).toHaveLength(HISTORY_LIMIT);
  });

  it("leaves the document unchanged and explains a rejected edit", () => {
    const { actions, stores, doc } = setup();
    const before = doc();
    const result = actions.dispatch({ type: "resizeFootprint", width: 0.5 });
    expect(result.ok).toBe(false);
    expect(doc()).toBe(before);
    expect(stores.documents.getState().history.past).toHaveLength(0);
    expect(stores.documents.getState().notice?.tone).toBe("error");
    expect(stores.documents.getState().notice?.message).toMatch(/House width must be at least/);
  });

  it("turns a whole drag into one history entry and cancels cleanly", () => {
    const { actions, stores, doc } = setup();
    actions.dispatch({ type: "addWall", wallId: "v", start: { x: 4, y: AXIS.south }, end: { x: 4, y: AXIS.north }, thickness: 0.1 });
    const committed = doc();
    for (const delta of [0.1, 0.4, 0.8, 1.2]) actions.preview({ type: "moveWall", wallId: "v", delta, idPrefix: "g1" });
    expect(doc()).toBe(committed);
    actions.cancelPreview();
    expect(stores.documents.getState().preview).toBeNull();
    expect(doc()).toBe(committed);

    for (const delta of [0.2, 0.6, 1.0]) actions.preview({ type: "moveWall", wallId: "v", delta, idPrefix: "g2" });
    const pastBefore = stores.documents.getState().history.past.length;
    expect(actions.commitPreview()).toBe(true);
    expect(stores.documents.getState().history.past.length).toBe(pastBefore + 1);
    expect(level(doc()).vertices[level(doc()).walls.v.startVertexId].x).toBe(5);
  });

  it("keeps the last valid preview when a drag step is invalid", () => {
    const { actions, stores } = setup();
    actions.dispatch({ type: "addWall", wallId: "v", start: { x: 4, y: AXIS.south }, end: { x: 4, y: AXIS.north }, thickness: 0.1 });
    actions.preview({ type: "moveWall", wallId: "v", delta: 1, idPrefix: "g" });
    const valid = stores.documents.getState().preview!.document;
    actions.preview({ type: "moveWall", wallId: "v", delta: 10, idPrefix: "g" });
    const preview = stores.documents.getState().preview!;
    expect(preview.document).toBe(valid);
    expect(preview.issue?.code).toBe("move-blocked");
  });

  it("does not record selection or viewport changes in history", () => {
    const { actions, stores } = setup();
    actions.select({ kind: "wall", id: level(stores.documents.getState().history.present).envelope.wallIds[0] });
    stores.session.setState((s) => ({ viewport: { ...s.viewport, scale: s.viewport.scale * 2 } }));
    expect(stores.documents.getState().history.past).toHaveLength(0);
    expect(stores.documents.getState().revision).toBe(0);
  });

  it("drops a selection whose entity disappears on undo", () => {
    const { actions, stores } = setup();
    actions.dispatch({ type: "addWall", wallId: "v", start: { x: 4, y: AXIS.south }, end: { x: 4, y: AXIS.north }, thickness: 0.1 });
    actions.select({ kind: "wall", id: "v" });
    actions.undo();
    expect(stores.session.getState().selection).toBeNull();
  });
});
