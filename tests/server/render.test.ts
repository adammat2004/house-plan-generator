import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { photoTargets, renderKey, renderPrompt, renderRequestSchema, renderViewFor, targetKey, type RenderRequest } from "@/domain/design/renderRequest";
import { planLayouts } from "@/domain/design/stripPlanner";
import { CURRENT_SCHEMA_VERSION } from "@/domain/plan/schema";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { renderPhoto, type ImageClient } from "@/server/imageRenderer";
import { createRenders } from "@/editor/state/renders";
import type { RenderRecord } from "@/persistence/planStorage";
import { apply, level, newHouse } from "../helpers";

// The route checks connection() for its GET; outside a request it just resolves.
vi.mock("next/server", () => ({ connection: async () => undefined }));

// The route renders with whichever stand-in a test sets; with none, renderPhoto behaves as usual.
const images = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/server/imageRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/imageRenderer")>();
  return { ...actual, renderPhoto: (request: RenderRequest, client = images.client as ImageClient | undefined) => actual.renderPhoto(request, client) };
});

const plan = () =>
  level(planLayouts({ intent: { action: "generate_layouts", brief: { ...DEFAULT_BRIEF, bedrooms: 3 }, count: 1, footprint: "auto" }, source: newHouse(), brief: DEFAULT_BRIEF, idPrefix: "r" }).candidates[0].document);

