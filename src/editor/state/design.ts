import { normaliseBrief, type HouseBrief } from "@/domain/brief/schema";
import { applyCommand, pinnedMessage, pinnedRoomChanges } from "@/domain/commands";
import { designIntentSchema, ROOM_GOAL_LABEL, type DesignIntent, type RoomGoal } from "@/domain/design/intent";
import type { LayoutPlanner, PlanningResult } from "@/domain/design/planner";
import { designContext, interpretationFromReply, type AiMode } from "@/domain/design/aiInterpretation";
import { roomAtPoint } from "@/domain/design/analysis";
import { interpretRequest, type Interpretation } from "@/domain/design/request";
import { furnishRoom } from "@/domain/furniture/furnish";
import type { Id, Level, PlanDocument } from "@/domain/plan/types";
import type { AiInterpreter } from "./aiInterpreter";
import { newIdPrefix } from "./ids";
import type { ChatMessage, EditorActions, EditorStores, Proposal } from "./stores";

/**
 * Runs design intents through a planner. Whole-plan layouts are filed as new
 * plan variants; room-level changes come back as proposals in the AI
 * Designer, applied only when the user asks (as one undoable edit) or saved
 * as a variation. This is the only place the UI talks to planners:
 * components express intent, never geometry.
 */
export function createDesignActions({ session, project }: EditorStores, actions: EditorActions, planner: LayoutPlanner, interpreter: AiInterpreter | null = null) {
  const running = () => session.getState().designer.status === "running";
  let messageCounter = 0;

  const say = (message: Omit<ChatMessage, "id">) =>
    actions.setDesigner({ chat: [...session.getState().designer.chat, { ...message, id: ++messageCounter }] });

  /** Runs the planner with the UI showing progress. Null if the request was refused or another is running. */
  async function plan(intent: DesignIntent, source = actions.current(), instructionsRead = false): Promise<PlanningResult | null> {
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
      return await planner.plan({ intent: parsed.data, source, brief: project.getState().brief, idPrefix: newIdPrefix(), instructionsRead });
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
      .plans.map((p) => (p.origin.kind === "generated" ? (p.origin.variant ?? p.origin.arrangement) : undefined))
      .filter((a): a is string => !!a);

  type AiOutcome = { kind: "read"; interpretation: Interpretation & { reply: string } } | { kind: "off" } | { kind: "failed"; message: string };

  /** Asks the language model to read some text, if one is set up. "off" means use the built-in rules. */
  async function readWithAi(mode: AiMode, text: string, level: Level | null, brief: HouseBrief, selectedRoomId: Id | null): Promise<AiOutcome> {
    if (!interpreter || session.getState().designer.ai === "off" || running()) return { kind: "off" };
    actions.setDesigner({ status: "running" });
    try {
      const result = await interpreter.read({ mode, text, context: designContext(level, brief, selectedRoomId) });
      if (result.ok) {
        actions.setDesigner({ ai: "available" });
        return { kind: "read", interpretation: interpretationFromReply(result.reply, level, brief, mode) };
      }
      if (result.offline) {
        actions.setDesigner({ ai: "off" });
        return { kind: "off" };
      }
      return { kind: "failed", message: result.message };
    } finally {
      actions.setDesigner({ status: "idle" });
    }
  }

  /** What the brief's notes have already been read as, so generating again doesn't ask twice. */
  const notesRead = new Map<string, string[]>();

  /**
   * Reads the brief's free-text notes into its structured fields before
   * layouts are planned. Notes only add to the brief; what they ask for
   * that the brief can't express is reported, not guessed at.
   */
  async function readInstructions(): Promise<{ read: boolean; notes: string[] }> {
    const brief = project.getState().brief;
    const text = brief.additionalInstructions.trim();
    if (!text) return { read: false, notes: [] };
    const seen = notesRead.get(text);
    if (seen) return { read: true, notes: seen };
    const outcome = await readWithAi("instructions", text, null, brief, null);
    if (outcome.kind !== "read") return { read: false, notes: [] };
    let next = brief;
    const changes: string[] = [];
    for (const step of outcome.interpretation.steps) {
      if (step.kind !== "brief") continue;
      next = normaliseBrief({ ...next, ...step.patch });
      changes.push(step.describe);
    }
    if (changes.length) actions.setBrief(next);
    const { unclear } = outcome.interpretation;
    const notes = [
      changes.length ? `From your notes: ${changes.join("; ")}.` : "Your notes didn't ask for anything beyond the brief.",
      ...(unclear.length ? [`Not something layouts can do yet: “${unclear.join("”, “")}”.`] : []),
    ];
    notesRead.set(text, notes);
    return { read: true, notes };
  }

  async function layouts(count: number, extra: { exclude?: string[]; similarTo?: string }, describe: (n: number) => string): Promise<Id[]> {
    // Layouts grow from the user's own shell, whichever concept is open.
    const plans = project.getState().plans;
    const sourcePlanId = (plans.find((p) => p.parentId === null && p.origin.kind === "user") ?? plans[0]).id;
    const instructions = await readInstructions();
    const { sizing } = project.getState();
    const intent: DesignIntent = {
      action: "generate_layouts",
      brief: project.getState().brief,
      count,
      ...extra,
      // Projects started from rooms size every house from the rooms, within the plot.
      ...(sizing?.footprint === "auto" ? { footprint: "auto" as const, ...(sizing.plot ? { plot: sizing.plot } : {}) } : {}),
    };
    const result = await plan(intent, actions.planDocument(sourcePlanId) ?? actions.current(), instructions.read);
    if (!result) return [];
    if (!result.candidates.length) {
      const message = result.issues[0]?.message ?? "The planner didn't produce any layouts.";
      actions.setDesigner({ lastResult: { tone: "info", message, notes: [], offerAutoSize: !!result.issues[0]?.tooSmall } });
      actions.notify("info", message);
      return [];
    }
    const requestId = newIdPrefix();
    const ids = actions.addPlans(
      result.candidates.map((c) => ({
        document: c.document,
        meta: {
          parentId: sourcePlanId,
          origin: {
            kind: "generated",
            requestId,
            planner: planner.id,
            seed: c.seed,
            summary: c.summary,
            notes: c.notes,
            arrangement: c.arrangement,
            ...(c.variant && c.footprint ? { variant: c.variant } : {}),
          },
          scope: { kind: "plan" },
        },
      })),
    );
    if (!ids.length) return [];
    const notes = [...instructions.notes, ...new Set(result.candidates.flatMap((c) => c.notes))];
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
    /**
     * When the user's house is too small for the brief: size each house from
     * the rooms from now on, and generate. The user's own plan is unchanged.
     */
    sizeFromRooms(count = 3): Promise<Id[]> {
      actions.setSizing({ footprint: "auto" });
      return layouts(count, {}, (n) => `${n} layout${n === 1 ? "" : "s"} sized from your rooms. Your original plan is unchanged.`);
    },

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
      const arrangement = meta?.origin.kind === "generated" ? (meta.origin.variant ?? meta.origin.arrangement) : undefined;
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

    /**
     * "Regenerate selection": several rooms laid out again in the space they
     * share, offered in the AI Designer. Nothing else in the plan changes.
     */
    async regenerateArea(roomIds: Id[]): Promise<Proposal[]> {
      const source = actions.current();
      const names = roomIds.map((id) => source.levels[0].rooms[id]?.name).filter((n): n is string => !!n);
      if (names.length < 2 || running()) return [];
      const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      say({ role: "user", text: `Lay out ${list.toLowerCase()} again` });
      actions.setDesigner({ panelOpen: true });
      const result = await plan({ action: "room_variations", roomIds, goals: [], count: 3 }, source);
      if (!result) return [];
      if (!result.candidates.length) {
        say({ role: "assistant", text: result.issues[0]?.message ?? `I couldn't find another way to lay out ${list.toLowerCase()}.` });
        return [];
      }
      const proposals = toProposals(result, source, roomIds[0]);
      say({ role: "assistant", text: `Here ${proposals.length === 1 ? "is another way" : `are ${proposals.length} other ways`} to lay out ${list.toLowerCase()}. The rest of the plan stays as it is.`, proposals });
      return proposals;
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
      const selected =
        selection?.kind === "room" ? selection.id
        : selection?.kind === "furniture" && level.furniture[selection.id] ? roomAtPoint(level, level.furniture[selection.id].position)
        : null;
      // Claude reads the request when it's set up; otherwise (or if it fails) the built-in rules do.
      const outcome = await readWithAi("request", trimmed, level, project.getState().brief, selected);
      if (outcome.kind === "failed") say({ role: "assistant", text: `${outcome.message} I'll use the simpler built-in reader instead.` });
      const byAi = outcome.kind === "read";
      const { steps, unclear } = byAi ? outcome.interpretation : interpretRequest(trimmed, level, project.getState().brief, selected);
      if (byAi && outcome.interpretation.reply) say({ role: "assistant", text: outcome.interpretation.reply });
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
      if (unclear.length && byAi) {
        say({ role: "assistant", text: `I can't do “${unclear.join("”, “")}” yet. I can resize rooms, add light, garden doors, storage, an island, a dining area or an ensuite, open rooms up, or change the brief.` });
      } else if (unclear.length) {
        const pick = selection?.kind === "room" ? "" : " Select a room first, or name one.";
        say({
          role: "assistant",
          text: `I didn't follow “${unclear.join("”, “")}”.${pick} I can make rooms larger or smaller, bring in more light, add garden doors, storage, an island, a dining area or an ensuite, open rooms up to each other, or add rooms to the brief.`,
        });
      }
    },

    /** Finds out whether Claude is set up, so the panels can say who reads requests. */
    async checkAi(): Promise<void> {
      if (!interpreter) {
        actions.setDesigner({ ai: "off" });
        return;
      }
      actions.setDesigner({ ai: (await interpreter.available()) ? "available" : "off" });
    },

    /** Applies a proposal to the plan as one undoable edit. */
    applyProposal(proposalId: string): boolean {
      const proposal = findProposal(proposalId);
      if (!proposal || proposal.state !== "open") return false;
      if (proposal.source !== actions.current()) {
        actions.notify("info", "The plan has changed since this option was made. Ask again for fresh options.");
        return false;
      }
      const [pinned] = pinnedRoomChanges(proposal.source.levels[0], proposal.document.levels[0], { furniture: true });
      if (pinned) {
        actions.notify("error", pinnedMessage(pinned.name));
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

    /**
     * Exchanges two rooms' names and uses (and their targets), and lays both
     * out again for their new use, in one undoable edit.
     */
    swapRooms(a: Id, b: Id): boolean {
      const doc = actions.current();
      const [ra, rb] = [doc.levels[0].rooms[a], doc.levels[0].rooms[b]];
      if (!ra || !rb || a === b) return false;
      const held = [ra, rb].find((r) => r.locked);
      if (held) {
        actions.notify("error", `Unpin ${held.name} to swap it.`, [held.id]);
        return false;
      }
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
      // The furniture follows the use: the bed leaves what is now the kitchen.
      const prefix = newIdPrefix();
      for (const id of [a, b]) {
        const layout = furnishRoom(next.levels[0], id, `${prefix}-${id}`);
        if (!layout) continue;
        const result = applyCommand(next, { type: "replaceFurniture", remove: layout.remove, add: layout.items });
        if (result.ok) next = result.document;
      }
      // Plan-sense warnings about the swapped rooms (a bedroom off the kitchen, say) go here.
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
