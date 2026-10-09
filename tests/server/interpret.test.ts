import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { designContext, type AiReply, type AiRequest } from "@/domain/design/aiInterpretation";
import { createStripPlanner } from "@/domain/design/stripPlanner";
import { httpInterpreter } from "@/editor/state/aiInterpreter";
import { createDesignActions } from "@/editor/state/design";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { interpret, MODEL, type ClaudeClient } from "@/server/designInterpreter";
import { newHouse } from "../helpers";

// The route checks connection() for its GET; outside a request it just resolves.
vi.mock("next/server", () => ({ connection: async () => undefined }));

// The route never builds a real client here: interpret() uses whichever stand-in the test sets.
const claude = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/server/designInterpreter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/designInterpreter")>();
  return { ...actual, interpret: (request: AiRequest, client = claude.client as ClaudeClient | undefined) => actual.interpret(request, client) };
});

const reply: AiReply = {
  reply: "I'll add a utility room to the brief.",
  roomChanges: [],
  brief: { bedrooms: null, bathrooms: null, addSpaces: ["utility"], removeSpaces: [], addPreferences: [], removePreferences: [], roomSizes: [], houseShape: null },
  unclear: [],
};
const answered = { stop_reason: "end_turn", parsed_output: reply, model: MODEL };

/** A stand-in for the SDK that records each call and answers (or throws) as told. */
function stub(answer: () => unknown) {
  const calls: Array<{ params: Record<string, unknown>; options: { signal?: AbortSignal } }> = [];
  const client = {
    beta: { messages: { parse: async (params: Record<string, unknown>, options: { signal?: AbortSignal }) => (calls.push({ params, options }), answer()) } },
  } as unknown as ClaudeClient;
  return { client, calls };
}
const throwing = (error: Error) => stub(() => Promise.reject(error)).client;

const request = (text = "add a utility room"): AiRequest => ({ mode: "request", text, context: designContext(null, DEFAULT_BRIEF, null) });

// Never reach the real API, even with a key in the shell.
beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", ""));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  claude.client = undefined;
});

