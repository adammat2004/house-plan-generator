import { loadProjectDocument, type ProjectDocument } from "@/domain/project/schema";

/**
 * Browser storage for the user's projects. Each project is one record; each
 * save rotates the previously saved revision into a recovery slot, so a bad
 * write never loses the last good version. Saves from before projects
 * existed hold a bare PlanDocument; loading wraps them as a one-plan project.
 */
export interface PlanStorage {
  save(project: ProjectDocument): Promise<void>;
  load(): Promise<StoredPlans>;
}

export interface StoredPlans {
  current: unknown;
  previous: unknown;
}

/** What the store holds per project: the project as saved plus when it was created and last saved. */
interface ProjectRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  project: unknown;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** The newest revision that passes validation, or null when none does. */
  project: ProjectDocument | null;
  /** Why the project couldn't be read, when `project` is null. */
  problem?: string;
}

export interface ProjectLibrary {
  /** Every project, most recently saved first. */
  list(): Promise<ProjectSummary[]>;
  /** Autosave storage for one project. Saves are written under `id` whatever the project's own id. */
  storage(id: string): PlanStorage;
  /** Adds a new project; fails if one with its id exists. */
  create(project: ProjectDocument): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  /** Copies a project under a new id and returns the copy. */
  duplicate(id: string, newId: string): Promise<ProjectDocument>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "floor-plan-editor";
const DB_VERSION = 2;
/** Version 1 kept a single project under "current" and "previous" in this store. */
const LEGACY_STORE = "plans";
const PROJECTS = "projects";
const REVISIONS = "revisions";

const timestamp = () => new Date().toISOString();

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Saving failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Saving was aborted"));
  });
}

const rawName = (raw: unknown) => (typeof raw === "object" && raw && typeof (raw as { name?: unknown }).name === "string" ? (raw as { name: string }).name : "");
const rawId = (raw: unknown) => (typeof raw === "object" && raw && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : "");

/**
 * Copies the version 1 autosave into the project store. The legacy store is
 * left in place, so an older build can still read it.
 */
function migrateLegacy(tx: IDBTransaction) {
  const legacy = tx.objectStore(LEGACY_STORE);
  const current = legacy.get("current");
  const previous = legacy.get("previous");
  previous.onsuccess = () => {
    const id = rawId(current.result);
    if (current.result === undefined || !id) return;
    const now = timestamp();
    tx.objectStore(PROJECTS).put({ id, createdAt: now, updatedAt: now, project: current.result } satisfies ProjectRecord, id);
    if (previous.result !== undefined) {
      tx.objectStore(REVISIONS).put({ id, createdAt: now, updatedAt: now, project: previous.result } satisfies ProjectRecord, id);
    }
  };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS);
      if (!db.objectStoreNames.contains(REVISIONS)) db.createObjectStore(REVISIONS);
      if (db.objectStoreNames.contains(LEGACY_STORE) && req.transaction) migrateLegacy(req.transaction);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open browser storage"));
    req.onblocked = () => reject(new Error("Browser storage is blocked by another tab"));
  });
}

/** The newest valid revision of a stored project, with the stored key as its id. */
function readRecord(current: ProjectRecord, previous: ProjectRecord | undefined): ProjectSummary {
  const now = timestamp();
  const base = { id: current.id, createdAt: current.createdAt, updatedAt: current.updatedAt };
  for (const record of [current, previous]) {
    if (!record) continue;
    const loaded = loadProjectDocument(record.project, now);
    if (loaded.ok) return { ...base, name: loaded.project.name, project: { ...loaded.project, id: current.id } };
  }
  const loaded = loadProjectDocument(current.project, now);
  return { ...base, name: rawName(current.project) || "Untitled project", project: null, problem: loaded.ok ? undefined : loaded.issues[0]?.message };
}

