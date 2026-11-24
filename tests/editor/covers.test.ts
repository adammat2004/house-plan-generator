import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVER_VIEW, startCovers } from "@/editor/state/covers";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import type { RenderRecord } from "@/persistence/planStorage";
import { newHouse } from "../helpers";

describe("project covers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (still: () => Promise<Blob | null> = async () => new Blob(["jpeg"], { type: "image/jpeg" })) => {
    const stores = createEditorStores(newHouse());
    const actions = createEditorActions(stores);
    const written: RenderRecord[] = [];
    const stop = startCovers(stores, { still, put: async (r) => void written.push(r), now: () => "2026-10-19T00:00:00Z", idle: (run) => run() }, 100);
    return { stores, actions, written, stop };
  };

  it("draws the chosen plan's cover once the plan has settled, and again only when its outside changes", async () => {
    const { stores, actions, written, stop } = setup();
    expect(written).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ view: COVER_VIEW, projectId: stores.project.getState().id, planId: stores.project.getState().activePlanId, mimeType: "image/jpeg" });
    // A change inside that doesn't show from the garden: the same cover.
    actions.setBrief({ ...stores.project.getState().brief, additionalInstructions: "A pantry" });
    await vi.advanceTimersByTimeAsync(150);
    expect(written).toHaveLength(1);
    // A new look: a new cover.
    actions.setAppearance({ exterior: "brick" });
    await vi.advanceTimersByTimeAsync(50);
    expect(written).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(written).toHaveLength(2);
    stop();
    actions.setAppearance({ exterior: "timber" });
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toHaveLength(2);
  });

  it("writes nothing where 3D can't be drawn", async () => {
    const { written, stop } = setup(async () => null);
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toHaveLength(0);
    stop();
  });
});
