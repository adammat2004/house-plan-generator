import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinTools } from "@/domain/agent/tools";
import type { AgentStreamEvent, AgentTurnResult } from "@/domain/agent/types";
import { createAssistant } from "@/editor/state/assistant";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { addWall, level, newHouse, rooms } from "../helpers";

function setup() {
  let doc = newHouse(8, 10);
  doc = addWall(doc, "mid", [0.15, 5], [7.85, 5]);
  const stores = createEditorStores(doc);
  const editor = createEditorActions(stores);
  const assistant = createAssistant(stores, editor);
  const present = () => stores.documents.getState().history.present;
  return { stores, editor, assistant, present, doc };
}

/** What the server would answer: one real tool run, as the loop would report it. */
function turnResult(doc: ReturnType<typeof newHouse>, roomId: string, name: string): AgentTurnResult {
  const tool = builtinTools.find((t) => t.name === "rename_room")!;
  const outcome = tool.run({ document: doc, brief: {} as never, idPrefix: "x-" }, { roomId, name });
  if (!outcome.ok || outcome.kind !== "change") throw new Error("rename failed");
  return {
    reply: `Renamed it to ${name}.`,
    document: outcome.document,
    changes: [{ tool: "rename_room", summary: outcome.summary, roomIds: outcome.roomIds }],
    failures: [],
    unsupported: [],
    stopped: "done",
    iterations: 2,
  };
}

const ndjson = (events: AgentStreamEvent[]) => new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(""), { headers: { "Content-Type": "application/x-ndjson" } });

afterEach(() => vi.unstubAllGlobals());

