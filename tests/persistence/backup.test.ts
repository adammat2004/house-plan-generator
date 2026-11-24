import { describe, expect, it, vi } from "vitest";
import { markForSave, type SaveStatus } from "@/persistence/autosave";
import { REMINDER_AFTER_MS, REMINDER_EDITS, recordBackup, recordEdit, shouldRemind, snoozeReminder, SNOOZE_MS, type KeyValueStore } from "@/persistence/backupReminder";
import { readProjectFile } from "@/persistence/jsonFile";
import { requestPersistentStorage } from "@/persistence/persistentStorage";
import type { PlanStorage } from "@/persistence/planStorage";
import { parseProjectJson, projectFromPlan, serializeProject } from "@/domain/project/schema";
import { serializePlanDocument } from "@/domain/commands";
import { newHouse } from "../helpers";

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const project = () => projectFromPlan(newHouse(), { now: "2026-10-07T00:00:00.000Z" });
const file = (text: string) => new File([text], "x.json");

describe("importing a backup", () => {
  it("accepts a project file and a legacy single-plan file", async () => {
    const current = await readProjectFile(file(serializeProject(project())));
    expect(current.ok).toBe(true);
    const legacy = parseProjectJson(serializePlanDocument(newHouse()), "2026-11-01T00:00:00.000Z");
    expect(legacy.ok && legacy.wrapped).toBe(true);
  });

  it("gives a friendly error for junk, wrong shapes and newer formats", async () => {
    for (const text of ["{ nope", "[]", JSON.stringify({ hello: 1 }), JSON.stringify({ ...project(), schemaVersion: 99 })]) {
      const result = await readProjectFile(file(text));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0].message.length).toBeGreaterThan(0);
    }
  });
});

describe("save errors", () => {
  it("reports a failed write instead of staying silent", async () => {
    const storage = { save: () => Promise.reject(new Error("QuotaExceededError")) } as unknown as PlanStorage;
    const statuses: SaveStatus[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    await markForSave(storage, project(), (s) => statuses.push(s));
    expect(statuses.map((s) => s.state)).toEqual(["saving", "error"]);
    expect(statuses[1]).toEqual({ state: "error", message: "QuotaExceededError" });
  });
});

describe("persistent storage", () => {
  it("asks once, tolerates missing support and refusals", async () => {
    expect(await requestPersistentStorage(undefined)).toBe(false);
    expect(await requestPersistentStorage({ persist: async () => true } as StorageManager)).toBe(true);
    expect(await requestPersistentStorage({ persist: async () => false } as StorageManager)).toBe(false);
    expect(await requestPersistentStorage({ persist: () => Promise.reject(new Error("no")) } as StorageManager)).toBe(false);
    const persist = vi.fn();
    expect(await requestPersistentStorage({ persisted: async () => true, persist } as unknown as StorageManager)).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("backup reminder", () => {
  it("waits for meaningful work, then goes quiet after a backup or dismissal", () => {
    const store = memory();
    const t0 = 1_000_000;
    expect(shouldRemind(t0, store)).toBe(false);
    for (let i = 0; i < REMINDER_EDITS - 1; i++) recordEdit(t0, store);
    expect(shouldRemind(t0, store)).toBe(false);
    recordEdit(t0, store);
    expect(shouldRemind(t0, store)).toBe(true);
    snoozeReminder(t0, store);
    expect(shouldRemind(t0 + SNOOZE_MS - 1, store)).toBe(false);
    expect(shouldRemind(t0 + SNOOZE_MS, store)).toBe(true);
    recordBackup(t0, store);
    expect(shouldRemind(t0 + SNOOZE_MS, store)).toBe(false);
  });

  it("reminds a day after unbacked-up work, and survives a broken store", () => {
    const store = memory();
    recordEdit(0, store);
    expect(shouldRemind(REMINDER_AFTER_MS - 1, store)).toBe(false);
    expect(shouldRemind(REMINDER_AFTER_MS, store)).toBe(true);
    const broken: KeyValueStore = { getItem: () => "{bad", setItem: () => { throw new Error("full"); } };
    expect(() => recordEdit(0, broken)).not.toThrow();
    expect(shouldRemind(0, broken)).toBe(false);
  });
});
