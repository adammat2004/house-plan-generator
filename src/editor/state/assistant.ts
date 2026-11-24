import { createStore } from "zustand/vanilla";
import type { AgentChange, AgentFailure, AgentStreamEvent, AgentUnsupported } from "@/domain/agent/types";
import type { Id, PlanDocument } from "@/domain/plan/types";
import { validateDocument } from "@/domain/commands";
import { levelOf } from "@/domain/plan/levels";
import type { EditorActions, EditorStores } from "./stores";

/**
 * The editor's side of the assistant: the chat, kept across turns, and what
 * each turn did to the plan. A turn's changes wait as a preview on the canvas; accepting them lands them as one history step, so
 * the ordinary undo and redo (and this panel's Undo) step over a whole turn.
 * The server holds no state; every turn sends the plan and the chat.
 */

export interface AssistantStep {
  id: number;
  ok: boolean;
  text: string;
}

export interface AssistantTurn {
  id: number;
  text: string;
  status: "running" | "done" | "error";
  /** Live progress while the turn runs. */
  steps: AssistantStep[];
  reply?: string;
  changes: AgentChange[];
  failures: AgentFailure[];
  unsupported: AgentUnsupported[];
  /** Changes wait on the canvas as a preview until accepted; nothing is in the history before that. */
  decision: "pending" | "accepted" | "discarded";
  /** The plan the turn started from and the one it made; set when it changed the plan. */
  before?: PlanDocument;
  after?: PlanDocument;
  /** The user has accepted it, so the buttons go away. */
  kept: boolean;
  error?: string;
}

export interface AssistantState {
  turns: AssistantTurn[];
  running: boolean;
  /** Whether the server has an AI key: "no" shows the unavailable state. */
  available: "unknown" | "yes" | "no";
}

/** Where a turn's changes stand against the plan as it is now. */
export type TurnStatus = "none" | "pending" | "discarded" | "applied" | "reverted" | "moved-on";

/** Longer than the server's own 50 s limit, so its answer arrives first. */
export const ASSISTANT_TIMEOUT_MS = 65_000;
const HISTORY_TURNS = 8;

/** The staged preview of a turn, as the canvas knows it. */
export const stageId = (turnId: number) => `assistant-${turnId}`;
/** The turn a staged preview belongs to, or null for any other staged option. */
export const assistantTurnOf = (proposalId: string): number | null => {
  const m = /^assistant-(\d+)$/.exec(proposalId);
  return m ? Number(m[1]) : null;
};

