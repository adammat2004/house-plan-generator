import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { applyCommand, parsePlanDocumentJson, serializePlanDocument } from "@/domain/commands";
import { startAutosave, type SaveStatus } from "@/persistence/autosave";
import { createProjectLibrary, loadStartupProject, type PlanStorage } from "@/persistence/planStorage";
import { projectFromPlan, type ProjectDocument } from "@/domain/project/schema";
import { createEditorActions, createEditorStores, projectAutosaveSource } from "@/editor/state/stores";
import { AXIS, addWall, apply, level, newHouse } from "../helpers";

function richPlan() {
  let doc = addWall(newHouse(), "v", [4, AXIS.south], [4, AXIS.north]);
  doc = addWall(doc, "h", [AXIS.west, 5], [4, 5]);
  const [south, , north] = level(doc).envelope.wallIds;
  const roomId = Object.keys(level(doc).rooms)[0];
  doc = apply(doc, { type: "updateRoom", roomId, changes: { name: "Kitchen", type: "kitchen" } });
  doc = apply(doc, {
    type: "addOpening",
    opening: { id: "door-1", wallId: south, kind: "door", offset: 1, width: 0.9, height: 2.1, hinge: "end", swingSide: "right" },
  });
  doc = apply(doc, {
    type: "addOpening",
    opening: { id: "win-1", wallId: "h", kind: "window", offset: 1, width: 1.2, height: 1.2, sillHeight: 0.9 },
  });
  doc = apply(doc, { type: "setRearWall", wallId: north });
  return doc;
}

