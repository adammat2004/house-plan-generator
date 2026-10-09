import { describe, expect, it } from "vitest";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Point2 } from "@/domain/plan/types";
import { createToolController } from "@/editor/tools/controller";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { fitRect, worldToScreen } from "@/editor/viewport/viewport";
import { AXIS, level, newHouse } from "../helpers";

/** North wall runs east → west, so its parameter s is measured from x = AXIS.east. */
const north = (s: number): Point2 => ({ x: AXIS.east - s, y: AXIS.north });

function setup() {
  const stores = createEditorStores(newHouse());
  const actions = createEditorActions(stores);
  const controller = createToolController(stores, actions);
  // 100 px/m, so the 8 px snap radius is 0.08 m.
  stores.session.setState((s) => ({
    viewport: { ...fitRect({ ...s.viewport, width: 1000, height: 1200 }, { minX: 0, minY: 0, maxX: 8, maxY: 10 }, 100), scale: 100 },
  }));
  const northWallId = level(stores.documents.getState().history.present).envelope.wallIds[2];
  actions.dispatch({
    type: "addOpening",
    opening: { id: "w1", wallId: northWallId, kind: "window", offset: 3, width: 1.2, height: 1.2, sillHeight: 0.9 },
  });
  const doc = () => stores.documents.getState().history.present;
  const screen = (p: Point2) => worldToScreen(stores.session.getState().viewport, p);
  const input = (p: Point2) => ({ screen: screen(p), button: 0, shiftKey: false, altKey: false });
  const drag = (from: Point2, to: Point2, finish: "up" | "cancel" = "up") => {
    controller.pointerMove(input(from));
    controller.pointerDown(input(from));
    for (let i = 1; i <= 6; i++) {
      controller.pointerMove(input({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }));
    }
    if (finish === "cancel") controller.cancel();
    controller.pointerUp();
  };
  return { stores, actions, controller, doc, drag };
}

describe("opening direct manipulation", () => {
  it("resizes a selected opening by dragging an edge, as one history entry", () => {
    const { stores, actions, doc, drag } = setup();
    actions.select({ kind: "opening", id: "w1" });
    const before = stores.documents.getState().history.past.length;
    drag(north(3), north(2.6));
    const w = level(doc()).openings.w1;
    expect(w.offset).toBeCloseTo(2.6, 9);
    expect(w.width).toBeCloseTo(1.6, 9);
    expect(stores.documents.getState().history.past.length).toBe(before + 1);
    expect(stores.session.getState().drag).toBeNull();

    // The far edge keeps the near edge fixed.
    drag(north(4.2), north(4.5));
    expect(level(doc()).openings.w1).toMatchObject({ offset: 2.6, width: 1.9 });
  });

  it("cancels an edge drag with Escape without touching the document", () => {
    const { stores, actions, doc, drag } = setup();
    actions.select({ kind: "opening", id: "w1" });
    const original = doc();
    drag(north(3), north(2.2), "cancel");
    expect(doc()).toBe(original);
    expect(stores.documents.getState().preview).toBeNull();
  });

  it("snaps a dragged opening to the centre of its stretch of wall", () => {
    const { stores, doc, drag } = setup();
    // The north wall's clear stretch runs from s = 0.15 to 7.55 between the corners; its centre is 3.85.
    let snapped: string | null = null;
    const unsubscribe = stores.session.subscribe((s) => {
      if (s.snap) snapped = s.snap.kind;
    });
    drag(north(3.6), north(3.82));
    unsubscribe();
    expect(level(doc()).openings.w1.offset).toBeCloseTo(3.85 - 0.6, 9);
    expect(snapped).toBe("centre");
  });
});

