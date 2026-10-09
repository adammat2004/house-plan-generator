import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { createPlanDocument } from "@/domain/commands";
import { createProjectLibrary } from "@/persistence/planStorage";
import { loadProjectDocument, nextPlanLabel, parseProjectJson, projectFromPlan, serializeProject } from "@/domain/project/schema";
import { createEditorActions, createEditorStores, projectDocument } from "@/editor/state/stores";
import { AXIS, addWall, level, newHouse } from "../helpers";

function twoPlanProject() {
  const base = projectFromPlan(newHouse(), { now: "2026-10-07T00:00:00.000Z" });
  const variant = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
  return {
    ...base,
    brief: { ...DEFAULT_BRIEF, preferences: ["open_plan" as const] },
    plans: [
      ...base.plans,
      {
        id: "plan-b",
        label: "Plan A",
        parentId: base.plans[0].id,
        origin: { kind: "generated" as const, requestId: "r1", planner: "strip-planner-v1", seed: 0, summary: "Two rooms" },
        scope: { kind: "plan" as const },
        createdAt: "2026-10-07T00:00:01.000Z",
        document: { ...variant, id: "plan-b" },
      },
    ],
  };
}

describe("project documents", () => {
  it("round-trips a multi-plan project with its brief and lineage", () => {
    const project = twoPlanProject();
    const parsed = parseProjectJson(serializeProject(project), "now");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.wrapped).toBe(false);
      expect(parsed.project).toEqual(project);
    }
  });

  it("rejects inconsistent projects and newer formats", () => {
    const project = twoPlanProject();
    const check = (raw: unknown) => loadProjectDocument(JSON.parse(JSON.stringify(raw)), "now");
    expect(check({ ...project, activePlanId: "missing" }).ok).toBe(false);
    expect(check({ ...project, plans: [project.plans[0], { ...project.plans[1], parentId: "ghost" }] }).ok).toBe(false);
    expect(check({ ...project, plans: [project.plans[0], { ...project.plans[1], id: project.plans[0].id }] }).ok).toBe(false);
    const future = check({ ...project, schemaVersion: 3 });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.issues[0].code).toBe("unsupported-version");
    // A plan that fails geometric validation fails the whole project.
    const broken = JSON.parse(JSON.stringify(project));
    const vid = Object.keys(broken.plans[1].document.levels[0].vertices)[0];
    broken.plans[1].document.levels[0].vertices[vid] = { x: 3.3, y: 2.2 };
    const invalid = check(broken);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues[0].message).toMatch(/^Plan A:/);
  });

  it("labels new plans A, B, … skipping taken labels", () => {
    expect(nextPlanLabel([])).toBe("Plan A");
    expect(nextPlanLabel(["Plan A", "Plan B"])).toBe("Plan C");
    expect(nextPlanLabel(Array.from({ length: 26 }, (_, i) => `Plan ${String.fromCharCode(65 + i)}`))).toBe("Plan AA");
  });
});

describe("plan variants in the editor", () => {
  it("switches plans without losing either plan's undo history", () => {
    const stores = createEditorStores(twoPlanProject());
    const actions = createEditorActions(stores);
    const [a, b] = stores.project.getState().plans.map((p) => p.id);
    actions.dispatch({ type: "resizeFootprint", width: 9 });
    expect(actions.switchPlan(b)).toBe(true);
    expect(level(stores.documents.getState().history.present).walls.v).toBeDefined();
    actions.dispatch({ type: "deleteWall", wallId: "v" });
    expect(actions.switchPlan(a)).toBe(true);
    expect(stores.documents.getState().history.past).toHaveLength(1);
    expect(actions.undo()).toBe(true);
    actions.switchPlan(b);
    expect(actions.undo()).toBe(true);
    expect(level(stores.documents.getState().history.present).walls.v).toBeDefined();
    // Every plan is saved with its own committed document.
    const saved = projectDocument(stores);
    expect(saved.activePlanId).toBe(b);
    expect(saved.plans.map((p) => p.id)).toEqual([a, b]);
  });

  it("adds variations from the active plan and deletes with re-parenting, keeping at least one plan", () => {
    const stores = createEditorStores(newHouse());
    const actions = createEditorActions(stores);
    const original = stores.project.getState().activePlanId;
    const copy = actions.duplicatePlan()!;
    expect(stores.project.getState().activePlanId).toBe(copy);
    const grandchild = actions.duplicatePlan()!;
    expect(stores.project.getState().plans.map((p) => p.label)).toEqual(["My plan", "Plan A", "Plan B"]);
    expect(stores.project.getState().plans.find((p) => p.id === grandchild)!.parentId).toBe(copy);

    expect(actions.deletePlan(copy)).toBe(true);
    expect(stores.project.getState().plans.find((p) => p.id === grandchild)!.parentId).toBe(original);
    expect(actions.deletePlan(grandchild)).toBe(true);
    expect(stores.project.getState().activePlanId).toBe(original);
    expect(actions.deletePlan(original)).toBe(false);
  });
});

describe("photo renders", () => {
  it("are stored per project and plan, pruned with their plans, copied and deleted with the project", async () => {
    const library = createProjectLibrary(new IDBFactory());
    const project = { ...projectFromPlan(createPlanDocument({ id: "plan-1" }), { now: "n" }), id: "p1" };
    await library.create(project);
    const photo = (planId: string, view: string) => ({ projectId: "p1", planId, view, bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]).buffer, mimeType: "image/jpeg", sourceHash: "h", style: "modern", model: "m", createdAt: "n" });
    await library.renders.put(photo("plan-1", "exterior"));
    await library.renders.put(photo("plan-1", "room-1"));
    await library.renders.put(photo("gone", "room-1"));
    expect((await library.renders.list("p1")).map((r) => r.view).sort()).toEqual(["exterior", "room-1", "room-1"]);
    await library.renders.prune("p1", new Set(["plan-1"]));
    expect(await library.renders.list("p1")).toHaveLength(2);
    expect(new Uint8Array((await library.renders.list("p1"))[0].bytes)[0]).toBe(0xff);
    await library.duplicate("p1", "p2");
    expect(await library.renders.list("p2")).toHaveLength(2);
    await library.remove("p1");
    expect(await library.renders.list("p1")).toEqual([]);
    expect(await library.renders.list("p2")).toHaveLength(2);
  });
});
