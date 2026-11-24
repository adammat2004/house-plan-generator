import { normaliseBrief, type HouseBrief } from "@/domain/brief/schema";
import { applyCommand, pinnedMessage, pinnedRoomChanges, validateDocument } from "@/domain/commands";
import { designIntentSchema, ROOM_GOAL_LABEL, type DesignIntent, type RoomGoal } from "@/domain/design/intent";
import type { LayoutPlanner, PlanningResult } from "@/domain/design/planner";
import { designContext, interpretationFromReply, type AiMode } from "@/domain/design/aiInterpretation";
import { roomAtPoint } from "@/domain/design/analysis";
import { areaDeltaText, proposalImpact } from "@/domain/design/impact";
import { layoutNames } from "@/domain/design/layoutNames";
import { interpretRequest, type Interpretation } from "@/domain/design/request";
import { furnishRoom } from "@/domain/furniture/furnish";
import { levelKeepOut } from "@/domain/geometry/stairs";
import { levelIndex, levelOf, levelView, spliceLevel } from "@/domain/plan/levels";
import { generationPlot } from "@/domain/project/site";
import { tracedSite, type SiteFit } from "@/domain/site/fit";
import { assessSense } from "@/domain/design/sense";
import type { Id, Level, PlanDocument } from "@/domain/plan/types";
import type { AiInterpreter } from "./aiInterpreter";
import { newIdPrefix } from "./ids";
import type { ChatMessage, EditorActions, EditorStores, Generation, Proposal } from "./stores";

/** What people see when generating breaks; the error itself goes to the console. */
/** Whole-house layouts per run, lettered A–E. */
export const LAYOUTS_PER_RUN = 5;

export const GENERATION_FAILED = "Something went wrong laying out these rooms. Try again, or change a room.";

/** Lets the page paint (the Layouts loading state) before the planner takes the main thread. */
const nextPaint = () =>
  new Promise<void>((resolve) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => setTimeout(resolve, 0)) : setTimeout(resolve, 0)));

/** Options made from one source plan carry letters, A to Z, in the order shown. */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * A room-level request planned on the room's own floor (room planners see
 * one floor) and put back into the whole house, with no effect on the UI.
 * Upstairs rooms don't open onto the garden, and options that would clash
 * with another floor, such as a wall through the stairs, are left out.
 */
export async function planOnRoomFloor(planner: LayoutPlanner, intent: DesignIntent, source: PlanDocument, roomId: Id, brief: HouseBrief, idPrefix: string): Promise<PlanningResult> {
  const level = levelOf(source, roomId);
  if (!level || source.levels.length === 1) return planner.plan({ intent, source, brief, idPrefix });
  const upstairs = levelIndex(source, level.id) > 0;
  const goals = "goals" in intent && upstairs ? intent.goals.filter((g) => g !== "increase_garden_connection") : null;
  if (goals && "goals" in intent && intent.goals.length && !goals.length) {
    return { candidates: [], issues: [{ code: "unsupported-intent", message: "Rooms upstairs can't open onto the garden." }] };
  }
  const result = await planner.plan({ intent: goals ? ({ ...intent, goals } as DesignIntent) : intent, source: levelView(source, level.id), brief, idPrefix });
  const candidates = result.candidates
    .filter((c) => !(upstairs && c.goal === "increase_garden_connection"))
    .map((c) => ({ ...c, document: spliceLevel(source, level.id, c.document) }))
    .filter((c) => validateDocument(c.document).length === 0);
  const clashed = candidates.length === 0 && result.candidates.length > 0;
  return { candidates, issues: clashed ? [{ code: "does-not-fit", message: "Those changes would run into the stairs or the floors around them." }] : result.issues };
}

