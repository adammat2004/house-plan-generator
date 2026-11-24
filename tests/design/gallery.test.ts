import { describe, expect, it, vi } from "vitest";
import { exteriorTarget, galleryTargets, renderKey, renderPrompt, renderRequestSchema, renderViewFor, targetKey } from "@/domain/design/renderRequest";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { createRenders } from "@/editor/state/renders";
import type { RenderRecord } from "@/persistence/planStorage";
import { newHouse } from "../helpers";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const still = async () => new Blob([Buffer.from(JPEG, "base64")], { type: "image/jpeg" });
const exterior = { kind: "exterior" } as const;

describe("exterior gallery views", () => {
  it("keeps front/day as the original photo, key and request", () => {
    const plan = newHouse();
    expect(exteriorTarget()).toEqual(exterior);
    expect(targetKey(exteriorTarget("front", "day"))).toBe("exterior");
    expect(renderKey(plan, exteriorTarget("front", "day"), DEFAULT_APPEARANCE, "modern")).toBe(renderKey(plan, exterior, DEFAULT_APPEARANCE, "modern"));
    const view = renderViewFor(plan, exterior, DEFAULT_APPEARANCE);
    expect(view).not.toHaveProperty("angle");
    expect(view).not.toHaveProperty("light");
  });

  it("gives every angle and light its own key and cache slot", () => {
    const plan = newHouse();
    const targets = galleryTargets();
    expect(targets).toHaveLength(6);
    expect(new Set(targets.map(targetKey)).size).toBe(6);
    expect(new Set(targets.map((t) => renderKey(plan, t, DEFAULT_APPEARANCE, "modern"))).size).toBe(6);
    // A different interior style doesn't change what the house looks like from outside.
    expect(renderKey(plan, exteriorTarget("rear", "dusk"), DEFAULT_APPEARANCE, "modern")).toBe(renderKey(plan, exteriorTarget("rear", "dusk"), DEFAULT_APPEARANCE, "coastal"));
    expect(renderKey(plan, exteriorTarget("rear", "dusk"), DEFAULT_APPEARANCE, "modern")).not.toBe(renderKey(plan, exteriorTarget("rear", "dusk"), { ...DEFAULT_APPEARANCE, exterior: "brick" }, "modern"));
  });

  it("asks the image model for the angle and the light, through the request schema", () => {
    const plan = newHouse();
    const view = renderViewFor(plan, exteriorTarget("aerial", "dusk"), DEFAULT_APPEARANCE)!;
    expect(view).toMatchObject({ kind: "exterior", angle: "aerial", light: "dusk" });
    expect(renderRequestSchema.shape.view.safeParse(view).success).toBe(true);
    expect(renderPrompt(view, "modern")).toMatch(/from above/);
    expect(renderPrompt(view, "modern")).toMatch(/dusk/);
    expect(renderPrompt(renderViewFor(plan, exterior, DEFAULT_APPEARANCE)!, "modern")).toMatch(/from its garden.*soft daylight/);
    expect(renderRequestSchema.shape.view.safeParse({ ...view, angle: "sideways" }).success).toBe(false);
  });
});

describe("exterior gallery renders", () => {
  const stub = () => vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:${Math.random()}`, revokeObjectURL: () => undefined }));

  it("caches each view separately and only re-renders what is out of date", async () => {
    stub();
    const plan = newHouse();
    const saved: RenderRecord[] = [];
    let calls = 0;
    const renders = createRenders({
      storage: { list: async () => saved, put: async (r) => void saved.push(r), prune: async () => undefined },
      renderer: { available: async () => true, render: async () => (calls++, { ok: true, image: JPEG, mimeType: "image/jpeg", model: "test" }) },
      still,
    });
    await renders.load("p", new Set(["plan"]));
    const rear = [exteriorTarget("rear", "day"), exteriorTarget("rear", "dusk")];
    expect(await renders.renderPlan("plan", plan, DEFAULT_APPEARANCE, "modern", { targets: rear })).toBe(2);
    expect(saved.map((r) => r.view).sort()).toEqual(["exterior:rear:day", "exterior:rear:dusk"]);
    expect(saved[0].sourceHash).not.toBe(saved[1].sourceHash);
    expect(await renders.renderPlan("plan", plan, DEFAULT_APPEARANCE, "modern", { targets: rear })).toBe(0);
    // The front/day photo of an older project is a different slot and still renders on its own.
    expect(await renders.renderPlan("plan", plan, DEFAULT_APPEARANCE, "modern", { targets: [exterior, ...rear] })).toBe(1);
    expect(calls).toBe(3);
    expect(await renders.renderPlan("plan", plan, { ...DEFAULT_APPEARANCE, exterior: "brick" }, "modern", { targets: rear })).toBe(2);
    vi.unstubAllGlobals();
  });

  it("falls back to the 3D view when a render fails, and shows stills without calling the model", async () => {
    stub();
    const plan = newHouse();
    const render = vi.fn(async () => ({ ok: false as const, offline: false, message: "The model is busy." }));
    const renders = createRenders({
      storage: { list: async () => [], put: async () => undefined, prune: async () => undefined },
      renderer: { available: async () => true, render },
      still,
    });
    await renders.load("p", new Set(["plan"]));
    const target = exteriorTarget("rear", "dusk");
    await renders.showStill("plan", plan, target, DEFAULT_APPEARANCE, "modern");
    expect(render).not.toHaveBeenCalled();
    expect(renders.store.getState().fallbacks.plan["exterior:rear:dusk"].url).toMatch(/^blob:/);

    expect(await renders.renderPlan("plan", plan, DEFAULT_APPEARANCE, "modern", { targets: [exteriorTarget("aerial", "day")] })).toBe(0);
    const state = renders.store.getState();
    expect(state.error).toBe("The model is busy.");
    expect(state.byPlan.plan).toBeUndefined();
    expect(state.fallbacks.plan["exterior:aerial:day"].sourceHash).toBe(renderKey(plan, exteriorTarget("aerial", "day"), DEFAULT_APPEARANCE, "modern"));
    vi.unstubAllGlobals();
  });

  it("falls back too when the request itself throws", async () => {
    stub();
    const renders = createRenders({
      storage: { list: async () => [], put: async () => undefined, prune: async () => undefined },
      renderer: { available: async () => true, render: async () => Promise.reject(new Error("offline")) },
      still,
    });
    await renders.load("p", new Set(["plan"]));
    await renders.renderPlan("plan", newHouse(), DEFAULT_APPEARANCE, "modern", { targets: [exteriorTarget("rear", "day")] });
    expect(renders.store.getState().fallbacks.plan["exterior:rear:day"]).toBeDefined();
    expect(renders.store.getState().error).toBe("offline");
    vi.unstubAllGlobals();
  });
});