export function createProjectLibrary(factory: IDBFactory | undefined = globalThis.indexedDB): ProjectLibrary {
  let db: Promise<IDBDatabase> | null = null;
  const database = () => {
    if (!factory) return Promise.reject(new Error("Browser storage (IndexedDB) is not available"));
    db ??= openDatabase(factory).catch((error) => {
      db = null;
      throw error;
    });
    return db;
  };

  const getRecord = async (id: string) => {
    const tx = (await database()).transaction(PROJECTS, "readonly");
    return (await request(tx.objectStore(PROJECTS).get(id))) as ProjectRecord | undefined;
  };

  const loadValid = async (id: string): Promise<ProjectDocument> => {
    const tx = (await database()).transaction([PROJECTS, REVISIONS], "readonly");
    const [current, previous] = (await Promise.all([request(tx.objectStore(PROJECTS).get(id)), request(tx.objectStore(REVISIONS).get(id))])) as [
      ProjectRecord | undefined,
      ProjectRecord | undefined,
    ];
    if (!current) throw new Error("That project no longer exists.");
    const summary = readRecord(current, previous);
    if (!summary.project) throw new Error(`The project is damaged (${summary.problem ?? "invalid data"}).`);
    return summary.project;
  };

  return {
    async list() {
      const tx = (await database()).transaction([PROJECTS, REVISIONS], "readonly");
      const [current, previous] = (await Promise.all([request(tx.objectStore(PROJECTS).getAll()), request(tx.objectStore(REVISIONS).getAll())])) as [
        ProjectRecord[],
        ProjectRecord[],
      ];
      const previousById = new Map(previous.map((r) => [r.id, r]));
      return current.map((r) => readRecord(r, previousById.get(r.id))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    storage(id) {
      return {
        async save(project) {
          const tx = (await database()).transaction([PROJECTS, REVISIONS], "readwrite");
          const finished = done(tx);
          const projects = tx.objectStore(PROJECTS);
          // Rotate within the same transaction so current and previous never diverge.
          const get = projects.get(id);
          get.onsuccess = () => {
            const existing = get.result as ProjectRecord | undefined;
            if (existing) tx.objectStore(REVISIONS).put(existing, id);
            const now = timestamp();
            projects.put({ id, createdAt: existing?.createdAt ?? now, updatedAt: now, project: { ...project, id } } satisfies ProjectRecord, id);
          };
          await finished;
        },
        async load() {
          const tx = (await database()).transaction([PROJECTS, REVISIONS], "readonly");
          const [current, previous] = (await Promise.all([request(tx.objectStore(PROJECTS).get(id)), request(tx.objectStore(REVISIONS).get(id))])) as [
            ProjectRecord | undefined,
            ProjectRecord | undefined,
          ];
          return { current: current?.project, previous: previous?.project };
        },
      };
    },

    async create(project) {
      const tx = (await database()).transaction(PROJECTS, "readwrite");
      const finished = done(tx);
      const now = timestamp();
      // add() refuses an existing key, so a create never overwrites a project.
      tx.objectStore(PROJECTS).add({ id: project.id, createdAt: now, updatedAt: now, project } satisfies ProjectRecord, project.id);
      await finished;
    },

    async rename(id, name) {
      const project = await loadValid(id);
      const record = await getRecord(id);
      const tx = (await database()).transaction(PROJECTS, "readwrite");
      const finished = done(tx);
      const now = timestamp();
      tx.objectStore(PROJECTS).put({ id, createdAt: record?.createdAt ?? now, updatedAt: now, project: { ...project, name } } satisfies ProjectRecord, id);
      await finished;
    },

    async duplicate(id, newId) {
      const source = await loadValid(id);
      const copy: ProjectDocument = { ...source, id: newId, name: `${source.name} copy`.slice(0, 200) };
      await this.create(copy);
      return copy;
    },

    async remove(id) {
      const tx = (await database()).transaction([PROJECTS, REVISIONS], "readwrite");
      const finished = done(tx);
      tx.objectStore(PROJECTS).delete(id);
      tx.objectStore(REVISIONS).delete(id);
      await finished;
    },
  };
}

export type StartupResult =
  | { kind: "loaded"; project: ProjectDocument; previousAvailable: boolean }
  | { kind: "recovered"; project: ProjectDocument; reason: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/** Picks the newest saved revision that passes full validation. */
export async function loadStartupProject(storage: PlanStorage): Promise<StartupResult> {
  let stored: StoredPlans;
  try {
    stored = await storage.load();
  } catch (error) {
    return { kind: "error", message: `Couldn't read the autosaved plan: ${(error as Error).message}` };
  }
  if (stored.current === undefined) return { kind: "empty" };
  const current = loadProjectDocument(stored.current, timestamp());
  if (current.ok) {
    return { kind: "loaded", project: current.project, previousAvailable: stored.previous !== undefined };
  }
  if (stored.previous !== undefined) {
    const previous = loadProjectDocument(stored.previous, timestamp());
    if (previous.ok) {
      return { kind: "recovered", project: previous.project, reason: current.issues[0]?.message ?? "invalid data" };
    }
  }
  return { kind: "error", message: `The autosaved plan is damaged (${current.issues[0]?.message ?? "invalid"}).` };
}

export async function loadPreviousRevision(storage: PlanStorage): Promise<ProjectDocument | null> {
  const stored = await storage.load();
  if (stored.previous === undefined) return null;
  const result = loadProjectDocument(stored.previous, timestamp());
  return result.ok ? result.project : null;
}
