import { describe, expect, it } from "vitest";
import { renderKey, renderPrompt, renderRequestSchema, renderViewFor } from "@/domain/design/renderRequest";
import { DEFAULT_APPEARANCE, loadProjectDocument, NEW_PROJECT_APPEARANCE, projectFromPlan, ROOF_FINISHES_FOR } from "@/domain/project/schema";
import { projectFromSnapshot, snapshotOf } from "@/domain/project/startLink";
import { newHouse } from "../helpers";

const NOW = "2026-10-19T00:00:00Z";

describe("roof shape", () => {
  it("leaves a project saved before pitched roofs flat, with its photos still current", () => {
    const saved = loadProjectDocument(JSON.parse(JSON.stringify(projectFromPlan(newHouse(), { now: NOW }))), NOW);
    expect(saved.ok && saved.project.appearance).toBeFalsy();
    expect(DEFAULT_APPEARANCE.roofForm).toBeUndefined();
    const level = newHouse().levels[0];
    const exterior = { kind: "exterior" as const };
    // Saying "flat" outright is the same as saying nothing, so no photo goes stale.
    expect(renderKey(level, exterior, { ...DEFAULT_APPEARANCE, roofForm: "flat" }, "modern")).toBe(renderKey(level, exterior, DEFAULT_APPEARANCE, "modern"));
    expect(renderKey(level, exterior, NEW_PROJECT_APPEARANCE, "modern")).not.toBe(renderKey(level, exterior, { ...NEW_PROJECT_APPEARANCE, roofForm: "flat" }, "modern"));
  });

  it("starts new projects hipped in slate, with finishes that suit the shape", () => {
    expect(NEW_PROJECT_APPEARANCE).toMatchObject({ roofForm: "hipped", roof: "slate" });
    expect(ROOF_FINISHES_FOR.hipped).toContain(NEW_PROJECT_APPEARANCE.roof);
    expect(ROOF_FINISHES_FOR.flat).toContain(DEFAULT_APPEARANCE.roof);
    expect(ROOF_FINISHES_FOR.hipped).not.toContain("membrane");
  });

  it("describes the roof in the photo prompt", () => {
    const level = newHouse().levels[0];
    const hipped = renderViewFor(level, { kind: "exterior" }, NEW_PROJECT_APPEARANCE)!;
    expect(renderRequestSchema.shape.view.safeParse(hipped).success).toBe(true);
    expect(renderPrompt(hipped, "modern")).toMatch(/a hipped natural slate roof with deep eaves/);
    const flat = renderViewFor(level, { kind: "exterior" }, DEFAULT_APPEARANCE)!;
    expect(flat).not.toHaveProperty("roofForm");
    expect(renderPrompt(flat, "modern")).toMatch(/a dark flat roof/);
    expect(renderPrompt(renderViewFor(level, { kind: "exterior" }, { ...DEFAULT_APPEARANCE, roof: "zinc" })!, "modern")).toMatch(/a zinc roof/);
  });

  it("sends the look with a plan to another computer", () => {
    const project = { ...projectFromPlan(newHouse(), { now: NOW }), appearance: { ...DEFAULT_APPEARANCE, roof: "zinc" as const, roofForm: "flat" as const } };
    const snapshot = snapshotOf(project, project.activePlanId)!;
    expect(projectFromSnapshot(snapshot, { id: "sent-1", idPrefix: "s", now: NOW })?.appearance).toEqual(project.appearance);
  });

  it("describes gabled roofs and the house's style, and keeps old photos current when no style is asked for", () => {
    const level = newHouse().levels[0];
    const exterior = { kind: "exterior" as const };
    const gabled = renderViewFor(level, exterior, { ...NEW_PROJECT_APPEARANCE, roofForm: "gabled" })!;
    expect(renderPrompt(gabled, "modern")).toMatch(/gable ends flush with the walls/);
    const styled = renderViewFor(level, exterior, { ...NEW_PROJECT_APPEARANCE, exteriorStyle: "farmhouse" })!;
    expect(renderRequestSchema.shape.view.safeParse(styled).success).toBe(true);
    expect(renderPrompt(styled, "modern")).toMatch(/modern farmhouse style/);
    expect(renderViewFor(level, exterior, NEW_PROJECT_APPEARANCE)).not.toHaveProperty("style");
    expect(renderKey(level, exterior, { ...NEW_PROJECT_APPEARANCE, exteriorStyle: "cottage" }, "modern")).not.toBe(renderKey(level, exterior, NEW_PROJECT_APPEARANCE, "modern"));
  });
});