/** A tiny but genuine JPEG header followed by padding, base64. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");

describe("what a photo shows", () => {
  it("picks the exterior and the main rooms, and describes each without free text", () => {
    const lvl = plan();
    const targets = photoTargets(lvl);
    expect(targets[0]).toEqual({ kind: "exterior" });
    const types = targets.slice(1).map((t) => (t.kind === "room" ? lvl.rooms[t.roomId].type : "exterior"));
    expect(types).not.toContain("hall");
    expect(types).toContain("primary_bedroom");
    const bedroom = targets.find((t) => t.kind === "room" && lvl.rooms[t.roomId].type === "primary_bedroom")!;
    const view = renderViewFor(lvl, bedroom, DEFAULT_APPEARANCE)!;
    expect(view).toMatchObject({ kind: "room", roomType: "primary_bedroom" });
    expect(renderRequestSchema.safeParse({ view, style: "modern", image: JPEG }).success).toBe(true);
    expect(renderRequestSchema.safeParse({ view, style: "modern", image: JPEG, prompt: "anything" }).data).not.toHaveProperty("prompt");
    expect(renderPrompt(view, "scandinavian")).toMatch(/primary bedroom[^]*Scandinavian[^]*Keep the camera/);
  });

  it("changes a room's key only when that room changes", () => {
    const lvl = plan();
    const rooms = Object.values(lvl.rooms);
    const [a, b] = [rooms.find((r) => r.type === "primary_bedroom")!, rooms.find((r) => r.type === "living")!];
    const keyA = renderKey(lvl, { kind: "room", roomId: a.id }, DEFAULT_APPEARANCE, "modern");
    const keyB = renderKey(lvl, { kind: "room", roomId: b.id }, DEFAULT_APPEARANCE, "modern");
    expect(renderKey(lvl, { kind: "room", roomId: a.id }, DEFAULT_APPEARANCE, "modern")).toBe(keyA);
    const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, id: "d", name: "d", units: "m" as const, levels: [lvl] };
    const moved = level(apply(doc, { type: "updateRoom", roomId: a.id, changes: { floorMaterial: "carpet" } }));
    expect(renderKey(moved, { kind: "room", roomId: a.id }, DEFAULT_APPEARANCE, "modern")).not.toBe(keyA);
    expect(renderKey(moved, { kind: "room", roomId: b.id }, DEFAULT_APPEARANCE, "modern")).toBe(keyB);
    expect(renderKey(lvl, { kind: "room", roomId: a.id }, DEFAULT_APPEARANCE, "coastal")).not.toBe(keyA);
  });
});

describe("the photo renderer", () => {
  const request = () => ({ view: renderViewFor(plan(), { kind: "exterior" }, DEFAULT_APPEARANCE)!, style: "modern" as const, image: JPEG });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    images.client = undefined;
  });
  const failing = (error: Error): ImageClient => ({
    generate: async () => {
      throw error;
    },
  });
  const picture: ImageClient = { generate: async () => ({ data: "abc", mimeType: "image/jpeg" }) };

  it("returns the model's picture, and explains blocks and missing keys", async () => {
    const asked: string[] = [];
    const ok: ImageClient = { generate: async ({ prompt }) => (asked.push(prompt), { data: "abc", mimeType: "image/jpeg" }) };
    expect(await renderPhoto(request(), ok)).toMatchObject({ ok: true, image: "abc" });
    expect(asked[0]).toMatch(/house seen from its garden/);
    const blocked: ImageClient = { generate: async () => ({ blocked: "IMAGE_SAFETY" }) };
    expect(await renderPhoto(request(), blocked)).toMatchObject({ ok: false, status: 422, message: expect.stringMatching(/didn't come out/) });
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await renderPhoto(request())).toMatchObject({ ok: false, status: 503 });
  });

  it("guards the route: setup, shape, image type, size and rate", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { GET, POST } = await import("@/app/api/design/render/route");
    expect(await (await GET()).json()).toMatchObject({ available: false });
    const post = (body: unknown, ip = "1.1.1.1") =>
      POST(new Request("http://x/api/design/render", { method: "POST", headers: { "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) }));
    expect((await post("not json")).status).toBe(400);
    expect((await post({ ...request(), style: "baroque" })).status).toBe(400);
    expect((await post({ ...request(), image: Buffer.alloc(200, 1).toString("base64") })).status).toBe(400);
    expect((await post(request())).status).toBe(503);
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await post(request(), "9.9.9.9")).status;
    expect(last).toBe(429);
  });

  it("gives Gemini's request a time limit", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const signals: Array<AbortSignal | null | undefined> = [];
    // Answers in place of Google, so nothing leaves the machine.
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      signals.push(init.signal);
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] } }] });
    });
    expect(await renderPhoto(request())).toMatchObject({ ok: true, image: "abc", mimeType: "image/png" });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]!.aborted).toBe(false);
  });

  it("reports a network failure as 502 and a timeout as 504", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await renderPhoto(request(), failing(new TypeError("fetch failed")))).toMatchObject({ ok: false, status: 502, message: expect.stringMatching(/couldn't be reached/) });
    expect(logged).toHaveBeenCalledOnce();
    for (const name of ["TimeoutError", "AbortError"]) {
      expect(await renderPhoto(request(), failing(new DOMException("The operation was aborted.", name)))).toMatchObject({ ok: false, status: 504, message: expect.stringMatching(/took too long/) });
    }
  });

  it("counts only finished photos towards GEMINI_DAILY_LIMIT", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("GEMINI_DAILY_LIMIT", "1");
    // A fresh copy of the route, so its daily count starts at zero.
    vi.resetModules();
    const { POST } = await import("@/app/api/design/render/route");
    const post = (ip: string) => POST(new Request("http://x/api/design/render", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(request()) }));
    images.client = failing(new TypeError("fetch failed"));
    expect((await post("4.4.4.1")).status).toBe(502);
    images.client = failing(new DOMException("The operation timed out.", "TimeoutError"));
    expect((await post("4.4.4.2")).status).toBe(504);
    images.client = picture;
    expect((await post("4.4.4.3")).status).toBe(200);
    const capped = await post("4.4.4.4");
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: expect.stringMatching(/Today's photo renders/) });
  });
});

describe("photo renders in the editor", () => {
  it("renders missing views two at a time, stores them, and skips ones already up to date", async () => {
    const lvl = plan();
    const saved: RenderRecord[] = [];
    let calls = 0;
    const renders = createRenders({
      storage: { list: async () => saved, put: async (r) => void saved.push(r), prune: async () => undefined },
      renderer: { available: async () => true, render: async () => (calls++, { ok: true, image: JPEG, mimeType: "image/jpeg", model: "test" }) },
      still: async () => new Blob([Buffer.from(JPEG, "base64")], { type: "image/jpeg" }),
    });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:${calls}`, revokeObjectURL: () => undefined }));
    await renders.load("p", new Set(["plan"]));
    const targets = photoTargets(lvl);
    const first = await renders.renderPlan("plan", lvl, DEFAULT_APPEARANCE, "modern");
    expect(renders.store.getState().error).toBeNull();
    expect(first).toBe(targets.length);
    expect(saved.map((r) => r.view).sort()).toEqual(targets.map(targetKey).sort());
    expect(Object.keys(renders.store.getState().byPlan.plan)).toHaveLength(targets.length);
    // Nothing changed, so nothing to render; another interior style makes every room (not the exterior) out of date.
    expect(await renders.renderPlan("plan", lvl, DEFAULT_APPEARANCE, "modern")).toBe(0);
    expect(await renders.renderPlan("plan", lvl, DEFAULT_APPEARANCE, "coastal")).toBe(targets.length - 1);
    vi.unstubAllGlobals();
  });

  it("stops after a setup problem and reports it", async () => {
    const renders = createRenders({
      storage: { list: async () => [], put: async () => undefined, prune: async () => undefined },
      renderer: { available: async () => true, render: async () => ({ ok: false, offline: true, message: "Not set up." }) },
      still: async () => new Blob([Buffer.from(JPEG, "base64")], { type: "image/jpeg" }),
    });
    await renders.load("p", new Set());
    expect(await renders.renderPlan("plan", plan(), DEFAULT_APPEARANCE, "modern")).toBe(0);
    expect(renders.store.getState()).toMatchObject({ available: "no", error: "Not set up.", batch: null });
  });
});