describe("assistant (editor side)", () => {
  it("applies a turn as one undo step and lets undo and redo step over it", async () => {
    const { assistant, present, doc, stores } = setup();
    const [first] = rooms(doc);
    const result = turnResult(doc, first.id, "Studio");
    const bodies: Array<{ text: string; history: unknown[]; selectedRoomId: string | null }> = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return ndjson([{ type: "thinking" }, { type: "tool", name: "rename_room", ok: true, text: result.changes[0].summary }, { type: "result", result }]);
    });
    await assistant.ask("call the first room a studio");
    const turn = assistant.store.getState().turns[0];
    expect(turn.status).toBe("done");
    expect(turn.steps.map((s) => s.text)).toEqual([result.changes[0].summary]);
    // Nothing is in the history until the turn is accepted.
    expect(assistant.statusOf(turn)).toBe("pending");
    expect(level(present()).rooms[first.id].name).toBe(first.name);
    expect(stores.documents.getState().history.past).toHaveLength(0);
    expect(stores.documents.getState().staged).toMatchObject({ proposalId: `assistant-${turn.id}`, roomIds: [first.id] });
    expect(assistant.accept(turn.id)).toBe(true);
    expect(stores.documents.getState().staged).toBeNull();
    expect(level(present()).rooms[first.id].name).toBe("Studio");
    expect(stores.documents.getState().history.past).toHaveLength(1);
    expect(assistant.statusOf(assistant.store.getState().turns[0])).toBe("applied");

    expect(assistant.undo(turn.id)).toBe(true);
    expect(level(present()).rooms[first.id].name).toBe(first.name);
    expect(assistant.statusOf(assistant.store.getState().turns[0])).toBe("reverted");
    expect(assistant.redo(turn.id)).toBe(true);
    expect(level(present()).rooms[first.id].name).toBe("Studio");

    // The chat carries over to the next turn.
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return ndjson([{ type: "result", result: { ...result, document: present(), changes: [], reply: "Nothing to change." } }]);
    });
    await assistant.ask("anything else?");
    expect(bodies[1].history).toEqual([
      { role: "user", text: "call the first room a studio" },
      { role: "assistant", text: "Renamed it to Studio." },
    ]);
    const second = assistant.store.getState().turns[1];
    expect(second.changes).toEqual([]);
    expect(assistant.statusOf(second)).toBe("none");
  });

  it("leaves the plan alone when it changed while the assistant worked", async () => {
    const { assistant, editor, present, doc } = setup();
    const [first, second] = rooms(doc);
    const result = turnResult(doc, first.id, "Studio");
    vi.stubGlobal("fetch", async () => {
      editor.dispatch({ type: "updateRoom", roomId: second.id, changes: { name: "Mine" } });
      return ndjson([{ type: "result", result }]);
    });
    await assistant.ask("rename the first room");
    const turn = assistant.store.getState().turns[0];
    expect(turn.changes).toEqual([]);
    expect(turn.error).toMatch(/plan changed while I was working/);
    expect(level(present()).rooms[first.id].name).toBe(first.name);
    expect(level(present()).rooms[second.id].name).toBe("Mine");
  });

  it("shows server errors without touching the plan, and notes when the assistant is not set up", async () => {
    const { assistant, present, doc } = setup();
    vi.stubGlobal("fetch", async () => Response.json({ error: "The assistant isn't set up on this server." }, { status: 503 }));
    await assistant.ask("hello");
    const turn = assistant.store.getState().turns[0];
    expect(turn).toMatchObject({ status: "error", error: "The assistant isn't set up on this server." });
    expect(assistant.store.getState().available).toBe("no");
    expect(assistant.store.getState().running).toBe(false);
    expect(present()).toBe(doc);

    vi.stubGlobal("fetch", async () => ndjson([{ type: "error", message: "The AI is busy (rate limited). Try again in a minute.", status: 429 }]));
    await assistant.ask("again");
    expect(assistant.store.getState().turns[1].error).toMatch(/rate limited/);
  });

  /** A turn with two changes, the second made on top of the first. */
  function twoChangeResult(doc: ReturnType<typeof newHouse>, a: string, b: string): AgentTurnResult {
    const one = turnResult(doc, a, "Studio");
    const two = turnResult(one.document, b, "Library");
    return { ...two, changes: [...one.changes, ...two.changes] };
  }

  it("discards a preview without touching the plan or the history", async () => {
    const { assistant, present, doc, stores } = setup();
    const [first] = rooms(doc);
    const result = turnResult(doc, first.id, "Studio");
    vi.stubGlobal("fetch", async () => ndjson([{ type: "result", result }]));
    await assistant.ask("rename");
    const turn = assistant.store.getState().turns[0];
    expect(assistant.discard(turn.id)).toBe(true);
    expect(stores.documents.getState().staged).toBeNull();
    expect(present()).toBe(doc);
    expect(stores.documents.getState().history.past).toHaveLength(0);
    expect(assistant.statusOf(assistant.store.getState().turns[0])).toBe("discarded");
    expect(assistant.accept(turn.id)).toBe(false);
    expect(present()).toBe(doc);
  });

  it("accepts a whole turn as one undo step", async () => {
    const { assistant, present, doc, stores, editor } = setup();
    const [first, second] = rooms(doc);
    const result = twoChangeResult(doc, first.id, second.id);
    vi.stubGlobal("fetch", async () => ndjson([{ type: "result", result }]));
    await assistant.ask("rename both");
    const turn = assistant.store.getState().turns[0];
    expect(turn.changes).toHaveLength(2);
    expect(assistant.accept(turn.id)).toBe(true);
    expect(stores.documents.getState().history.past).toHaveLength(1);
    expect(level(present()).rooms[first.id].name).toBe("Studio");
    expect(level(present()).rooms[second.id].name).toBe("Library");
    // The editor's own undo takes back both changes at once.
    expect(editor.undo()).toBe(true);
    expect(level(present()).rooms[first.id].name).toBe(first.name);
    expect(level(present()).rooms[second.id].name).toBe(second.name);
    expect(stores.documents.getState().history.past).toHaveLength(0);
  });

  it("holds the next request until the preview is decided", async () => {
    const { assistant, doc } = setup();
    const [first] = rooms(doc);
    const result = turnResult(doc, first.id, "Studio");
    const fetchMock = vi.fn(async () => ndjson([{ type: "result", result }]));
    vi.stubGlobal("fetch", fetchMock);
    await assistant.ask("rename");
    expect(assistant.hasPending()).toBe(true);
    await assistant.ask("something else");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assistant.store.getState().turns[1].error).toMatch(/Accept or discard/);
    assistant.discard(assistant.store.getState().turns[0].id);
    expect(assistant.hasPending()).toBe(false);
  });

  it("keeps the plan uneditable while a preview waits, and accepting still works afterwards", async () => {
    const { assistant, editor, present, doc } = setup();
    const [first, second] = rooms(doc);
    const result = turnResult(doc, first.id, "Studio");
    vi.stubGlobal("fetch", async () => ndjson([{ type: "result", result }]));
    await assistant.ask("rename");
    const turn = assistant.store.getState().turns[0];
    // Other edits are refused while the preview is on show, so the preview can't go stale.
    expect(editor.dispatch({ type: "updateRoom", roomId: second.id, changes: { name: "Mine" } }).ok).toBe(false);
    expect(present()).toBe(doc);
    expect(assistant.statusOf(turn)).toBe("pending");
    expect(assistant.accept(turn.id)).toBe(true);
    expect(level(present()).rooms[first.id].name).toBe("Studio");
    expect(level(present()).rooms[second.id].name).toBe(second.name);
  });

  it("reports availability from the server", async () => {
    const { assistant } = setup();
    vi.stubGlobal("fetch", async () => Response.json({ available: true }));
    expect(await assistant.checkAvailable()).toBe(true);
    expect(assistant.store.getState().available).toBe("yes");
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await assistant.checkAvailable()).toBe(false);
    expect(assistant.store.getState().available).toBe("no");
  });
});
