import { describe, expect, it } from "vitest";
import type { PlanVariantMeta } from "@/domain/project/schema";
import { STEPS, stepAvailable, stepOf } from "@/editor/state/steps";

const generated = { origin: { kind: "generated", requestId: "r1", planner: "p", seed: 0 } } as Pick<PlanVariantMeta, "origin">;
const own = { origin: { kind: "user" } } as Pick<PlanVariantMeta, "origin">;

describe("steps", () => {
  it("maps every workspace and design view to one of the five steps", () => {
    expect(stepOf({ workspace: "site", designView: "board" })).toBe("map");
    expect(stepOf({ workspace: "brief", designView: "board" })).toBe("requirements");
    expect(stepOf({ workspace: "design", designView: "board" })).toBe("explore");
    expect(stepOf({ workspace: "design", designView: "plan" })).toBe("refine");
    expect(stepOf({ workspace: "design", designView: "variations" })).toBe("refine");
    expect(stepOf({ workspace: "review", designView: "plan" })).toBe("review");
  });

  it("numbers the steps 1-5 in order", () => {
    expect(STEPS.map((s) => `${s.key}:${s.id}`)).toEqual(["1:map", "2:requirements", "3:explore", "4:refine", "5:review"]);
  });

  it("keeps Refine and Review closed in a rooms-first project until layouts exist", () => {
    const roomsFirst = { plans: [own], sizing: { footprint: "auto" as const } };
    for (const step of ["map", "requirements", "explore"] as const) expect(stepAvailable(roomsFirst, step)).toBe(true);
    expect(stepAvailable(roomsFirst, "refine")).toBe(false);
    expect(stepAvailable(roomsFirst, "review")).toBe(false);
    const generatedToo = { ...roomsFirst, plans: [own, generated] };
    expect(stepAvailable(generatedToo, "refine")).toBe(true);
    expect(stepAvailable(generatedToo, "review")).toBe(true);
  });

  it("opens every step for a drawn or measured house", () => {
    for (const sizing of [undefined, { footprint: "source" as const }]) {
      const drawn = { plans: [own], sizing };
      expect(STEPS.every((s) => stepAvailable(drawn, s.id))).toBe(true);
    }
  });
});

describe("moving between steps and views", async () => {
  // Refits wait a frame; Node has no frames.
  globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  // The app's own editor instance, as the stepper and keys use it.
  const { editor, editorStores } = await import("@/editor/state/editor");
  const { chooseView, editWalls, goToStep, selectTool, setSplit, toolsFor, viewChoiceOf } = await import("@/editor/components/shell/tools");
  const session = () => editorStores.session.getState();

  it("goes to each step and back", () => {
    for (const step of ["explore", "refine", "map", "requirements", "review", "refine", "explore"] as const) {
      goToStep(step);
      expect(stepOf(session())).toBe(step);
    }
    goToStep("refine");
    expect(session().workspace).toBe("design");
    expect(session().designView).toBe("plan");
  });

  it("offers every tool in Refine, in both 2D views; furniture shows the furnished view", () => {
    goToStep("refine");
    chooseView("plan");
    for (const tool of ["window", "outline", "wall", "door", "room"] as const) {
      selectTool(tool);
      expect(session().tool).toBe(tool);
      expect(session().view).toBe("plan");
    }
    selectTool("furniture");
    expect(session().tool).toBe("furniture");
    expect(session().view).toBe("furnished");
    // Back to the plan: the Furniture tool goes with the furniture.
    chooseView("plan");
    expect(session().tool).toBe("select");
    expect(session().viewChosen).toBe(true);
  });

  it("covers the plan with the 3D view: no tools there, and a tool brings the plan back", () => {
    goToStep("refine");
    selectTool("wall");
    chooseView("3d");
    expect(viewChoiceOf(session())).toBe("3d");
    expect(session().tool).toBe("select");
    expect(toolsFor(session())).toEqual([]);
    editor.setTool("door");
    expect(session().tool).toBe("select");
    selectTool("door");
    expect(session().tool).toBe("door");
    expect(session().show3d).toBe(false);
    expect(viewChoiceOf(session())).toBe("plan");
  });

  it("puts the 3D view beside the plan, where the plan stays editable", () => {
    goToStep("refine");
    chooseView("3d");
    setSplit(true);
    expect(session().show3d).toBe(true);
    expect(toolsFor(session()).length).toBeGreaterThan(0);
    selectTool("wall");
    expect(session().tool).toBe("wall");
    expect(session().show3d).toBe(true);
    setSplit(false);
    chooseView("plan");
  });

  it("shows the view switch's choice in Review too, where nothing can be edited", () => {
    goToStep("review");
    chooseView("3d");
    expect(viewChoiceOf(session())).toBe("3d");
    chooseView("furnished");
    expect(session().view).toBe("furnished");
    editor.setTool("wall");
    expect(session().tool).toBe("select");
    expect(toolsFor(session())).toEqual([]);
  });

  it("opens Refine without furniture to work on the walls", () => {
    chooseView("furnished");
    goToStep("explore");
    editWalls();
    expect(stepOf(session())).toBe("refine");
    expect(session().view).toBe("plan");
  });

  it("refuses tools outside Refine", () => {
    for (const step of ["explore", "map", "requirements"] as const) {
      goToStep(step);
      editor.setTool("wall");
      expect(session().tool).toBe("select");
    }
  });
});
