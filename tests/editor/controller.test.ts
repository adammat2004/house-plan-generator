import { describe, expect, it } from "vitest";
import { roomEdgeHandles } from "@/domain/design/analysis";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Point2 } from "@/domain/plan/types";
import { createToolController } from "@/editor/tools/controller";
import { buildPlanScene } from "@/editor/rendering/scene/planScene";
import { createEditorActions, createEditorStores, displayedDocument } from "@/editor/state/stores";
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
  it("edits everything in Refine and nothing on the layouts board", () => {
    const { stores, actions, drag } = setup();
    for (const tool of ["window", "outline", "wall", "door", "stairs", "select"] as const) {
      actions.setTool(tool);
      expect(stores.session.getState().tool).toBe(tool);
    }
    // Clicks inside a room pick the room as a whole.
    drag({ x: 2, y: 5 }, { x: 2, y: 5 });
    expect(stores.session.getState().selection?.kind).toBe("room");

    actions.setDesignView("board");
    actions.setTool("wall");
    expect(stores.session.getState().tool).toBe("select");
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

  it("picks furniture only in the furnished view, and switching to the plan view drops it", () => {
    const { stores, actions, drag, doc } = setup();
    actions.dispatch({ type: "addFurniture", item: { id: "f1", kind: "armchair", position: { x: 2, y: 5 }, rotation: 0, width: 0.8, depth: 0.8, height: 0.8 } });
    actions.setView("plan");
    drag({ x: 2, y: 5 }, { x: 2, y: 5 });
    expect(stores.session.getState().selection?.kind).toBe("room");
    actions.setView("furnished");
    drag({ x: 2, y: 5 }, { x: 2, y: 5 });
    expect(stores.session.getState().selection).toEqual({ kind: "furniture", id: "f1" });
    actions.setView("plan");
    expect(stores.session.getState().selection).toBeNull();
    // Picking a piece from a list shows the furnished view again.
    actions.select({ kind: "furniture", id: "f1" });
    expect(stores.session.getState().view).toBe("furnished");
    expect(level(doc()).furniture.f1).toBeDefined();
  });

  it("keeps a room picked going to Review and back, and through the 3D view", () => {
    const { stores, actions, doc } = setup();
    const room = { kind: "room" as const, id: Object.keys(level(doc()).rooms)[0] };
    actions.select(room);
    actions.setShow3d(true);
    expect(stores.session.getState().selection).toEqual(room);
    actions.setShow3d(false);
    actions.setWorkspace("review");
    actions.setWorkspace("design");
    expect(stores.session.getState().selection).toEqual(room);
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

  it("drags a selected outside wall out as one undoable step", () => {
    const ctx = setup();
    // The first press picks the wall, so a stray drag can't move a side of the house.
    const original = ctx.doc();
    ctx.drag({ x: AXIS.east, y: 5 }, { x: AXIS.east + 1, y: 5 });
    expect(ctx.doc()).toBe(original);
    expect(ctx.stores.session.getState().selection?.kind).toBe("wall");
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

describe("dragging walls, doors and windows in Refine", () => {
  /** The test house split by an internal wall at x = 3, with a door in it. */
  function designing() {
    const ctx = setup();
    ctx.actions.dispatch({ type: "addWall", wallId: "v", start: { x: 3, y: AXIS.south }, end: { x: 3, y: AXIS.north }, thickness: 0.1, idPrefix: "v" });
    ctx.actions.dispatch({
      type: "addOpening",
      opening: { id: "d1", wallId: "v", kind: "door", offset: 2, width: 0.9, height: 2.1, hinge: "start", swingSide: "left" },
    });
    ctx.actions.setTool("select");
    return ctx;
  }
  const wallX = (ctx: ReturnType<typeof setup>) => level(ctx.doc()).vertices[level(ctx.doc()).walls.v.startVertexId].x;
  const roomOn = (ctx: ReturnType<typeof setup>, west: boolean) => Object.values(level(ctx.doc()).rooms).find((r) => (west ? r.seed.x < 3 : r.seed.x > 3))!;

  it("drags an internal wall as one undoable step, and Escape cancels", () => {
    const ctx = designing();
    const before = ctx.stores.documents.getState().history.past.length;
    ctx.drag({ x: 3.02, y: 7 }, { x: 3.52, y: 7 });
    expect(wallX(ctx)).toBeCloseTo(3.5, 9);
    expect(ctx.stores.documents.getState().history.past.length).toBe(before + 1);
    expect(ctx.stores.session.getState().selection).toEqual({ kind: "wall", id: "v" });
    ctx.actions.undo();
    expect(wallX(ctx)).toBe(3);

    const original = ctx.doc();
    ctx.drag({ x: 3, y: 7 }, { x: 4, y: 7 }, "cancel");
    expect(ctx.doc()).toBe(original);
    expect(ctx.stores.documents.getState().preview).toBeNull();
  });

  it("shows both rooms' areas changing while the wall is dragged", () => {
    const ctx = designing();
    const areas = () =>
      buildPlanScene(level(displayedDocument(ctx.stores.documents.getState())))
        .rooms.map((r) => r.areaLabel)
        .sort();
    const before = areas();
    const at = (x: number) => ({ screen: worldToScreen(ctx.stores.session.getState().viewport, { x, y: 7 }), button: 0, shiftKey: false, altKey: false });
    ctx.controller.pointerMove(at(3.02));
    ctx.controller.pointerDown(at(3.02));
    ctx.controller.pointerMove(at(3.3));
    ctx.controller.pointerMove(at(3.52));
    const during = areas();
    expect(during[0]).not.toBe(before[0]);
    expect(during[1]).not.toBe(before[1]);
    ctx.controller.pointerUp();
    expect(areas()).toEqual(during);
  });

  it("picks the wall when clicked on it, and the room when clicked just beside it", () => {
    const ctx = designing();
    ctx.drag({ x: 3.02, y: 7 }, { x: 3.02, y: 7 });
    expect(ctx.stores.session.getState().selection).toEqual({ kind: "wall", id: "v" });
    ctx.drag({ x: 2.9, y: 7 }, { x: 2.9, y: 7 });
    expect(ctx.stores.session.getState().selection).toEqual({ kind: "room", id: roomOn(ctx, true).id });
    ctx.drag({ x: 3.1, y: 7 }, { x: 3.1, y: 7 });
    expect(ctx.stores.session.getState().selection).toEqual({ kind: "room", id: roomOn(ctx, false).id });
    expect(wallX(ctx)).toBe(3);
  });

  it("drags a door along its wall", () => {
    const ctx = designing();
    ctx.drag({ x: 3, y: AXIS.south + 2.45 }, { x: 3, y: AXIS.south + 3.45 });
    expect(level(ctx.doc()).openings.d1.offset).toBeCloseTo(3, 1);
    expect(wallX(ctx)).toBe(3);
  });

  it("looks without editing outside Refine: clicks pick rooms and drags move nothing", () => {
    const ctx = designing();
    ctx.actions.setWorkspace("review");
    const original = ctx.doc();
    ctx.drag({ x: 3.02, y: 7 }, { x: 3.52, y: 7 });
    expect(ctx.doc()).toBe(original);
    expect(ctx.stores.session.getState().selection?.kind).toBe("room");
    expect(ctx.stores.documents.getState().preview).toBeNull();
  });

  it("refuses to move a wall of a pinned room, and says why", () => {
    const ctx = designing();
    const west = roomOn(ctx, true);
    ctx.actions.dispatch({ type: "updateRoom", roomId: west.id, changes: { locked: true } });
    const original = ctx.doc();
    let issue: string | null = null;
    const unsubscribe = ctx.stores.documents.subscribe((s) => {
      if (s.preview?.issue) issue = s.preview.issue.message;
    });
    ctx.drag({ x: 3.02, y: 7 }, { x: 3.52, y: 7 });
    unsubscribe();
    expect(ctx.doc()).toBe(original);
    expect(issue).toBe(`${west.name} is pinned. Unpin it to change it.`);
  });
});

describe("moving round the plan and handling things directly", () => {
  it("pans with a plain scroll, and zooms about the pointer with Control or a pinch", () => {
    const { stores, controller } = setup();
    const v0 = stores.session.getState().viewport;
    controller.wheel({ x: 300, y: 300 }, 20, 50, false);
    const v1 = stores.session.getState().viewport;
    expect(v1.scale).toBe(v0.scale);
    expect(v1.offsetX).toBe(v0.offsetX - 20);
    expect(v1.offsetY).toBe(v0.offsetY - 50);
    const under = { x: (300 - v1.offsetX) / v1.scale, y: -(300 - v1.offsetY) / v1.scale };
    controller.wheel({ x: 300, y: 300 }, 0, -100, true);
    const v2 = stores.session.getState().viewport;
    expect(v2.scale).toBeGreaterThan(v1.scale);
    // The point under the pointer stays put.
    expect(under.x * v2.scale + v2.offsetX).toBeCloseTo(300, 6);
    expect(-under.y * v2.scale + v2.offsetY).toBeCloseTo(300, 6);
  });

  it("drags a picked room's side by its grip as one undoable step, keeping the room picked", () => {
    const { stores, actions, controller, doc, drag } = setup();
    actions.dispatch({ type: "addWall", wallId: "v", start: { x: 3, y: AXIS.south }, end: { x: 3, y: AXIS.north }, thickness: 0.1, idPrefix: "v" });
    const west = Object.values(level(doc()).rooms).find((r) => r.seed.x < 3)!;
    actions.select({ kind: "room", id: west.id });
    const grip = roomEdgeHandles(level(doc()), west.id).find((h) => h.side === "east")!;
    expect(grip.wallId).toBe("v");
    const before = stores.documents.getState().history.past.length;
    drag(grip.point, { x: grip.point.x + 0.5, y: grip.point.y });
    const x = level(doc()).vertices[level(doc()).walls.v.startVertexId].x;
    expect(x).toBeCloseTo(3.5, 9);
    expect(stores.documents.getState().history.past.length).toBe(before + 1);
    expect(stores.session.getState().selection).toEqual({ kind: "room", id: west.id });
    controller.cancel();
  });

  it("resizes a picked piece of furniture from a corner, its opposite corner staying put", () => {
    const { stores, actions, doc, drag } = setup();
    actions.dispatch({ type: "addFurniture", item: { id: "t", kind: "dining_set_6", position: { x: 4, y: 5 }, rotation: 0, width: 1.6, depth: 0.9, height: 0.75 } });
    actions.setView("furnished");
    actions.select({ kind: "furniture", id: "t" });
    drag({ x: 4.8, y: 5.45 }, { x: 5.2, y: 5.65 });
    const t = level(doc()).furniture.t;
    expect(t.width).toBeCloseTo(2, 2);
    expect(t.depth).toBeCloseTo(1.1, 2);
    // The south-west corner (3.2, 4.55) didn't move.
    expect(t.position.x - t.width / 2).toBeCloseTo(3.2, 6);
    expect(t.position.y - t.depth / 2).toBeCloseTo(4.55, 6);
    expect(stores.session.getState().selection).toEqual({ kind: "furniture", id: "t" });
  });
});
