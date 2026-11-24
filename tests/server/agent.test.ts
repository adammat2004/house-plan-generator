import { describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "@/domain/agent/registry";
import { builtinTools } from "@/domain/agent/tools";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import type { PlanDocument } from "@/domain/plan/types";
import { runAgentTurn, type AgentClient, type AgentContentBlock, type AgentEvent, type AgentRequestParams, type AgentResponse } from "@/server/agent/loop";
import { addWall, level, newHouse, rooms } from "../helpers";

vi.mock("next/server", () => ({ connection: async () => undefined }));

const registry = createToolRegistry(builtinTools);

function house(): PlanDocument {
  let doc = newHouse(8, 10);
  doc = addWall(doc, "mid", [0.15, 5], [7.85, 5]);
  doc = addWall(doc, "split", [4, 5], [4, 9.85]);
  return doc;
}

const use = (id: string, name: string, input: unknown): AgentContentBlock => ({ type: "tool_use", id, name, input });
const toolTurn = (...blocks: AgentContentBlock[]): AgentResponse => ({ stop_reason: "tool_use", content: blocks, model: "test-model" });
const say = (text: string): AgentResponse => ({ stop_reason: "end_turn", content: [{ type: "text", text }], model: "test-model" });

/** A stand-in for the SDK: answers from a script and records every request. */
function scripted(...answers: Array<AgentResponse | ((params: AgentRequestParams) => AgentResponse)>) {
  const calls: AgentRequestParams[] = [];
  const queue = [...answers];
  const client: AgentClient = {
    async create(params) {
      calls.push(structuredClone(params));
      const next = queue.shift();
      if (!next) throw new Error("The script ran out");
      return typeof next === "function" ? next(params) : next;
    },
  };
  return { client, calls };
}

const run = (client: AgentClient, document: PlanDocument, text: string, extra: Partial<Parameters<typeof runAgentTurn>[0]> = {}) =>
  runAgentTurn({ client, model: "test-model", registry, document, brief: DEFAULT_BRIEF, text, idPrefix: "ag1-", ...extra });

describe("agent turn", () => {
  it("changes the plan through tools and reports exactly what changed", async () => {
    const doc = house();
    const [south, west] = rooms(doc);
    const { client, calls } = scripted(
      toolTurn(use("a", "rename_room", { roomId: south.id, name: "Studio" }), use("b", "set_room_type", { roomId: west.id, type: "bedroom" })),
      say("Renamed the south room and made the west room a bedroom."),
    );
    const events: AgentEvent[] = [];
    const result = await run(client, doc, "rename it and make the other a bedroom", { onEvent: (e) => events.push(e) });
    expect(result.stopped).toBe("done");
    expect(result.changes.map((c) => c.tool)).toEqual(["rename_room", "set_room_type"]);
    expect(level(result.document).rooms[south.id].name).toBe("Studio");
    expect(level(result.document).rooms[west.id].type).toBe("bedroom");
    expect(validateDocument(result.document)).toEqual([]);
    expect(result.reply).toMatch(/bedroom/);
    expect(events.filter((e) => e.type === "tool")).toHaveLength(2);
    // The model saw the plan summary with room ids, and the tool results came back in one user turn.
    expect(String(calls[0].messages.at(-1)!.content)).toContain(south.id);
    const results = calls[1].messages.at(-1)!.content as Array<{ type: string; tool_use_id: string }>;
    expect(results.map((r) => r.tool_use_id)).toEqual(["a", "b"]);
    expect(calls[0].tools.map((t) => t.name)).toContain("add_room");
  });

  it("gives a tool failure back to the model, which retries and succeeds", async () => {
    const doc = house();
    const south = rooms(doc)[0];
    const { client, calls } = scripted(
      toolTurn(use("a", "add_window", { roomId: south.id, side: "north" })),
      toolTurn(use("b", "add_window", { roomId: south.id, side: "south" })),
      say("Added a window on the south wall."),
    );
    const result = await run(client, doc, "add a window to the south room");
    const first = (calls[1].messages.at(-1)!.content as Array<{ is_error?: boolean; content: string }>)[0];
    expect(first.is_error).toBe(true);
    expect(first.content).toMatch(/isn't an outside wall/);
    expect(result.failures).toHaveLength(1);
    expect(result.changes).toHaveLength(1);
    expect(result.iterations).toBe(3);
  });

  it("rejects input that doesn't fit the tool, and unknown tools, as errors the model can read", async () => {
    const doc = house();
    const { client, calls } = scripted(toolTurn(use("a", "add_window", { roomId: "x" }), use("b", "paint_wall", {})), say("I couldn't do that."));
    const result = await run(client, doc, "paint it");
    const answers = calls[1].messages.at(-1)!.content as Array<{ is_error?: boolean; content: string }>;
    expect(answers.every((a) => a.is_error)).toBe(true);
    expect(answers[1].content).toMatch(/no tool called/);
    expect(result.changes).toEqual([]);
    expect(result.document).toBe(doc);
  });

  it("reports a request it can't carry out instead of pretending", async () => {
    const doc = house();
    const { client } = scripted(
      toolTurn(use("a", "report_unsupported", { request: "paint the kitchen blue", reason: "I can't change colours yet." })),
      say("I can't change colours yet, so the kitchen is as it was."),
    );
    const result = await run(client, doc, "paint the kitchen blue");
    expect(result.changes).toEqual([]);
    expect(result.unsupported).toEqual([{ request: "paint the kitchen blue", reason: "I can't change colours yet." }]);
    expect(result.document).toBe(doc);
  });

  it("stops at the iteration cap and says so, keeping what was done", async () => {
    const doc = house();
    const south = rooms(doc)[0];
    const loops = Array.from({ length: 5 }, (_, i) => toolTurn(use(`t${i}`, "rename_room", { roomId: south.id, name: `Name ${i}` })));
    const { client, calls } = scripted(...loops);
    const result = await run(client, doc, "keep going", { maxIterations: 3 });
    expect(result.stopped).toBe("iteration-cap");
    expect(calls).toHaveLength(3);
    expect(result.changes).toHaveLength(3);
    expect(result.reply).toMatch(/stopped after several steps/);
  });

  it("stops at the deadline", async () => {
    const doc = house();
    const { client, calls } = scripted(say("never asked"));
    const result = await run(client, doc, "hello", { deadlineMs: 0 });
    expect(result.stopped).toBe("timeout");
    expect(calls).toHaveLength(0);
    expect(result.reply).toMatch(/haven't changed anything/);
  });

  it("answers a question without changing the plan, and carries the chat history", async () => {
    const doc = house();
    const { client, calls } = scripted(say("The house has three rooms."));
    const result = await run(client, doc, "how many rooms?", { history: [{ role: "user", text: "hi" }, { role: "assistant", text: "Hello! What would you like to change?" }] });
    expect(result.document).toBe(doc);
    expect(result.changes).toEqual([]);
    expect(calls[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});
