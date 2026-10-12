import { createStore } from "zustand/vanilla";
import { suggestedGoals, SUPPORTED_ROOM_GOALS, type RoomGoal } from "@/domain/design/intent";
import type { LayoutPlanner } from "@/domain/design/planner";
import { levelOf } from "@/domain/plan/levels";
import type { Id, PlanDocument } from "@/domain/plan/types";
import { planOnRoomFloor, proposalsFrom } from "./design";
import { newIdPrefix } from "./ids";
import { inRefine, type EditorStores, type Proposal } from "./stores";

/** What the room planner found for one goal: options to show, or why there are none. */
export interface GoalOptions {
  goal: RoomGoal;
  status: "checking" | "ready" | "none";
  proposals: Proposal[];
  /** Why there's nothing, in the planner's words. */
  reason: string | null;
}

export interface RoomOptionsState {
  roomId: Id | null;
  /** The plan the options were made from. */
  source: PlanDocument | null;
  goals: GoalOptions[];
}

/** How long a room stays picked before its options are worked out, ms. */
const SETTLE_MS = 300;

/** The next quiet moment, so planning never holds up a frame. */
const idle = () =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 200 });
    else setTimeout(resolve, 0);
  });

/**
 * The options behind the inspector's quick actions. When a room has stayed
 * picked in Refine for a moment, each goal that suits it is planned in turn,
 * in idle moments, on the plan as it is: so a quick action says what it
 * would do ("+6.2 m²") or why it can't, before it's clicked. Every option
 * comes from the room planner's checked commands; nothing is promised that
 * couldn't be built. Results are kept per plan and room, work stops the
 * moment either changes or a drag starts, and none of it touches the AI
 * Designer's busy state or the plan.
 */
export function createRoomOptions(stores: EditorStores, planner: LayoutPlanner, remember: (proposals: Proposal[]) => Proposal[]) {
  const store = createStore<RoomOptionsState>(() => ({ roomId: null, source: null, goals: [] }));
  const cache = new WeakMap<PlanDocument, Map<Id, GoalOptions[]>>();
  let run = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    run += 1;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  /** The room to have options for now, or why not ("busy" keeps what's shown while a gesture runs). */
  const wanted = (): { doc: PlanDocument; roomId: Id; goals: RoomGoal[] } | "busy" | null => {
    const s = stores.session.getState();
    const d = stores.documents.getState();
    if (!inRefine(s) || s.readOnly || s.selection?.kind !== "room") return null;
    if (s.drag || d.preview) return "busy";
    const doc = d.history.present;
    const room = levelOf(doc, s.selection.id)?.rooms[s.selection.id];
    if (!room) return null;
    return { doc, roomId: room.id, goals: suggestedGoals(room.type).filter((g) => SUPPORTED_ROOM_GOALS.has(g)) };
  };

  async function work(id: number, doc: PlanDocument, roomId: Id, goals: RoomGoal[]) {
    const done: GoalOptions[] = [];
    for (const goal of goals) {
      await idle();
      if (id !== run) return;
      let entry: GoalOptions;
      try {
        const result = await planOnRoomFloor(planner, { action: "redesign_room", roomId, goals: [goal] }, doc, roomId, stores.project.getState().brief, newIdPrefix());
        const proposals = remember(proposalsFrom(result, doc, roomId));
        entry = proposals.length ? { goal, status: "ready", proposals, reason: null } : { goal, status: "none", proposals: [], reason: result.issues[0]?.message ?? null };
      } catch (error) {
        console.error("Room options failed", error);
        entry = { goal, status: "none", proposals: [], reason: null };
      }
      if (id !== run) return;
      done.push(entry);
      store.setState((s) => ({ goals: s.goals.map((g) => (g.goal === goal ? entry : g)) }));
    }
    if (!cache.has(doc)) cache.set(doc, new Map());
    cache.get(doc)!.set(roomId, done);
    store.setState({ goals: done });
  }

  /** The room and plan being worked out or shown; a new one starts the work again. */
  let target: { doc: PlanDocument; roomId: Id } | null = null;

  const sync = () => {
    const w = wanted();
    if (w === "busy") {
      // A drag or preview: stop, and look again once it's over.
      if (target) {
        cancel();
        target = null;
      }
      return;
    }
    if (!w) {
      if (target || store.getState().roomId) {
        cancel();
        target = null;
        store.setState({ roomId: null, source: null, goals: [] });
      }
      return;
    }
    if (target && target.doc === w.doc && target.roomId === w.roomId) return;
    cancel();
    target = { doc: w.doc, roomId: w.roomId };
    const cached = cache.get(w.doc)?.get(w.roomId);
    if (cached) {
      store.setState({ roomId: w.roomId, source: w.doc, goals: cached });
      return;
    }
    store.setState({ roomId: w.roomId, source: w.doc, goals: w.goals.map((goal) => ({ goal, status: "checking", proposals: [], reason: null })) });
    const id = run;
    timer = setTimeout(() => {
      timer = null;
      void work(id, w.doc, w.roomId, w.goals);
    }, SETTLE_MS);
  };

  stores.session.subscribe(sync);
  stores.documents.subscribe(sync);

  return {
    store,
    /** Runs the check now (tests, and after loading a project). */
    sync,
  };
}

export type RoomOptions = ReturnType<typeof createRoomOptions>;
