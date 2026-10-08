import { normaliseBrief, type HouseBrief } from "@/domain/brief/schema";
import { applyCommand } from "@/domain/commands";
import { designIntentSchema, ROOM_GOAL_LABEL, type DesignIntent, type RoomGoal } from "@/domain/design/intent";
import type { LayoutPlanner, PlanningResult } from "@/domain/design/planner";
import { interpretRequest } from "@/domain/design/request";
import type { Id, PlanDocument } from "@/domain/plan/types";
import { newIdPrefix } from "./ids";
import type { ChatMessage, EditorActions, EditorStores, Proposal } from "./stores";

/**
 * Runs design intents through a planner. Whole-plan layouts are filed as new
 * plan variants; room-level changes come back as proposals in the AI
 * Designer, applied only when the user asks (as one undoable edit) or saved
 * as a variation. This is the only place the UI talks to planners:
 * components express intent, never geometry.
 */
export function createDesignActions({ session, project }: EditorStores, actions: EditorActions, planner: LayoutPlanner) {
  const running = () => session.getState().designer.status === "running";
  let messageCounter = 0;

  const say = (message: Omit<ChatMessage, "id">) =>
    actions.setDesigner({ chat: [...session.getState().designer.chat, { ...message, id: ++messageCounter }] });

  /** Runs the planner with the UI showing progress. Null if the request was refused or another is running. */
  async function plan(intent: DesignIntent, source = actions.current()): Promise<PlanningResult | null> {
    if (running()) return null;
    const parsed = designIntentSchema.safeParse(intent);
    if (!parsed.success) {
      actions.setDesigner({ lastResult: { tone: "error", message: "That request isn't complete.", notes: [] } });
      return null;
    }
    actions.setDesigner({ status: "running" });
    // Let the UI show progress before planning starts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      return await planner.plan({ intent: parsed.data, source, brief: project.getState().brief, idPrefix: newIdPrefix() });
    } catch (error) {
      const message = `The planner failed: ${(error as Error).message}`;
      actions.setDesigner({ lastResult: { tone: "error", message, notes: [] } });
      actions.notify("error", message);
      return null;
    } finally {
      actions.setDesigner({ status: "idle" });
    }
  }

  /** Arrangements already offered in this project, so "more" brings new ones. */
  const offeredArrangements = () =>
    project
      .getState()
      .plans.map((p) => (p.origin.kind === "generated" ? p.origin.arrangement : undefined))
      .filter((a): a is string => !!a);

  async function layouts(count: number, extra: { exclude?: string[]; similarTo?: string }, describe: (n: number) => string): Promise<Id[]> {
    // Layouts grow from the user's own shell, whichever concept is open.
    const plans = project.getState().plans;
    const sourcePlanId = (plans.find((p) => p.parentId === null && p.origin.kind === "user") ?? plans[0]).id;
    const intent: DesignIntent = { action: "generate_layouts", brief: project.getState().brief, count, ...extra };
    const result = await plan(intent, actions.planDocument(sourcePlanId) ?? actions.current());
    if (!result) return [];
    if (!result.candidates.length) {
      const message = result.issues[0]?.message ?? "The planner didn't produce any layouts.";
      actions.setDesigner({ lastResult: { tone: "info", message, notes: [] } });
      actions.notify("info", message);
      return [];
    }
    const requestId = newIdPrefix();
    const ids = actions.addPlans(
      result.candidates.map((c) => ({
        document: c.document,
        meta: {
          parentId: sourcePlanId,
          origin: { kind: "generated", requestId, planner: planner.id, seed: c.seed, summary: c.summary, notes: c.notes, arrangement: c.arrangement },
          scope: { kind: "plan" },
        },
      })),
    );
    if (!ids.length) return [];
    const notes = [...new Set(result.candidates.flatMap((c) => c.notes))];
    const message = describe(ids.length);
    actions.setDesigner({ lastResult: { tone: "success", message, notes }, focusPlanId: ids[0] });
    actions.notify("success", message);
    return ids;
  }

  /** Room-level options, reported in the AI Designer chat. */
  async function propose(roomId: Id, goals: RoomGoal[], count = 3): Promise<Proposal[]> {
    const room = actions.current().levels[0].rooms[roomId];
    if (!room) return [];
    actions.setDesigner({ panelOpen: true });
    const source = actions.current();
    const result = await plan(goals.length ? { action: "redesign_room", roomId, goals } : { action: "room_variations", roomIds: [roomId], goals, count });
    if (!result) return [];
    if (!result.candidates.length) {
      say({ role: "assistant", text: result.issues[0]?.message ?? `I couldn't find a change to ${room.name}.` });
      return [];
    }
    const proposals = toProposals(result, source, roomId);
    const notes = [...new Set(result.candidates.flatMap((c) => c.notes))];
    const what = goals.length ? goals.map((g) => ROOM_GOAL_LABEL[g].toLowerCase()).join(", ") : "variations";
    say({ role: "assistant", text: `Here ${proposals.length === 1 ? "is an option" : `are ${proposals.length} options`} for ${room.name.toLowerCase()} (${what}).${notes.length ? ` ${notes.join(" ")}` : ""}`, proposals });
    return proposals;
  }

  const toProposals = (result: PlanningResult, source: PlanDocument, roomId: Id): Proposal[] =>
    result.candidates.map((c) => ({
      id: newIdPrefix(),
      title: c.title ?? c.summary,
      summary: c.summary,
      goal: c.goal,
      variant: c.variant,
      document: c.document,
      roomIds: c.changedRoomIds ?? [roomId],
      source,
      state: "open",
    }));

  const updateProposal = (proposalId: string, state: Proposal["state"]) => {
    const mark = (list: Proposal[]) => list.map((p) => (p.id === proposalId ? { ...p, state } : p));
    actions.setDesigner({ chat: session.getState().designer.chat.map((m) => (m.proposals ? { ...m, proposals: mark(m.proposals) } : m)) });
    const v = session.getState().variations;
    if (v) actions.setVariations({ options: mark(v.options) });
  };

  const findProposal = (proposalId: string) =>
    [...session.getState().designer.chat.flatMap((m) => m.proposals ?? []), ...(session.getState().variations?.options ?? [])].find((p) => p.id === proposalId);

  /** More options for the room on show, leaving out the ones already there. */
  async function extendVariations(goals: RoomGoal[], none: string): Promise<Proposal[]> {
    const v = session.getState().variations;
    if (!v) return [];
    if (v.source !== actions.current()) {
      actions.notify("info", "The plan has changed since these variations were made. Open them again from the room.");
      return [];
    }
    const exclude = v.options.map((o) => o.variant).filter((k): k is string => !!k);
    const intent: DesignIntent = goals.length
      ? { action: "redesign_room", roomId: v.roomId, goals, exclude }
      : { action: "room_variations", roomIds: [v.roomId], goals, count: 3, exclude };
    const result = await plan(intent, v.source);
    if (!result) return [];
    if (!result.candidates.length) {
      actions.notify("info", result.issues[0]?.message ?? none);
      return [];
    }
    const added = toProposals(result, v.source, v.roomId);
    actions.setVariations({ options: [...(session.getState().variations?.options ?? []), ...added], focusId: added[0].id });
    return added;
  }

  return {
    /** Generates whole-plan layouts from the project brief, added as new plans. */
    generateLayouts(count = 3): Promise<Id[]> {
      return layouts(count, {}, (n) => `${n} layout${n === 1 ? "" : "s"} generated from your brief. Your original plan is unchanged.`);
    },

    /** More layouts in arrangements not yet offered in this project. */
    generateMore(count = 3): Promise<Id[]> {
      return layouts(count, { exclude: offeredArrangements() }, (n) => `${n} more layout${n === 1 ? "" : "s"} added.`);
    },

    /** Layouts close to one concept: the same arrangement mirrored, then its neighbours. */
    async generateSimilar(planId: Id): Promise<Id[]> {
      const meta = project.getState().plans.find((p) => p.id === planId);
      const arrangement = meta?.origin.kind === "generated" ? meta.origin.arrangement : undefined;
      if (!arrangement) {
        actions.notify("info", "This design wasn't generated from the brief, so there's no arrangement to vary. Try Generate more.");
        return [];
      }
      return layouts(2, { similarTo: arrangement, exclude: offeredArrangements() }, (n) => `${n} layout${n === 1 ? "" : "s"} similar to ${meta!.label} added.`);
    },

    /**
     * A fresh set from the current brief. Generated concepts nobody has
     * edited are replaced; edited ones and the user's own plans are kept.
     */
    async regenerate(count = 3): Promise<Id[]> {
      if (running()) return [];
      const stale = project.getState().plans.filter((p) => p.origin.kind === "generated" && p.scope.kind === "plan" && !actions.planEdited(p.id));
      if (stale.length && project.getState().plans.length - stale.length < 1) return [];
      for (const p of stale) actions.deletePlan(p.id);
      return layouts(count, {}, (n) => `${n} fresh layout${n === 1 ? "" : "s"} from your brief.${stale.length ? ` ${stale.length} unedited concept${stale.length === 1 ? " was" : "s were"} replaced.` : ""}`);
    },

    /**
     * "Generate variations": the room beside alternative versions of it, on
     * the canvas. No goals gives a spread of what suits the room.
     */
    async openRoomVariations(roomId: Id, goals: RoomGoal[] = []): Promise<Proposal[]> {
      const source = actions.current();
      const room = source.levels[0].rooms[roomId];
      if (!room) return [];
      const result = await plan(goals.length ? { action: "redesign_room", roomId, goals } : { action: "room_variations", roomIds: [roomId], goals, count: 3 });
      if (!result) return [];
      if (!result.candidates.length) {
        const message = result.issues[0]?.message ?? `I couldn't find a variation of ${room.name.toLowerCase()}.`;
        actions.notify("info", message);
        say({ role: "assistant", text: message });
        return [];
      }
      const options = toProposals(result, source, roomId);
      actions.setVariations({ roomId, source, options, focusId: options[0].id, compare: null });
      actions.setDesignView("variations");
      actions.select({ kind: "room", id: roomId });
      return options;
    },

    /** "Generate more variations". */
    moreVariations(): Promise<Proposal[]> {
      return extendVariations([], "There are no more distinct variations for this room.");
    },

    /** More options pursuing the same idea as one variation. */
    similarVariation(proposalId: string): Promise<Proposal[]> {
      const goal = findProposal(proposalId)?.goal;
      return extendVariations(goal ? [goal] : [], "There are no more options like this one.");
    },

    /** "Redesign this room" from chat: options for the given goals, offered in the AI Designer. */
    redesignRoom(roomId: Id, goals: RoomGoal[]): Promise<Proposal[]> {
      const room = actions.current().levels[0].rooms[roomId];
      if (room) say({ role: "user", text: goals.length ? `${goals.map((g) => ROOM_GOAL_LABEL[g]).join(", ")} for ${room.name.toLowerCase()}` : `Redesign ${room.name.toLowerCase()}` });
      return propose(roomId, goals);
    },



    /** A typed request: room changes become proposals, new spaces go into the brief. */
    async ask(text: string): Promise<void> {
      const trimmed = text.trim();
      if (!trimmed || running()) return;
      say({ role: "user", text: trimmed });
      actions.setDesigner({ panelOpen: true });
      const { selection } = session.getState();
      const level = actions.current().levels[0];
      const { steps, unclear } = interpretRequest(trimmed, level, project.getState().brief, selection?.kind === "room" ? selection.id : null);
      let brief: HouseBrief = project.getState().brief;
      const briefChanges: string[] = [];
      for (const step of steps) {
        if (step.kind === "room") await propose(step.roomId, step.goals);
        else {
          brief = normaliseBrief({ ...brief, ...step.patch });
          briefChanges.push(step.describe);
        }
      }
      if (briefChanges.length) {
        actions.setBrief(brief);
        say({ role: "assistant", text: `${briefChanges.join(". ")}. Adding a room changes the whole layout, so new layouts are needed.`, offerGenerate: true });
      }
      if (unclear.length) {
        const pick = selection?.kind === "room" ? "" : " Select a room first, or name one.";
        say({
          role: "assistant",
          text: `I didn't follow “${unclear.join("”, “")}”.${pick} I can make rooms larger or smaller, bring in more light, add garden doors, open rooms up to each other, or add rooms to the brief.`,
        });
      }
    },

    /** Applies a proposal to the plan as one undoable edit. */
    applyProposal(proposalId: string): boolean {
      const proposal = findProposal(proposalId);
      if (!proposal || proposal.state !== "open") return false;
      if (proposal.source !== actions.current()) {
        actions.notify("info", "The plan has changed since this option was made. Ask again for fresh options.");
        return false;
      }
      const result = actions.dispatch({ type: "replaceDocument", document: proposal.document });
      if (!result.ok) return false;
      updateProposal(proposalId, "applied");
      // Applying from the variations view goes back to the plan with the room selected.
      if (session.getState().designView === "variations") actions.setDesignView("plan");
      if (proposal.roomIds[0] && proposal.document.levels[0].rooms[proposal.roomIds[0]]) actions.select({ kind: "room", id: proposal.roomIds[0] });
      actions.notify("success", `${proposal.summary} Undo to go back.`);
      return true;
    },

    /** Keeps a proposal as a new plan beside this one, without changing it. */
    saveProposal(proposalId: string): Id | null {
      const proposal = findProposal(proposalId);
      if (!proposal || proposal.state === "saved") return null;
      const [id] = actions.addPlans(
        [
          {
            document: proposal.document,
            meta: {
              parentId: project.getState().activePlanId,
              origin: { kind: "generated", requestId: proposal.id, planner: planner.id, seed: 0, summary: proposal.summary, notes: [] },
              scope: { kind: "rooms", roomIds: proposal.roomIds },
            },
          },
        ],
        false,
      );
      if (!id) return null;
      updateProposal(proposalId, "saved");
      actions.notify("success", "Saved as a new concept. This plan is unchanged.");
      return id;
    },

    /** Exchanges two rooms' names and uses (and their targets) in one undoable edit. */
    swapRooms(a: Id, b: Id): boolean {
      const doc = actions.current();
      const [ra, rb] = [doc.levels[0].rooms[a], doc.levels[0].rooms[b]];
      if (!ra || !rb || a === b) return false;
      const pick = (r: typeof ra) => ({ name: r.name, type: r.type, targetArea: r.targetArea ?? null, floorMaterial: r.floorMaterial ?? null });
      let next = doc;
      for (const [id, changes] of [[a, pick(rb)], [b, pick(ra)]] as const) {
        const result = applyCommand(next, { type: "updateRoom", roomId: id, changes });
        if (!result.ok) {
          actions.notify("error", result.issues[0]?.message ?? "Those rooms can't be swapped.");
          return false;
        }
        next = result.document;
      }
      const result = actions.dispatch({ type: "replaceDocument", document: next });
      if (result.ok) actions.notify("success", `Swapped ${ra.name} and ${rb.name}. Undo to go back.`);
      return result.ok;
    },

    clearChat() {
      actions.setDesigner({ chat: [] });
    },
  };
}

export type DesignActions = ReturnType<typeof createDesignActions>;
