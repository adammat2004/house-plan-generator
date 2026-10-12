import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { createStripPlanner, planLayouts } from "@/domain/design/stripPlanner";
import { createDesignActions } from "@/editor/state/design";
import { createRoomOptions } from "@/editor/state/roomOptions";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { apply, level, newHouse } from "../helpers";

const withRear = () => apply(newHouse(10, 12), { type: "setRearWall", wallId: level(newHouse(10, 12)).envelope.wallIds[2] });
const layout = () => planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 1 }, source: withRear(), brief: DEFAULT_BRIEF, idPrefix: "t" }).candidates[0].document;
const settle = () => new Promise((resolve) => setTimeout(resolve, 450));

function setup() {
  const stores = createEditorStores(layout());
  const actions = createEditorActions(stores);
  const planner = createStripPlanner();
  const design = createDesignActions(stores, actions, planner);
  const options = createRoomOptions(stores, planner, design.remember);
  const kitchen = Object.values(level(actions.current()).rooms).find((r) => r.type === "kitchen_dining" || r.type === "kitchen")!;
  return { stores, actions, design, options, kitchen };
}

/** Waits until every goal has an answer (or a time limit passes). */
async function answered(options: ReturnType<typeof setup>["options"]) {
  for (let i = 0; i < 40; i++) {
    const goals = options.store.getState().goals;
    if (goals.length && goals.every((g) => g.status !== "checking")) return goals;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return options.store.getState().goals;
}

describe("the inspector's room options", () => {
  it("works out each goal for the picked room, after a moment, as checked options", async () => {
    const { stores, actions, design, options, kitchen } = setup();
    let busy = false;
    stores.session.subscribe((s) => (busy ||= s.designer.status === "running"));
    actions.select({ kind: "room", id: kitchen.id });
    expect(options.store.getState().goals.every((g) => g.status === "checking")).toBe(true);
    const goals = await answered(options);
    expect(goals.length).toBeGreaterThan(1);
    const ready = goals.filter((g) => g.status === "ready");
    expect(ready.length).toBeGreaterThan(0);
    for (const g of ready) {
      for (const p of g.proposals) {
        // Each is an option the planner built, ready to look at and apply.
        expect(p.source).toBe(actions.current());
        expect(design.statusOf(p)).toBe("open");
      }
    }
    // It never makes the AI Designer busy, and never changes the plan.
    expect(busy).toBe(false);
    expect(stores.documents.getState().history.past).toHaveLength(0);
  });

  it("keeps answers per plan and room, and starts again when the plan changes", async () => {
    const { actions, options, kitchen } = setup();
    actions.select({ kind: "room", id: kitchen.id });
    const first = await answered(options);
    actions.select(null);
    expect(options.store.getState().roomId).toBeNull();
    actions.select({ kind: "room", id: kitchen.id });
    // The same plan and room: the answers come straight back.
    expect(options.store.getState().goals).toBe(first);
    actions.dispatch({ type: "updateRoom", roomId: kitchen.id, changes: { name: "Big kitchen" } });
    expect(options.store.getState().goals.every((g) => g.status === "checking")).toBe(true);
  });

  it("does nothing while a wall is being dragged, or outside Refine", async () => {
    const { stores, actions, options, kitchen } = setup();
    stores.session.setState({ drag: "drag-wall" });
    actions.select({ kind: "room", id: kitchen.id });
    await settle();
    expect(options.store.getState().goals).toEqual([]);
    stores.session.setState({ drag: null });
    expect(options.store.getState().roomId).toBe(kitchen.id);
    actions.setWorkspace("review");
    expect(options.store.getState().roomId).toBeNull();
  });
});