/** Planner candidates as proposals, each measured against the plan it was made from. */
export function proposalsFrom(result: PlanningResult, source: PlanDocument, roomId: Id, firstLetter = 0): Proposal[] {
  return result.candidates.map((c, i) => {
    const roomIds = c.changedRoomIds ?? [roomId];
    return {
      id: newIdPrefix(),
      title: c.title ?? c.summary,
      summary: c.summary,
      goal: c.goal,
      variant: c.variant,
      document: c.document,
      roomIds,
      source,
      state: "open" as const,
      impact: proposalImpact(source, c.document, roomId, roomIds),
      letter: LETTERS[(firstLetter + i) % LETTERS.length],
    };
  });
}

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
  async function plan(intent: DesignIntent, source = actions.current(), instructionsRead = false, site?: SiteFit): Promise<PlanningResult | null> {
    if (running()) return null;
    const parsed = designIntentSchema.safeParse(intent);
    if (!parsed.success) {
      actions.setDesigner({ lastResult: { tone: "error", message: "That request isn't complete.", notes: [] } });
      return null;
    }
    actions.setDesigner({ status: "running" });
    // Let the UI show progress before planning starts.
    await nextPaint();
    try {
      return await planner.plan({ intent: parsed.data, source, brief: project.getState().brief, idPrefix: newIdPrefix(), instructionsRead, ...(site ? { site } : {}) });
    } catch (error) {
      console.error("Planner failed", error);
      actions.setDesigner({ lastResult: { tone: "error", message: GENERATION_FAILED, notes: [] } });
      actions.notify("error", GENERATION_FAILED);
      return null;
    } finally {
      actions.setDesigner({ status: "idle" });
    }
  }

  /** A room and its floor, wherever it is in the house. */
  const roomIn = (doc: PlanDocument, roomId: Id) => {
    const level = levelOf(doc, roomId);
    return level?.rooms[roomId] ? { level, room: level.rooms[roomId] } : null;
  };

  /**
   * A room-level request, planned on the room's own floor (room planners see
   * one floor) and put back into the whole house. Upstairs rooms don't open
   * onto the garden, and options that would clash with another floor, such
   * as a wall through the stairs, are left out.
   */
  async function planRooms(intent: DesignIntent, source: PlanDocument, roomId: Id): Promise<PlanningResult | null> {
    if (running()) return null;
    const parsed = designIntentSchema.safeParse(intent);
    if (!parsed.success) return plan(intent, source);
    actions.setDesigner({ status: "running" });
    await nextPaint();
    try {
      return await planOnRoomFloor(planner, parsed.data, source, roomId, project.getState().brief, newIdPrefix());
    } catch (error) {
      console.error("Planner failed", error);
      actions.notify("error", GENERATION_FAILED);
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
  async function readWithAi(mode: AiMode, text: string, level: Level | PlanDocument | null, brief: HouseBrief, selectedRoomId: Id | null): Promise<AiOutcome> {
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
    if (outcome.kind === "failed") return { read: false, notes: ["Your notes weren't read this time."] };
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

  interface PlannedSet {
    result: PlanningResult;
    sourcePlanId: Id;
    notes: string[];
    startedAt: number;
  }

  const setGeneration = (generation: Generation) => actions.setDesigner({ generation });

  /**
   * Plans a set of layouts from the brief without adding them, moving the
   * generation through its phases. Null (with the phase set to nofit or
   * failed) when there's nothing to add.
   */
  /** Set from the moment a run starts (before any await), so a second click can't start another. */
  let generating = false;

  async function planSet(count: number, extra: { exclude?: string[]; similarTo?: string }): Promise<PlannedSet | null> {
    if (generating || running()) return null;
    generating = true;
    const startedAt = Date.now();
    try {
      // Layouts grow from the user's own shell, whichever concept is open.
      const plans = project.getState().plans;
      const sourcePlanId = (plans.find((p) => p.parentId === null && p.origin.kind === "user") ?? plans[0]).id;
      const reading = !!project.getState().brief.additionalInstructions.trim() && session.getState().designer.ai !== "off" && !!interpreter;
      setGeneration({ phase: reading ? "reading" : "planning", startedAt });
      const instructions = await readInstructions();
      setGeneration({ phase: "planning", startedAt });
      const { sizing, site } = project.getState();
      const plot = generationPlot({ site, sizing });
      const intent: DesignIntent = {
        action: "generate_layouts",
        brief: project.getState().brief,
        count,
        ...extra,
        // Projects started from rooms size every house from the rooms, within the plot.
        ...(sizing?.footprint === "auto" ? { footprint: "auto" as const, ...(plot ? { plot } : {}) } : {}),
      };
      // On a traced site, houses sized from the rooms must also fit somewhere on it.
      const siteFit = sizing?.footprint === "auto" ? tracedSite(site)?.fit : undefined;
      const result = await plan(intent, actions.planDocument(sourcePlanId) ?? actions.current(), instructions.read, siteFit);
      if (!result) {
        setGeneration({ phase: "failed", startedAt, message: GENERATION_FAILED });
        return null;
      }
      if (!result.candidates.length) {
        const message = result.issues[0]?.message ?? "These rooms don't fit a layout yet.";
        actions.setDesigner({ lastResult: { tone: "info", message, notes: [], offerAutoSize: !!result.issues[0]?.tooSmall } });
        setGeneration({ phase: "nofit", startedAt, message });
        return null;
      }
      return { result, sourcePlanId, notes: instructions.notes, startedAt };
    } catch (error) {
      console.error("Generating layouts failed", error);
      setGeneration({ phase: "failed", startedAt, message: GENERATION_FAILED });
      return null;
    } finally {
      generating = false;
    }
  }

  /** Files a planned set as new plans, each named for why you'd pick it. */
  function addSet({ result, sourcePlanId, notes: readNotes, startedAt }: PlannedSet, describe: (n: number) => string): Id[] {
    const requestId = newIdPrefix();
    const titles = layoutNames(result.candidates.map((c) => c.document.levels[0]));
    // Design history: the rooms these came from, and when.
    const brief = project.getState().brief;
    const at = new Date().toISOString();
    const ids = actions.addPlans(
      result.candidates.map((c, i) => ({
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
            title: titles[i],
            brief,
            at,
          },
          scope: { kind: "plan" },
        },
      })),
    );
    if (!ids.length) {
      // addPlans has said why (the plan limit).
      setGeneration({ phase: "failed", startedAt, message: "You have the most plans a project can hold. Delete some to make more." });
      return [];
    }
    const notes = [...readNotes, ...new Set(result.candidates.flatMap((c) => c.notes))];
    // The Layouts page shows the new set and picks the recommended one; no toast needed.
    actions.setDesigner({ lastResult: { tone: "success", message: describe(ids.length), notes }, focusPlanId: null });
    setGeneration({ phase: "done", startedAt });
    return ids;
  }

  async function layouts(count: number, extra: { exclude?: string[]; similarTo?: string }, describe: (n: number) => string): Promise<Id[]> {
    const planned = await planSet(count, extra);
    return planned ? addSet(planned, describe) : [];
  }

  /** Room-level options, reported in the AI Designer chat. */
  async function propose(roomId: Id, goals: RoomGoal[], count = 3): Promise<Proposal[]> {
    const source = actions.current();
    const room = roomIn(source, roomId)?.room;
    if (!room) return [];
    actions.setDesigner({ panelOpen: true });
    const result = await planRooms(goals.length ? { action: "redesign_room", roomId, goals } : { action: "room_variations", roomIds: [roomId], goals, count }, source, roomId);
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

  /** Every proposal offered this session, wherever it's shown (chat, variations, the inspector), by id. */
  const known = new Map<string, Proposal>();
  /** The plan each applied proposal became: it's "applied" exactly while that is the plan (so undo and redo move it). */
  const appliedDocs = new Map<string, PlanDocument>();

  const remember = (proposals: Proposal[]) => {
    for (const p of proposals) known.set(p.id, p);
    return proposals;
  };

  const toProposals = (result: PlanningResult, source: PlanDocument, roomId: Id): Proposal[] => remember(proposalsFrom(result, source, roomId));

  const updateProposal = (proposalId: string, state: Proposal["state"]) => {
    const mark = (list: Proposal[]) => list.map((p) => (p.id === proposalId ? { ...p, state } : p));
    actions.setDesigner({ chat: session.getState().designer.chat.map((m) => (m.proposals ? { ...m, proposals: mark(m.proposals) } : m)) });
    const v = session.getState().variations;
    if (v) actions.setVariations({ options: mark(v.options) });
    const p = known.get(proposalId);
    if (p) known.set(proposalId, { ...p, state });
  };

  const findProposal = (proposalId: string) => known.get(proposalId);

  /** Where a proposal stands against the plan as it is now. */
  const statusOf = (p: Pick<Proposal, "id" | "source">): "open" | "applied" | "saved" | "stale" => {
    const present = actions.current();
    if (appliedDocs.get(p.id) === present) return "applied";
    if (known.get(p.id)?.state === "saved") return "saved";
    return p.source === present ? "open" : "stale";
  };

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
    const result = await planRooms(intent, v.source, v.roomId);
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
    sizeFromRooms(count = LAYOUTS_PER_RUN): Promise<Id[]> {
      actions.setSizing({ footprint: "auto" });
      return layouts(count, {}, (n) => `${n} layout${n === 1 ? "" : "s"} sized from your rooms. Your original plan is unchanged.`);
    },

    /** Generates whole-plan layouts from the project brief, added as new plans. */
    generateLayouts(count = LAYOUTS_PER_RUN): Promise<Id[]> {
      return layouts(count, {}, (n) => `${n} layout${n === 1 ? "" : "s"} generated from your brief. Your original plan is unchanged.`);
    },

    /** More layouts in arrangements not yet offered in this project. */
    generateMore(count = LAYOUTS_PER_RUN): Promise<Id[]> {
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
    async regenerate(count = LAYOUTS_PER_RUN): Promise<Id[]> {
      if (running()) return [];
      const staleIds = () => project.getState().plans.filter((p) => p.origin.kind === "generated" && p.scope.kind === "plan" && !actions.planEdited(p.id)).map((p) => p.id);
      if (staleIds().length && project.getState().plans.length - staleIds().length < 1) return [];
      // Plan first: if the new set fails, the layouts already there stay.
      const planned = await planSet(count, {});
      if (!planned) return [];
      const stale = staleIds();
      for (const id of stale) actions.deletePlan(id);
      return addSet(planned, (n) => `${n} fresh layout${n === 1 ? "" : "s"} from your brief.${stale.length ? ` ${stale.length} unedited concept${stale.length === 1 ? " was" : "s were"} replaced.` : ""}`);
    },

    /**
     * "Generate variations": the room beside alternative versions of it, on
     * the canvas. No goals gives a spread of what suits the room.
     */
    async openRoomVariations(roomId: Id, goals: RoomGoal[] = []): Promise<Proposal[]> {
      const source = actions.current();
      const room = roomIn(source, roomId)?.room;
      if (!room) return [];
      const result = await planRooms(goals.length ? { action: "redesign_room", roomId, goals } : { action: "room_variations", roomIds: [roomId], goals, count: 3 }, source, roomId);
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
      const names = roomIds.map((id) => roomIn(source, id)?.room.name).filter((n): n is string => !!n);
      if (names.length < 2 || running()) return [];
      const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      say({ role: "user", text: `Lay out ${list.toLowerCase()} again` });
      actions.setDesigner({ panelOpen: true });
      // The rooms laid out again together are on one floor.
      if (new Set(roomIds.map((id) => levelOf(source, id)?.id)).size > 1) {
        actions.notify("info", "Choose rooms on the same floor to lay out again together.");
        return [];
      }
      const result = await planRooms({ action: "room_variations", roomIds, goals: [], count: 3 }, source, roomIds[0]);
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
      const room = roomIn(actions.current(), roomId)?.room;
      if (room) say({ role: "user", text: goals.length ? `${goals.map((g) => ROOM_GOAL_LABEL[g]).join(", ")} for ${room.name.toLowerCase()}` : `Redesign ${room.name.toLowerCase()}` });
      return propose(roomId, goals);
    },



    /** A typed request: room changes become proposals, new spaces go into the brief. */
    async ask(text: string): Promise<Proposal[]> {
      const offered: Proposal[] = [];
      const trimmed = text.trim();
      if (!trimmed || running()) return offered;
      say({ role: "user", text: trimmed });
      actions.setDesigner({ panelOpen: true });
      const { selection } = session.getState();
      // Requests are about the floor on show, or the selected room's floor.
      const level = (selection?.kind === "room" ? levelOf(actions.current(), selection.id) : undefined) ?? actions.activeLevel();
      const selected =
        selection?.kind === "room" ? selection.id
        : selection?.kind === "furniture" && level.furniture[selection.id] ? roomAtPoint(level, level.furniture[selection.id].position)
        : null;
      // The language model reads the request when it's set up; otherwise (or if it fails) the built-in rules
      // answer without comment, since which reader answered doesn't matter to the person asking.
      // Claude sees the whole house, every floor; the built-in reader works on the floor in question.
      const outcome = await readWithAi("request", trimmed, actions.current(), project.getState().brief, selected);
      if (outcome.kind === "failed") console.warn(`AI request failed, using the built-in reader: ${outcome.message}`);
      const byAi = outcome.kind === "read";
      const { steps, unclear } = byAi ? outcome.interpretation : interpretRequest(trimmed, level, project.getState().brief, selected);
      if (byAi && outcome.interpretation.reply) say({ role: "assistant", text: outcome.interpretation.reply });
      let brief: HouseBrief = project.getState().brief;
      const briefChanges: string[] = [];
      for (const step of steps) {
        if (step.kind === "room") offered.push(...(await propose(step.roomId, step.goals)));
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
      return offered;
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
      if (!proposal) return false;
      const status = statusOf(proposal);
      if (status === "applied" || status === "saved") return false;
      if (status === "stale") {
        actions.notify("info", "The plan has changed since this option was made. Ask again for fresh options.");
        return false;
      }
      const [pinned] = proposal.source.levels.flatMap((before) => {
        const after = proposal.document.levels.find((l) => l.id === before.id);
        return after && after !== before ? pinnedRoomChanges(before, after, { furniture: true }) : [];
      });
      if (pinned) {
        actions.notify("error", pinnedMessage(pinned.name));
        return false;
      }
      // An option on show becomes the plan itself.
      actions.unstage();
      const result = actions.dispatch({ type: "replaceDocument", document: proposal.document });
      if (!result.ok) return false;
      appliedDocs.set(proposalId, actions.current());
      // Applying from the variations view goes back to the plan with the room selected.
      if (session.getState().designView === "variations") actions.setDesignView("plan");
      const changed = proposal.roomIds[0] ? levelOf(proposal.document, proposal.roomIds[0]) : undefined;
      if (changed) {
        actions.setActiveLevel(changed.id);
        actions.select({ kind: "room", id: proposal.roomIds[0] });
      }
      actions.notify("success", `${proposal.summary} Undo to go back.`);
      return true;
    },

    /** Keeps a proposal as a new plan beside this one, without changing it. */
    saveProposal(proposalId: string): Id | null {
      const proposal = findProposal(proposalId);
      if (!proposal || statusOf(proposal) === "saved") return null;
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
      const level = levelOf(doc, a);
      const [ra, rb] = [level?.rooms[a], level?.rooms[b]];
      if (!level || !ra || !rb || a === b) return false;
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
        const floor = levelOf(next, id)!;
        const layout = furnishRoom(floor, id, `${prefix}-${id}`, { keepOut: levelKeepOut(next, floor.id) });
        if (!layout) continue;
        const result = applyCommand(next, { type: "replaceFurniture", levelId: floor.id, remove: layout.remove, add: layout.items });
        if (result.ok) next = result.document;
      }
      // What the swap made worse (a bedroom with no window, a bathroom off the kitchen) is said, not refused.
      const was = new Set(assessSense(level).findings.map((f) => f.message));
      const worse = assessSense(levelOf(next, a)!).findings.filter((f) => !was.has(f.message) && f.roomIds.some((id) => id === a || id === b));
      const result = actions.dispatch({ type: "replaceDocument", document: next });
      if (result.ok) {
        if (worse.length) actions.notify("info", `Swapped ${ra.name} and ${rb.name}. To check: ${worse.map((f) => f.message).join(" ")} Undo to go back.`, [a, b]);
        else actions.notify("success", `Swapped ${ra.name} and ${rb.name}. Undo to go back.`);
      }
      return result.ok;
    },

    clearChat() {
      actions.setDesigner({ chat: [] });
    },

    /** Back to the plan as it is, from an option on show. */
    unstageOption() {
      actions.unstage();
    },

    /** Where a proposal stands now: open to apply, applied (until undone), saved as a plan, or stale. */
    statusOf,

    /** Options planned elsewhere (the inspector's), so they can be applied, saved and staged like any other. */
    remember,

    /**
     * Shows an option on the plan (and in 3D) without changing anything:
     * the history, autosave and undo stay on the plan as it is. Applying it
     * makes it the plan; Back, Escape or undo leave it.
     */
    stage(proposalId: string, letter?: string): boolean {
      const p = findProposal(proposalId);
      if (!p || statusOf(p) !== "open") return false;
      const level = p.roomIds[0] ? levelOf(p.document, p.roomIds[0]) : undefined;
      if (level) actions.setActiveLevel(level.id === p.document.levels[0].id ? null : level.id);
      actions.stage({
        proposalId: p.id,
        document: p.document,
        source: p.source,
        roomIds: p.roomIds,
        title: (letter ?? p.letter) ? `${letter ?? p.letter} · ${p.title}` : p.title,
        delta: p.impact ? areaDeltaText(p.impact) : null,
      });
      return true;
    },
  };
}

export type DesignActions = ReturnType<typeof createDesignActions>;
