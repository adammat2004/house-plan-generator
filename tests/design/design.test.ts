import { describe, expect, it } from "vitest";
import { createStripPlanner } from "@/domain/design/stripPlanner";
import { createDesignActions } from "@/editor/state/design";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { apply, level, newHouse } from "../helpers";

function setup() {
  const doc = newHouse();
  const stores = createEditorStores(apply(doc, { type: "setRearWall", wallId: level(doc).envelope.wallIds[2] }));
  const actions = createEditorActions(stores);
  const design = createDesignActions(stores, actions, createStripPlanner());
  return { stores, actions, design };
}

describe("AI designer workflow", () => {
  it("adds generated layouts as new plans and never changes the source plan", async () => {
    const { stores, actions, design } = setup();
    const sourceId = stores.project.getState().activePlanId;
    const source = actions.current();
    const ids = await design.generateLayouts();
    expect(ids).toHaveLength(3);
    const project = stores.project.getState();
    expect(project.plans.map((p) => p.label)).toEqual(["My plan", "Plan A", "Plan B", "Plan C"]);
    expect(project.activePlanId).toBe(ids[0]);
    for (const plan of project.plans.slice(1)) {
      expect(plan.parentId).toBe(sourceId);
      expect(plan.origin).toMatchObject({ kind: "generated", planner: "strip-planner-v1" });
      expect(plan.scope).toEqual({ kind: "plan" });
    }
    expect(project.parked[sourceId].present).toBe(source);
    // Generated plans are ordinary editable plans with their own undo.
    expect(stores.documents.getState().history.past).toHaveLength(0);
    expect(stores.session.getState().designer.lastResult?.tone).toBe("success");
  });

  it("generates more layouts in new arrangements, and regenerate keeps edited concepts", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts();
    const first = stores.project.getState().plans.slice(1);
    const more = await design.generateMore();
    expect(more.length).toBeGreaterThan(0);
    const arrangements = stores.project.getState().plans.map((p) => (p.origin.kind === "generated" ? p.origin.arrangement : null)).filter(Boolean);
    expect(new Set(arrangements).size).toBe(arrangements.length);

    // Edit concept A; regenerate replaces the untouched generated ones only.
    actions.switchPlan(first[0].id);
    const room = Object.values(level(actions.current()).rooms)[0];
    actions.dispatch({ type: "updateRoom", roomId: room.id, changes: { name: "Edited" } });
    await design.regenerate();
    const plans = stores.project.getState().plans;
    expect(plans.find((p) => p.id === first[0].id)).toBeDefined();
    expect(plans.filter((p) => p.id !== first[0].id && first.some((f) => f.id === p.id))).toEqual([]);
    expect(plans.filter((p) => p.origin.kind === "generated")).toHaveLength(4);
    // New layouts always hang off the user's own plan.
    expect(plans.filter((p) => p.origin.kind === "generated").every((p) => p.parentId === plans[0].id)).toBe(true);
  });

  it("offers room changes as proposals, applied as one undoable edit", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts(1);
    const before = actions.current();
    const bedroom = Object.values(level(before).rooms).find((r) => r.type === "primary_bedroom")!;
    const proposals = await design.redesignRoom(bedroom.id, ["make_larger"]);
    expect(proposals.length).toBeGreaterThan(0);
    // Nothing changes until a proposal is applied.
    expect(actions.current()).toBe(before);
    const chat = stores.session.getState().designer.chat;
    expect(chat.map((m) => m.role)).toEqual(["user", "assistant"]);

    expect(design.applyProposal(proposals[0].id)).toBe(true);
    expect(actions.current()).not.toBe(before);
    expect(stores.session.getState().designer.chat[1].proposals![0].state).toBe("applied");
    actions.undo();
    expect(actions.current()).toBe(before);

    // A proposal made from an older plan is refused rather than discarding edits.
    expect(design.applyProposal(proposals[1]?.id ?? proposals[0].id)).toBe(false);
  });

  it("saves a proposal as a separate concept without changing the plan", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts(1);
    const before = actions.current();
    const bedroom = Object.values(level(before).rooms).find((r) => r.type === "primary_bedroom")!;
    const [proposal] = await design.openRoomVariations(bedroom.id);
    const id = design.saveProposal(proposal.id);
    expect(id).toBeTruthy();
    expect(actions.current()).toBe(before);
    expect(stores.project.getState().plans.find((p) => p.id === id)?.scope).toMatchObject({ kind: "rooms" });
  });

  it("opens room variations beside the room, adds more, and applies one as an undoable edit", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts(1);
    const before = actions.current();
    const kitchen = Object.values(level(before).rooms).find((r) => r.type === "kitchen" || r.type === "kitchen_dining")!;
    const options = await design.openRoomVariations(kitchen.id);
    expect(options).toHaveLength(3);
    const v = stores.session.getState().variations!;
    expect(stores.session.getState().designView).toBe("variations");
    expect(v).toMatchObject({ roomId: kitchen.id, focusId: options[0].id, compare: null });
    expect(actions.current()).toBe(before);

    const more = await design.moreVariations();
    expect(more.length).toBeGreaterThan(0);
    const keys = stores.session.getState().variations!.options.map((o) => o.variant);
    expect(new Set(keys).size).toBe(keys.length);

    expect(design.applyProposal(options[0].id)).toBe(true);
    expect(stores.session.getState()).toMatchObject({ designView: "plan", variations: null, selection: { kind: "room" } });
    actions.undo();
    expect(actions.current()).toBe(before);
  });

  it("explains room goals it can't act on yet", async () => {
    const { stores, design } = setup();
    const roomId = Object.keys(level(stores.documents.getState().history.present).rooms)[0];
    expect(await design.redesignRoom(roomId, ["improve_privacy"])).toEqual([]);
    expect(stores.project.getState().plans).toHaveLength(1);
    expect(stores.session.getState().designer.chat.at(-1)?.text).toMatch(/privacy/i);
  });

  it("swaps two rooms' uses in one undoable step", async () => {
    const { actions, design } = setup();
    await design.generateLayouts(1);
    const rooms = Object.values(level(actions.current()).rooms);
    const [a, b] = [rooms.find((r) => r.type === "primary_bedroom")!, rooms.find((r) => r.type === "bedroom")!];
    expect(design.swapRooms(a.id, b.id)).toBe(true);
    const after = level(actions.current()).rooms;
    expect(after[a.id]).toMatchObject({ name: b.name, type: b.type });
    expect(after[b.id]).toMatchObject({ name: a.name, type: a.type });
    expect(actions.undo()).toBe(true);
    expect(level(actions.current()).rooms[a.id].name).toBe(a.name);
  });

  it("turns a typed request into room options and brief changes", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts(1);
    const before = actions.current();
    await design.ask("Make the kitchen larger and add a utility room");
    const chat = stores.session.getState().designer.chat;
    expect(chat[0]).toMatchObject({ role: "user" });
    expect(chat.some((m) => m.proposals?.length)).toBe(true);
    expect(chat.at(-1)).toMatchObject({ offerGenerate: true });
    expect(stores.project.getState().brief.requiredSpaces).toContain("utility");
    // Asking never edits the plan by itself.
    expect(actions.current()).toBe(before);
  });
});
