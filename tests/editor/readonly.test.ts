import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import type { Point2 } from "@/domain/plan/types";
import { readOnlyFor } from "@/editor/components/shell/phone";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { createToolController } from "@/editor/tools/controller";
import { fitRect, worldToScreen } from "@/editor/viewport/viewport";
import { AXIS, level, newHouse } from "../helpers";

function setup() {
  const stores = createEditorStores(newHouse());
  const actions = createEditorActions(stores);
  const controller = createToolController(stores, actions);
  stores.session.setState((s) => ({
    viewport: { ...fitRect({ ...s.viewport, width: 1000, height: 1200 }, { minX: 0, minY: 0, maxX: 8, maxY: 10 }, 100), scale: 100 },
  }));
  const doc = () => stores.documents.getState().history.present;
  const wallAt = (x: number) => ({ type: "addWall" as const, wallId: `w${x}`, start: { x, y: AXIS.south }, end: { x, y: AXIS.north }, thickness: 0.1 });
  const input = (p: Point2) => ({ screen: worldToScreen(stores.session.getState().viewport, p), button: 0, shiftKey: false, altKey: false });
  return { stores, actions, controller, doc, wallAt, input };
}

describe("read-only phones", () => {
  it("is read-only only on narrow screens with nothing but touch", () => {
    expect(readOnlyFor({ narrow: true, coarse: true, anyFine: false })).toBe(true);
    // A mouse in a narrow window, or a stylus/trackpad alongside touch, still edits.
    expect(readOnlyFor({ narrow: true, coarse: false, anyFine: true })).toBe(false);
    expect(readOnlyFor({ narrow: true, coarse: true, anyFine: true })).toBe(false);
    // A landscape tablet keeps the editor.
    expect(readOnlyFor({ narrow: false, coarse: true, anyFine: false })).toBe(false);
  });

  it("refuses every way a plan can change: commands, gestures, undo and redo", () => {
    const { stores, actions, doc, wallAt } = setup();
    expect(actions.dispatch(wallAt(4)).ok).toBe(true);
    actions.undo();
    const before = doc();
    const history = stores.documents.getState().history;
    actions.setReadOnly(true);

    const refused = actions.dispatch(wallAt(3));
    expect(refused).toMatchObject({ ok: false, issues: [{ code: "read-only" }] });
    expect(actions.preview(wallAt(3)).ok).toBe(false);
    expect(stores.documents.getState().preview).toBeNull();
    expect(actions.commitPreview()).toBe(false);
    expect(actions.redo()).toBe(false);
    expect(actions.undo()).toBe(false);
    expect(doc()).toBe(before);
    expect(stores.documents.getState().history).toBe(history);
  });

  it("drops a gesture in progress when it turns on, and allows select only", () => {
    const { stores, actions, wallAt } = setup();
    actions.setTool("wall");
    actions.preview(wallAt(3));
    expect(stores.documents.getState().preview).not.toBeNull();
    actions.setReadOnly(true);
    expect(stores.documents.getState().preview).toBeNull();
    expect(stores.session.getState().tool).toBe("select");
    actions.setTool("wall");
    expect(stores.session.getState().tool).toBe("select");
  });

  it("turns a drag on the plan into a pan instead of an edit", () => {
    const { stores, actions, controller, doc, input } = setup();
    actions.setReadOnly(true);
    const before = doc();
    const viewport = stores.session.getState().viewport;
    // Drag the west wall: editing would move it; read-only pans the view.
    const from = { x: AXIS.west, y: 5 };
    controller.pointerMove(input(from));
    controller.pointerDown(input(from));
    for (let i = 1; i <= 6; i++) controller.pointerMove({ ...input(from), screen: { x: input(from).screen.x + i * 20, y: input(from).screen.y } });
    controller.pointerUp();
    expect(doc()).toBe(before);
    expect(stores.session.getState().viewport.offsetX).not.toBe(viewport.offsetX);
  });

  it("still allows the brief, plot and switching plans", () => {
    const { stores, actions } = setup();
    const copy = actions.duplicatePlan(undefined, false)!;
    actions.setReadOnly(true);
    actions.setBrief({ ...DEFAULT_BRIEF, bedrooms: 4 });
    expect(stores.project.getState().brief.bedrooms).toBe(4);
    actions.setSizing({ footprint: "auto", plot: { maxWidth: 14 } });
    expect(stores.project.getState().sizing?.plot?.maxWidth).toBe(14);
    expect(actions.switchPlan(copy)).toBe(true);
    expect(stores.project.getState().activePlanId).toBe(copy);
    expect(level(stores.documents.getState().history.present)).toBeDefined();
  });
});
