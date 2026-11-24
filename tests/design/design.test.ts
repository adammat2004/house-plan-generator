import { describe, expect, it } from "vitest";
import { neighbourRooms } from "@/domain/design/analysis";
import { createStripPlanner } from "@/domain/design/stripPlanner";
import { furnitureInRoom } from "@/domain/furniture/layout";
import { createDesignActions } from "@/editor/state/design";
import { createEditorActions, createEditorStores, displayedDocument } from "@/editor/state/stores";
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
    expect(ids).toHaveLength(5);
    const project = stores.project.getState();
    expect(project.plans.map((p) => p.label)).toEqual(["My plan", "Plan A", "Plan B", "Plan C", "Plan D", "Plan E"]);
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
    expect(plans.filter((p) => p.origin.kind === "generated")).toHaveLength(6);
    // New layouts always hang off the user's own plan.
    expect(plans.filter((p) => p.origin.kind === "generated").every((p) => p.parentId === plans[0].id)).toBe(true);
  });

  it("names each generated layout for why you'd pick it, and records how the run ended", async () => {
    const { stores, design } = setup();
    expect(stores.session.getState().designer.generation).toBeNull();
    await design.generateLayouts();
    const generated = stores.project.getState().plans.filter((p) => p.origin.kind === "generated");
    const titles = generated.map((p) => (p.origin.kind === "generated" ? p.origin.title : undefined));
    expect(titles.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
    expect(stores.session.getState().designer.generation?.phase).toBe("done");
  });

  it("keeps the layouts already there when starting again fails", async () => {
    const { stores, actions } = setup();
    const planner = createStripPlanner();
    let broken = false;
    const flaky = { ...planner, plan: (request: Parameters<typeof planner.plan>[0]) => (broken ? Promise.reject(new Error("boom")) : planner.plan(request)) };
    const design = createDesignActions(stores, actions, flaky);
    const quiet = console.error;
    console.error = () => {};
    try {
      await design.generateLayouts();
      const before = stores.project.getState().plans.map((p) => p.id);
      broken = true;
      expect(await design.regenerate()).toEqual([]);
      expect(stores.project.getState().plans.map((p) => p.id)).toEqual(before);
      expect(stores.session.getState().designer.generation).toMatchObject({ phase: "failed" });
      expect(stores.documents.getState().notice?.message).not.toMatch(/boom|planner failed/i);
    } finally {
      console.error = quiet;
    }
  });

  it("says when the rooms don't fit instead of failing", async () => {
    const { stores, actions, design } = setup();
    // Far more rooms than a fixed 8 × 10 m house can hold.
    stores.project.setState((p) => ({ brief: { ...p.brief, bedrooms: 8, bathrooms: 6 } }));
    actions.setSizing(undefined);
    const ids = await design.generateLayouts();
    expect(ids).toEqual([]);
    expect(stores.session.getState().designer.generation?.phase).toBe("nofit");
    expect(stores.session.getState().designer.generation?.message).toBeTruthy();
  });

  it("ignores a second generate while one is running", async () => {
    const { stores, design } = setup();
    const phases: string[] = [];
    const stop = stores.session.subscribe((s) => s.designer.generation && phases.push(s.designer.generation.phase));
    const [first, second] = await Promise.all([design.generateLayouts(), design.generateLayouts()]);
    stop();
    expect(first).toHaveLength(5);
    expect(phases).not.toContain("failed");
    expect(second).toEqual([]);
    expect(stores.project.getState().plans.filter((p) => p.origin.kind === "generated")).toHaveLength(5);
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
    expect(design.statusOf(proposals[0])).toBe("applied");
    // Undo puts the plan back, and the option is on offer again; redo applies it again.
    actions.undo();
    expect(actions.current()).toBe(before);
    expect(design.statusOf(proposals[0])).toBe("open");
    actions.redo();
    expect(design.statusOf(proposals[0])).toBe("applied");

    // A proposal made from an older plan is refused rather than discarding edits.
    const other = proposals[1] ?? proposals[0];
    if (other !== proposals[0]) {
      expect(design.statusOf(other)).toBe("stale");
      expect(design.applyProposal(other.id)).toBe(false);
    }
  });

  it("measures what each option changes, and lets one be looked at on the plan without changing it", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts(1);
    const before = actions.current();
    const autosaveKey = stores.documents.getState().history;
    const bedroom = Object.values(level(before).rooms).find((r) => r.type === "primary_bedroom")!;
    const [larger] = await design.redesignRoom(bedroom.id, ["make_larger"]);
    expect(larger.letter).toBe("A");
    expect(larger.impact?.areaDelta).toBeGreaterThan(0.4);
    expect(larger.impact?.areaAfter).toBeCloseTo(larger.impact!.areaBefore + larger.impact!.areaDelta, 6);

    expect(design.stage(larger.id)).toBe(true);
    // The canvas shows the option; the plan, its history and what autosave watches don't move.
    expect(displayedDocument(stores.documents.getState())).toBe(larger.document);
    expect(actions.current()).toBe(before);
    expect(stores.documents.getState().history).toBe(autosaveKey);
    // Nothing else can be changed while it's on show.
    const wall = Object.values(level(before).walls).find((w) => w.role === "internal")!;
    expect(actions.dispatch({ type: "updateWall", wallId: wall.id, height: 2.5 }).ok).toBe(false);
    actions.peekStaged(true);
    expect(displayedDocument(stores.documents.getState())).toBe(before);
    actions.peekStaged(false);
    // Undo leaves it, as Back does; applying it makes it the plan, as one undoable step.
    expect(actions.undo()).toBe(true);
    expect(stores.documents.getState().staged).toBeNull();
    expect(actions.current()).toBe(before);
    design.stage(larger.id);
    expect(design.applyProposal(larger.id)).toBe(true);
    expect(stores.documents.getState().staged).toBeNull();
    expect(stores.documents.getState().history.past.at(-1)).toBe(before);
  });

  it("lays several rooms out again as proposals, leaving the rest of the plan as it is", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts(1);
    const before = actions.current();
    const lvl = level(before);
    // Two neighbouring rooms that together make a rectangle.
    let proposals: Awaited<ReturnType<typeof design.regenerateArea>> = [];
    for (const room of Object.values(lvl.rooms).filter((r) => r.type !== "hall")) {
      for (const other of neighbourRooms(lvl, room.id).filter((id) => lvl.rooms[id].type !== "hall")) {
        proposals = await design.regenerateArea([room.id, other]);
        if (proposals.length) break;
      }
      if (proposals.length) break;
    }
    expect(proposals.length).toBeGreaterThan(0);
    expect(actions.current()).toBe(before);
    const chat = stores.session.getState().designer.chat;
    expect(chat[chat.length - 1].proposals).toHaveLength(proposals.length);
    expect(design.applyProposal(proposals[0].id)).toBe(true);
    expect(actions.current()).not.toBe(before);
    actions.undo();
    expect(actions.current()).toBe(before);
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

  it("lays both swapped rooms out again for their new use, and one undo puts both back", async () => {
    const { actions, design } = setup();
    await design.generateLayouts(1);
    const before = actions.current();
    const rooms = Object.values(level(before).rooms);
    const bedroom = rooms.find((r) => r.type === "bedroom")!;
    const day = rooms.find((r) => r.type === "living" || r.type === "kitchen_dining" || r.type === "kitchen")!;
    const kinds = (roomId: string) => furnitureInRoom(level(actions.current()), roomId).map((f) => f.kind);
    const beds = (roomId: string) => kinds(roomId).filter((k) => k.startsWith("bed_")).length;
    expect(beds(bedroom.id)).toBeGreaterThan(0);
    expect(beds(day.id)).toBe(0);

    expect(design.swapRooms(bedroom.id, day.id)).toBe(true);
    expect(level(actions.current()).rooms[day.id].type).toBe("bedroom");
    expect(beds(day.id)).toBeGreaterThan(0);
    expect(beds(bedroom.id)).toBe(0);
    expect(kinds(bedroom.id).length).toBeGreaterThan(0);

    expect(actions.undo()).toBe(true);
    expect(actions.current()).toBe(before);
  });

  it("swaps even when it makes the plan worse, and says what to check", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts(1);
    const rooms = Object.values(level(actions.current()).rooms);
    const bedroom = rooms.find((r) => r.type === "bedroom")!;
    const ensuite = rooms.find((r) => r.type === "ensuite")!;
    // A bedroom in the ensuite's little slot is too small.
    expect(design.swapRooms(bedroom.id, ensuite.id)).toBe(true);
    const notice = stores.documents.getState().notice;
    expect(notice?.tone).toBe("info");
    expect(notice?.message).toMatch(new RegExp(`^Swapped ${bedroom.name} and Ensuite\\. To check: .*${bedroom.name} is .*only`));
  });

  it("won't swap a pinned room", async () => {
    const { stores, actions, design } = setup();
    await design.generateLayouts(1);
    const rooms = Object.values(level(actions.current()).rooms);
    const [a, b] = [rooms.find((r) => r.type === "primary_bedroom")!, rooms.find((r) => r.type === "bedroom")!];
    actions.dispatch({ type: "updateRoom", roomId: b.id, changes: { locked: true } });
    const before = actions.current();
    expect(design.swapRooms(a.id, b.id)).toBe(false);
    expect(actions.current()).toBe(before);
    expect(stores.documents.getState().notice?.message).toBe(`Unpin ${b.name} to swap it.`);
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