export function createAssistant(stores: EditorStores, editor: EditorActions, endpoint = "/api/design/agent", timeoutMs = ASSISTANT_TIMEOUT_MS) {
  const store = createStore<AssistantState>(() => ({ turns: [], running: false, available: "unknown" }));
  let nextTurn = 1;
  let nextStep = 1;

  const patchTurn = (id: number, patch: (turn: AssistantTurn) => Partial<AssistantTurn>) =>
    store.setState((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)) }));
  const present = () => stores.documents.getState().history.present;
  /** The turn's preview, while it is still on the canvas over the plan it was made from. */
  const stagedFor = (turn: AssistantTurn) => {
    const staged = stores.documents.getState().staged;
    return staged?.proposalId === stageId(turn.id) && staged.source === present();
  };

  /** Reads the response's lines as they arrive. */
  async function readEvents(response: Response, onEvent: (event: AgentStreamEvent) => void) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onEvent(JSON.parse(line) as AgentStreamEvent);
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as AgentStreamEvent);
  }

  const actions = {
    store,

    async checkAvailable(): Promise<boolean> {
      try {
        const response = await fetch(endpoint, { method: "GET" });
        const yes = response.ok && (await response.json()).available === true;
        store.setState({ available: yes ? "yes" : "no" });
        return yes;
      } catch {
        store.setState({ available: "no" });
        return false;
      }
    },

    /** Sends one request to the assistant and applies what it changes as one undo step. */
    async ask(text: string): Promise<void> {
      const request = text.trim();
      if (!request || store.getState().running) return;
      const id = nextTurn++;
      const fail = (error: string) => patchTurn(id, () => ({ status: "error", error }));
      const history = store
        .getState()
        .turns.filter((t) => t.status === "done" && t.reply)
        .slice(-HISTORY_TURNS)
        .flatMap((t) => [
          { role: "user" as const, text: t.text },
          { role: "assistant" as const, text: t.reply! },
        ]);
      store.setState((s) => ({ running: true, turns: [...s.turns, { id, text: request, status: "running", steps: [], changes: [], failures: [], unsupported: [], kept: false, decision: "accepted" }] }));
      try {
        const session = stores.session.getState();
        if (actions.hasPending()) return fail("Accept or discard the pending changes first, then ask again.");
        if (stores.documents.getState().staged) return fail("Leave the option you're previewing first, then ask again.");
        if (session.readOnly) return fail("This plan is read-only.");
        const source = present();
        const selected = session.selection?.kind === "room" ? session.selection.id : null;
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: request, history, document: source, brief: stores.project.getState().brief, selectedRoomId: selected }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          const name = error instanceof Error ? error.name : "";
          if (name === "TimeoutError" || name === "AbortError") return fail("The assistant took too long to answer. Nothing was changed.");
          store.setState({ available: "no" });
          return fail("The assistant couldn't be reached.");
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (response.status === 503 || response.status === 404) store.setState({ available: "no" });
          return fail(typeof body?.error === "string" ? body.error : `The assistant failed (${response.status}).`);
        }
        let outcome: AgentStreamEvent | null = null;
        await readEvents(response, (event) => {
          if (event.type === "tool") patchTurn(id, (t) => ({ steps: [...t.steps, { id: nextStep++, ok: event.ok, text: event.text }] }));
          else if (event.type === "result" || event.type === "error") outcome = event;
        });
        const final = outcome as AgentStreamEvent | null;
        if (!final) return fail("The assistant's answer was cut off. Nothing was changed.");
        if (final.type === "error") return fail(final.message);
        if (final.type !== "result") return fail("The assistant's answer wasn't in the expected shape.");
        const { result } = final;
        const done = { status: "done" as const, reply: result.reply, changes: result.changes, failures: result.failures, unsupported: result.unsupported };
        if (!result.changes.length) return patchTurn(id, () => done);
        if (present() !== source) {
          return patchTurn(id, () => ({ ...done, changes: [], error: "The plan changed while I was working, so I left it alone. Ask again." }));
        }
        const issue = validateDocument(result.document)[0];
        if (issue) return patchTurn(id, () => ({ ...done, changes: [], error: issue.message || "That change couldn't be applied." }));
        // The result waits as a preview on the canvas; the history only changes when it's accepted.
        const roomIds = [...new Set(result.changes.flatMap((c) => c.roomIds))];
        patchTurn(id, () => ({ ...done, before: source, after: result.document, decision: "pending" as const }));
        editor.stage({ proposalId: stageId(id), document: result.document, source, roomIds, title: "Assistant's changes", delta: null });
        const first = roomIds[0];
        const level = first ? levelOf(result.document, first) : undefined;
        if (level && first) editor.setActiveLevel(result.document.levels[0].id === level.id ? null : level.id);
      } catch (error) {
        console.error("Assistant turn failed", error);
        fail("Something went wrong reading the assistant's answer. Nothing was changed.");
      } finally {
        store.setState({ running: false });
      }
    },

    /** Where a turn's changes stand now, read from the history so the editor's own undo and redo agree. */
    statusOf(turn: AssistantTurn): TurnStatus {
      if (!turn.after || !turn.before) return "none";
      if (turn.decision === "pending") return stagedFor(turn) ? "pending" : "discarded";
      if (turn.decision === "discarded") return "discarded";
      const now = present();
      if (now === turn.after) return "applied";
      if (now === turn.before) return "reverted";
      return "moved-on";
    },

    /** Whether a turn's preview is on the canvas waiting for a decision. */
    hasPending(): boolean {
      return store.getState().turns.some((t) => t.decision === "pending" && t.status === "done" && stagedFor(t));
    },

    /** Puts the whole turn into the plan as one history step, so one undo takes all of it back. */
    accept(turnId: number): boolean {
      const turn = store.getState().turns.find((t) => t.id === turnId);
      if (!turn || turn.decision !== "pending" || !turn.after) return false;
      if (!stagedFor(turn)) {
        patchTurn(turnId, () => ({ decision: "discarded" }));
        return false;
      }
      editor.unstage();
      const applied = editor.dispatch({ type: "replaceDocument", document: turn.after });
      if (!applied.ok) {
        patchTurn(turnId, () => ({ decision: "discarded", error: applied.issues[0]?.message ?? "That change couldn't be applied." }));
        return false;
      }
      patchTurn(turnId, () => ({ decision: "accepted", after: present() }));
      const first = actions.roomsOf(turn)[0];
      if (first && levelOf(present(), first)) editor.select({ kind: "room", id: first });
      return true;
    },

    /** Drops the preview; the plan was never changed. */
    discard(turnId: number): boolean {
      const turn = store.getState().turns.find((t) => t.id === turnId);
      if (!turn || turn.decision !== "pending") return false;
      if (stagedFor(turn)) editor.unstage();
      patchTurn(turnId, () => ({ decision: "discarded" }));
      return true;
    },

    /** Takes the turn back with one undo, while it's the latest change. */
    undo(turnId: number): boolean {
      const turn = store.getState().turns.find((t) => t.id === turnId);
      if (!turn || actions.statusOf(turn) !== "applied") return false;
      return editor.undo();
    },

    /** Puts a taken-back turn back, while nothing has been done since. */
    redo(turnId: number): boolean {
      const turn = store.getState().turns.find((t) => t.id === turnId);
      if (!turn || actions.statusOf(turn) !== "reverted") return false;
      return editor.redo();
    },

    keep(turnId: number) {
      patchTurn(turnId, () => ({ kept: true }));
    },

    clear() {
      if (!store.getState().running) store.setState({ turns: [] });
    },

    /** The rooms a turn changed that still exist, for highlighting. */
    roomsOf(turn: AssistantTurn): Id[] {
      return [...new Set(turn.changes.flatMap((c) => c.roomIds))];
    },
  };
  return actions;
}

export type AssistantActions = ReturnType<typeof createAssistant>;
