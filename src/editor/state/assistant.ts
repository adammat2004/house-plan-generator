import { createStore } from "zustand/vanilla";
import type { AgentChange, AgentFailure, AgentStreamEvent, AgentUnsupported } from "@/domain/agent/types";
import type { Id, PlanDocument } from "@/domain/plan/types";
import { levelOf } from "@/domain/plan/levels";
import type { EditorActions, EditorStores } from "./stores";

/**
 * The editor's side of the assistant: the chat, kept across turns, and what
 * each turn did to the plan. A turn's changes land as one history step, so
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
export type TurnStatus = "none" | "applied" | "reverted" | "moved-on";

/** Longer than the server's own 50 s limit, so its answer arrives first. */
export const ASSISTANT_TIMEOUT_MS = 65_000;
const HISTORY_TURNS = 8;

export function createAssistant(stores: EditorStores, editor: EditorActions, endpoint = "/api/design/agent", timeoutMs = ASSISTANT_TIMEOUT_MS) {
  const store = createStore<AssistantState>(() => ({ turns: [], running: false, available: "unknown" }));
  let nextTurn = 1;
  let nextStep = 1;

  const patchTurn = (id: number, patch: (turn: AssistantTurn) => Partial<AssistantTurn>) =>
    store.setState((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)) }));
  const present = () => stores.documents.getState().history.present;

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
      store.setState((s) => ({ running: true, turns: [...s.turns, { id, text: request, status: "running", steps: [], changes: [], failures: [], unsupported: [], kept: false }] }));
      try {
        const session = stores.session.getState();
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
        const applied = editor.dispatch({ type: "replaceDocument", document: result.document });
        if (!applied.ok) return patchTurn(id, () => ({ ...done, changes: [], error: applied.issues[0]?.message ?? "That change couldn't be applied." }));
        const after = present();
        patchTurn(id, () => ({ ...done, before: source, after }));
        const first = result.changes.flatMap((c) => c.roomIds)[0];
        const level = first ? levelOf(after, first) : undefined;
        if (level && first) {
          editor.setActiveLevel(after.levels[0].id === level.id ? null : level.id);
          editor.select({ kind: "room", id: first });
        }
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
      const now = present();
      if (now === turn.after) return "applied";
      if (now === turn.before) return "reverted";
      return "moved-on";
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