describe("reading with Claude", () => {
  it("returns the parsed reply, with the model settings unchanged and a deadline", async () => {
    const { client, calls } = stub(() => answered);
    expect(await interpret(request(), client)).toEqual({ ok: true, reply, model: MODEL });
    const [{ params, options }] = calls;
    expect(params).toMatchObject({ model: "claude-opus-5", fallbacks: "default", thinking: { type: "adaptive" }, output_config: { effort: "low" } });
    expect(params.messages).toEqual([{ role: "user", content: expect.stringContaining("<user_text>\nadd a utility room\n</user_text>") }]);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("explains refusals, incomplete answers and API errors", async () => {
    expect(await interpret(request(), stub(() => ({ ...answered, stop_reason: "refusal", parsed_output: null })).client)).toMatchObject({ ok: false, status: 422, message: expect.stringMatching(/declined/) });
    expect(await interpret(request(), stub(() => ({ ...answered, stop_reason: "max_tokens" })).client)).toMatchObject({ ok: false, status: 502, message: expect.stringMatching(/incomplete/) });
    expect(await interpret(request(), throwing(new Anthropic.RateLimitError(429, undefined, "slow down", new Headers())))).toMatchObject({ ok: false, status: 429 });
    expect(await interpret(request(), throwing(new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers())))).toMatchObject({ ok: false, status: 503 });
    expect(await interpret(request())).toMatchObject({ ok: false, status: 503, message: expect.stringMatching(/ANTHROPIC_API_KEY/) });
  });

  it("reports a timeout, or the overall deadline, as taking too long", async () => {
    for (const error of [new Anthropic.APIConnectionTimeoutError(), new Anthropic.APIUserAbortError()]) {
      expect(await interpret(request(), throwing(error))).toEqual({ ok: false, status: 504, message: "Claude took too long to answer." });
    }
  });
});

describe("the interpret route", () => {
  /** A fresh copy of the route, so its rate limit and daily count start empty. */
  async function route() {
    vi.resetModules();
    const { GET, POST, maxDuration } = await import("@/app/api/design/interpret/route");
    const post = (body: unknown, forwardedFor = "1.1.1.1") =>
      POST(new Request("http://x/api/design/interpret", { method: "POST", headers: { "x-forwarded-for": forwardedFor }, body: typeof body === "string" ? body : JSON.stringify(body) }));
    return { GET, post, maxDuration };
  }

  it("checks its setup and the request's shape", async () => {
    const { GET, post, maxDuration } = await route();
    expect(maxDuration).toBe(30);
    expect(await (await GET()).json()).toEqual({ available: false });
    expect((await post("not json")).status).toBe(400);
    expect((await post({ ...request(), mode: "shout" })).status).toBe(400);
    expect((await post({ ...request(), text: " " })).status).toBe(400);
    expect((await post(request())).status).toBe(503);
  });

  it("answers with the reply, and passes on timeouts and refusals", async () => {
    const { post } = await route();
    claude.client = stub(() => answered).client;
    const ok = await post(request());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ reply, model: MODEL });
    claude.client = throwing(new Anthropic.APIConnectionTimeoutError());
    const slow = await post(request());
    expect(slow.status).toBe(504);
    expect(await slow.json()).toEqual({ error: "Claude took too long to answer." });
    claude.client = stub(() => ({ ...answered, stop_reason: "refusal", parsed_output: null })).client;
    expect((await post(request())).status).toBe(422);
  });

  it("limits each visitor, whatever they write at the left of x-forwarded-for", async () => {
    const { post } = await route();
    for (let i = 0; i < 30; i++) expect((await post("not json", `10.0.0.${i}, 5.5.5.5`)).status).toBe(400);
    const limited = await post("not json", "10.0.1.1, 5.5.5.5");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: expect.stringMatching(/Too many AI requests/) });
    expect((await post("not json", "6.6.6.6")).status).toBe(400);
  });

  it("stops at CLAUDE_DAILY_LIMIT, counting only answered requests", async () => {
    vi.stubEnv("CLAUDE_DAILY_LIMIT", "2");
    const { post } = await route();
    claude.client = throwing(new Anthropic.APIConnectionTimeoutError());
    for (let i = 0; i < 3; i++) expect((await post(request(), `2.2.2.${i}`)).status).toBe(504);
    claude.client = stub(() => answered).client;
    expect((await post(request(), "3.3.3.1")).status).toBe(200);
    expect((await post(request(), "3.3.3.2")).status).toBe(200);
    const capped = await post(request(), "3.3.3.3");
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: expect.stringMatching(/Today's AI requests/) });
  });
});

describe("the editor waiting for Claude", () => {
  function setup(interpreter = httpInterpreter("/api/design/interpret", 20)) {
    const stores = createEditorStores(newHouse());
    const design = createDesignActions(stores, createEditorActions(stores), createStripPlanner(), interpreter);
    return { stores, design, said: () => stores.session.getState().designer.chat.map((m) => m.text).join(" ") };
  }

  it("gives up after its timeout and lets the built-in reader answer", async () => {
    // A server that never answers: the request ends only when the editor aborts it.
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    expect(await httpInterpreter("/api/design/interpret", 20).read(request())).toEqual({ ok: false, offline: false, message: "Claude took too long to answer." });
    const { stores, design, said } = setup();
    await design.ask("add a utility room");
    expect(said()).toMatch(/Claude took too long to answer\. I'll use the simpler built-in reader instead\./);
    expect(stores.project.getState().brief.requiredSpaces).toContain("utility");
    // Too slow once isn't "not set up": the next request asks Claude again.
    expect(stores.session.getState().designer.ai).not.toBe("off");
  });

  it("says the same when the server's own call times out", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/design/interpret/route");
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => POST(new Request(`http://x${url}`, init)));
    claude.client = throwing(new Anthropic.APIConnectionTimeoutError());
    const { stores, design, said } = setup(httpInterpreter());
    await design.ask("add a utility room");
    expect(said()).toMatch(/Claude took too long to answer\. I'll use the simpler built-in reader instead\./);
    expect(stores.project.getState().brief.requiredSpaces).toContain("utility");
  });
});