describe("workspaces", () => {
  it("picks whole rooms in Design and keeps shell tools in Structure", () => {
    const { stores, actions, controller, drag } = setup();
    actions.setWorkspace("design");
    // Designs refines rooms with walls and doors; windows belong to the shell.
    actions.setTool("window");
    expect(stores.session.getState().tool).toBe("select");
    actions.setTool("wall");
    expect(stores.session.getState().tool).toBe("wall");
    actions.setTool("select");

    // Clicks pick the room as a whole.
    drag({ x: 2, y: 5 }, { x: 2, y: 5 });
    expect(stores.session.getState().selection?.kind).toBe("room");
    controller.cancel();

    actions.setWorkspace("structure");
    actions.setTool("window");
    expect(stores.session.getState().tool).toBe("window");
  });

  it("shows the plan for reference in the brief: drags pan and nothing is selected", () => {
    const { stores, actions, drag } = setup();
    actions.select({ kind: "room", id: Object.keys(stores.documents.getState().history.present.levels[0].rooms)[0] });
    actions.setWorkspace("brief");
    expect(stores.session.getState().selection).toBeNull();
    actions.setTool("wall");
    expect(stores.session.getState().tool).toBe("select");
    const before = stores.session.getState().viewport;
    drag({ x: 2, y: 5 }, { x: 3, y: 5 });
    expect(stores.session.getState().selection).toBeNull();
    expect(stores.session.getState().viewport.offsetX).not.toBe(before.offsetX);
  });

  it("drops non-room selections when entering Design", () => {
    const { stores, actions } = setup();
    actions.select({ kind: "opening", id: "w1" });
    actions.setWorkspace("design");
    expect(stores.session.getState().selection).toBeNull();
  });
});

describe("reshaping the outline on the canvas", () => {
  const click = (ctx: ReturnType<typeof setup>, p: Point2) => {
    ctx.controller.pointerMove({ screen: worldToScreen(ctx.stores.session.getState().viewport, p), button: 0, shiftKey: false, altKey: false });
    ctx.controller.pointerDown({ screen: worldToScreen(ctx.stores.session.getState().viewport, p), button: 0, shiftKey: false, altKey: false });
    ctx.controller.pointerUp();
  };
  const altDrag = (ctx: ReturnType<typeof setup>, from: Point2, to: Point2) => {
    const input = (p: Point2) => ({ screen: worldToScreen(ctx.stores.session.getState().viewport, p), button: 0, shiftKey: false, altKey: true });
    ctx.controller.pointerMove(input(from));
    ctx.controller.pointerDown(input(from));
    for (let i = 1; i <= 6; i++) ctx.controller.pointerMove(input({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }));
    ctx.controller.pointerUp();
  };
  const outside = (ctx: ReturnType<typeof setup>) => {
    const env = analyzeEnvelope(level(ctx.doc()));
    return env.ok ? env.info : null;
  };

  it("drags an outside wall out as one undoable step", () => {
    const ctx = setup();
    const before = ctx.stores.documents.getState().history.past.length;
    ctx.drag({ x: AXIS.east, y: 5 }, { x: AXIS.east + 1, y: 5 });
    expect(outside(ctx)?.width).toBeCloseTo(9, 9);
    expect(ctx.stores.documents.getState().history.past.length).toBe(before + 1);
    expect(ctx.stores.session.getState().drag).toBeNull();
  });

  it("cuts a notch by dragging a corner of the selected outline", () => {
    const ctx = setup();
    click(ctx, north(1));
    expect(ctx.stores.session.getState().selection?.kind).toBe("wall");
    ctx.drag({ x: AXIS.east, y: AXIS.north }, { x: AXIS.east - 2, y: AXIS.north - 2 });
    const info = outside(ctx)!;
    expect(info.family).toBe("L");
    expect(level(ctx.doc()).envelope.wallIds).toHaveLength(6);
    // The window further along the north wall stays where it was.
    expect(level(ctx.doc()).openings.w1).toBeDefined();
  });

  it("pushes out a bay with Alt, and leaves the plan alone when cancelled", () => {
    const ctx = setup();
    altDrag(ctx, { x: AXIS.east, y: 5 }, { x: AXIS.east + 1, y: 5 });
    expect(level(ctx.doc()).envelope.wallIds).toHaveLength(8);
    expect(outside(ctx)?.family).toBe("T");
    const original = ctx.doc();
    ctx.drag({ x: AXIS.west, y: 5 }, { x: AXIS.west - 1, y: 5 }, "cancel");
    expect(ctx.doc()).toBe(original);
  });
});