describe("native JSON files", () => {
  it("round-trips a complete plan with stable ids, metadata, openings and rear wall", () => {
    const doc = richPlan();
    const parsed = parsePlanDocumentJson(serializePlanDocument(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document).toEqual(doc);
    expect(level(parsed.document).rearWallId).toBe(level(doc).rearWallId);
  });

  it("rejects malformed JSON, unsupported versions and geometrically invalid plans", () => {
    expect(parsePlanDocumentJson("{ not json").ok).toBe(false);
    const future = parsePlanDocumentJson(JSON.stringify({ ...newHouse(), schemaVersion: 7 }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.issues[0].code).toBe("unsupported-version");
    const missing = parsePlanDocumentJson(JSON.stringify({ hello: "world" }));
    if (!missing.ok) expect(missing.issues[0].message).toMatch(/schemaVersion/);

    const doc = newHouse();
    const lvl = level(doc);
    const [vid] = Object.keys(lvl.vertices);
    const broken = { ...doc, levels: [{ ...lvl, vertices: { ...lvl.vertices, [vid]: { x: 3.3, y: 2.2 } } }] };
    const invalid = parsePlanDocumentJson(JSON.stringify(broken));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues[0].code).toMatch(/non-orthogonal-wall|envelope-invalid/);
  });

  it("imports as one undoable replacement and keeps the current plan on failure", () => {
    const stores = createEditorStores(newHouse());
    const actions = createEditorActions(stores);
    const original = stores.documents.getState().history.present;
    expect(actions.dispatch({ type: "replaceDocument", document: { schemaVersion: 2 } }).ok).toBe(false);
    expect(stores.documents.getState().history.present).toBe(original);
    const imported = richPlan();
    expect(actions.dispatch({ type: "replaceDocument", document: JSON.parse(serializePlanDocument(imported)) }).ok).toBe(true);
    expect(stores.documents.getState().history.present).toEqual(imported);
    actions.undo();
    expect(stores.documents.getState().history.present).toBe(original);
  });
});

describe("browser autosave", () => {
  it("saves, rotates the previous revision and reloads the newest valid project", async () => {
    const storage = createProjectLibrary(new IDBFactory()).storage("doc-1");
    const first = projectFromPlan(newHouse(), { now: "t1" });
    const second = projectFromPlan(richPlan(), { now: "t2" });
    await storage.save(first);
    await storage.save(second);
    const stored = await storage.load();
    expect(stored.current).toEqual(second);
    expect(stored.previous).toEqual(first);
    const startup = await loadStartupProject(storage);
    expect(startup.kind).toBe("loaded");
    if (startup.kind === "loaded") expect(startup.project).toEqual(second);
  });

  it("keeps each project in its own record and lists them newest first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let clock = Date.parse("2026-10-07T09:00:00Z");
    const tick = () => vi.setSystemTime((clock += 1000));
    const library = createProjectLibrary(new IDBFactory());
    const a = { ...projectFromPlan(newHouse(), { now: "t" }), id: "a", name: "First" };
    const b = { ...projectFromPlan(richPlan(), { now: "t" }), id: "b", name: "Second" };
    tick();
    await library.create(a);
    tick();
    await library.create(b);
    await expect(library.create(a)).rejects.toBeTruthy();
    expect((await library.list()).map((p) => p.id)).toEqual(["b", "a"]);

    // Saving bumps a project to the top; the record keeps its key even if the project's own id differs.
    tick();
    await library.storage("a").save({ ...a, id: "imported-id", name: "First, edited" });
    const listed = await library.list();
    expect(listed.map((p) => p.name)).toEqual(["First, edited", "Second"]);
    expect(listed[0].project?.id).toBe("a");

    await library.rename("b", "Renamed");
    const copy = await library.duplicate("b", "c");
    expect(copy.name).toBe("Renamed copy");
    expect(copy.plans).toEqual(b.plans);
    await library.remove("a");
    expect((await library.list()).map((p) => p.id).sort()).toEqual(["b", "c"]);
    expect((await library.storage("a").load()).current).toBeUndefined();
    vi.useRealTimers();
  });

  it("lists a damaged project so it can be deleted, and falls back to its previous revision", async () => {
    const library = createProjectLibrary(new IDBFactory());
    const good = { ...projectFromPlan(newHouse(), { now: "t" }), id: "p" };
    await library.create(good);
    await library.storage("p").save({ ...good, plans: [] } as unknown as typeof good);
    let [summary] = await library.list();
    expect(summary.project?.plans).toEqual(good.plans);
    await library.storage("p").save({ ...good, plans: [] } as unknown as typeof good);
    [summary] = await library.list();
    expect(summary.project).toBeNull();
    expect(summary.problem).toBeTruthy();
  });

  it("migrates the single-project autosave from storage version 1", async () => {
    const factory = new IDBFactory();
    const old = projectFromPlan(richPlan(), { now: "t" });
    const older = projectFromPlan(newHouse(), { now: "t" });
    await new Promise<void>((resolve, reject) => {
      const req = factory.open("floor-plan-editor", 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore("plans");
        store.put(old, "current");
        store.put(older, "previous");
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    const library = createProjectLibrary(factory);
    const [summary] = await library.list();
    expect(summary.id).toBe(old.id);
    expect(summary.project).toEqual(old);
    expect((await library.storage(old.id).load()).previous).toEqual(older);
  });

  it("loads an autosave from before projects existed (a bare v1 plan) as a one-plan project", async () => {
    const plan = richPlan();
    const v1 = JSON.parse(JSON.stringify(plan));
    v1.schemaVersion = 1;
    for (const room of Object.values(v1.levels[0].rooms) as Array<Record<string, unknown>>) {
      room.usage = room.type;
      delete room.type;
    }
    const storage: PlanStorage = { save: async () => {}, load: async () => ({ current: v1, previous: undefined }) };
    const startup = await loadStartupProject(storage);
    expect(startup.kind).toBe("loaded");
    if (startup.kind === "loaded") {
      expect(startup.project.plans).toHaveLength(1);
      expect(startup.project.plans[0].document).toEqual(plan);
    }
  });

  it("recovers the previous revision when the latest one is corrupt", async () => {
    const good = richPlan();
    const storage: PlanStorage = {
      save: async () => {},
      load: async () => ({ current: { schemaVersion: 1, garbage: true }, previous: good }),
    };
    const startup = await loadStartupProject(storage);
    expect(startup.kind).toBe("recovered");
    if (startup.kind === "recovered") expect(startup.project.plans[0].document).toEqual(good);
  });

  it("debounces saves of committed documents and reports storage failures without losing the plan", async () => {
    vi.useFakeTimers();
    const saved: unknown[] = [];
    let failNext = true;
    const storage: PlanStorage = {
      save: async (doc) => {
        if (failNext) {
          failNext = false;
          throw new Error("QuotaExceededError");
        }
        saved.push(doc);
      },
      load: async () => ({ current: undefined, previous: undefined }),
    };
    const stores = createEditorStores(newHouse());
    const actions = createEditorActions(stores);
    const statuses: SaveStatus[] = [];
    const stop = startAutosave(projectAutosaveSource(stores), storage, (s) => statuses.push(s), 300);

    actions.dispatch({ type: "resizeFootprint", width: 9 });
    actions.dispatch({ type: "resizeFootprint", width: 9.5 });
    actions.preview({ type: "resizeFootprint", width: 12 });
    await vi.advanceTimersByTimeAsync(400);
    expect(statuses.at(-1)).toEqual({ state: "error", message: "QuotaExceededError" });
    expect(stores.documents.getState().history.present.levels[0]).toBeDefined();

    actions.cancelPreview();
    actions.dispatch({ type: "resizeFootprint", depth: 11 });
    await vi.advanceTimersByTimeAsync(400);
    expect(saved).toHaveLength(1);
    const savedDoc = (saved[0] as ProjectDocument).plans[0].document;
    expect(savedDoc.levels[0]).toEqual(stores.documents.getState().history.present.levels[0]);
    expect(applyCommand(savedDoc, { type: "renameDocument", name: "check" }).ok).toBe(true);
    expect(statuses.at(-1)?.state).toBe("saved");

    // Project-level changes (the brief) are saved too; previews never are.
    actions.setBrief({ ...stores.project.getState().brief, bedrooms: 5 });
    await vi.advanceTimersByTimeAsync(400);
    expect(saved).toHaveLength(2);
    expect((saved[1] as ProjectDocument).brief.bedrooms).toBe(5);
    expect(statuses.at(-1)?.state).toBe("saved");
    stop();
    vi.useRealTimers();
  });
});