describe("drawing an outline", () => {
  const L = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 5.5 },
    { x: 5.5, y: 5.5 },
    { x: 5.5, y: 11 },
    { x: 0, y: 11 },
  ];
  const clickAt = (ctx: ReturnType<typeof setup>, p: Point2) => {
    const input = { screen: worldToScreen(ctx.stores.session.getState().viewport, p), button: 0, shiftKey: false, altKey: false };
    ctx.controller.pointerMove(input);
    ctx.controller.pointerDown(input);
    ctx.controller.pointerUp();
  };

  it("asks before an outline replaces a house with doors and windows, then builds it as one step", () => {
    const ctx = setup();
    ctx.actions.setTool("outline");
    const before = ctx.stores.documents.getState().history.past.length;
    for (const p of L) clickAt(ctx, p);
    expect(ctx.stores.session.getState().outlineDraft?.points).toHaveLength(6);
    expect(ctx.stores.session.getState().outlineDraft?.problem).toBeNull();
    clickAt(ctx, L[0]);
    expect(ctx.stores.session.getState().outlineConfirm?.outline).toEqual(L);
    ctx.controller.confirmOutline(false);
    expect(level(ctx.doc()).envelope.wallIds).toHaveLength(4);
    for (const p of L) clickAt(ctx, p);
    ctx.controller.finishOutline();
    ctx.controller.confirmOutline(true);
    expect(level(ctx.doc()).envelope.wallIds).toHaveLength(6);
    expect(ctx.stores.session.getState().tool).toBe("select");
    expect(ctx.stores.documents.getState().history.past.length).toBe(before + 1);
  });

  it("keeps walls straight, closes the last corner itself, and takes corners back", () => {
    const stores = createEditorStores(newHouse());
    const actions = createEditorActions(stores);
    const controller = createToolController(stores, actions);
    stores.session.setState((s) => ({ viewport: { ...fitRect({ ...s.viewport, width: 1000, height: 1200 }, { minX: 0, minY: 0, maxX: 12, maxY: 12 }, 100), scale: 80 } }));
    const ctx = { stores, actions, controller, doc: () => stores.documents.getState().history.present } as unknown as ReturnType<typeof setup>;
    actions.setTool("outline");
    clickAt(ctx, { x: 0, y: 0 });
    // A wobbly click still makes a straight wall.
    clickAt(ctx, { x: 10, y: 0.3 });
    expect(stores.session.getState().outlineDraft?.points[1]).toEqual({ x: 10, y: 0 });
    clickAt(ctx, { x: 10, y: 4 });
    clickAt(ctx, { x: 6, y: 4 });
    clickAt(ctx, { x: 99, y: 99 });
    controller.undoOutlineCorner();
    expect(stores.session.getState().outlineDraft?.points).toHaveLength(4);
    clickAt(ctx, { x: 6, y: 9 });
    // Enter closes it with the one corner it needs, and an empty house needs no asking.
    controller.finishOutline();
        expect(stores.session.getState().outlineConfirm).toBeNull();
    const env = analyzeEnvelope(level(stores.documents.getState().history.present));
    expect(env.ok && env.info.outsideRing).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 9 },
      { x: 0, y: 9 },
    ]);
    // Escape drops a half-drawn outline.
    actions.setTool("outline");
    clickAt(ctx, { x: 1, y: 1 });
    expect(controller.cancel()).toBe(true);
    expect(stores.session.getState().outlineDraft).toBeNull();
  });
});
