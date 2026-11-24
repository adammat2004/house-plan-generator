"use client";

import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createPlanDocument } from "@/domain/commands";
import type { Point2 } from "@/domain/plan/types";
import { NEW_PROJECT_APPEARANCE, projectFromPlan, type ProjectDetails, type ProjectDocument } from "@/domain/project/schema";
import type { HouseShape } from "@/domain/brief/schema";
import type { PlotLimits } from "@/domain/design/footprint";
import { projectFromRooms } from "@/domain/project/fromRooms";
import { decodeSnapshot, projectFromSnapshot, snapshotProjectId } from "@/domain/project/startLink";
import { projectFromTemplate, type ProjectTemplate } from "@/domain/project/templates";
import { editorStores } from "@/editor/state/editor";
import type { CreateHouseValues } from "@/editor/components/CreateHouseDialog";
import { newDocumentId, newIdPrefix } from "@/editor/state/ids";
import { browserLibrary } from "@/persistence/browserLibrary";
import type { ProjectSummary } from "@/persistence/planStorage";
import { DRAFT_NAME, isUntouchedDraft, STARTING_BRIEF } from "./drafts";
import { catalogueAppearance, type CatalogueEntry } from "@/domain/project/catalogue";

/**
 * The home screen's view of the project library, plus the actions that add
 * to it. Every action writes to browser storage first and then refreshes the
 * list, so the list always reflects what is actually saved.
 */

interface LibraryState {
  status: "loading" | "ready" | "error";
  projects: ProjectSummary[];
  error: string | null;
}

export const libraryStore = createStore<LibraryState>(() => ({ status: "loading", projects: [], error: null }));

export function useLibrary<T>(selector: (state: LibraryState) => T): T {
  return useStore(libraryStore, selector);
}

export async function refreshLibrary(): Promise<void> {
  try {
    const projects = await browserLibrary().list();
    libraryStore.setState({ status: "ready", projects, error: null });
  } catch (error) {
    console.error("Couldn't list projects:", error);
    libraryStore.setState({ status: "error", error: (error as Error).message || "Browser storage is unavailable." });
  }
}

const now = () => new Date().toISOString();

/** The editor URL for a project; "rooms" opens on the room picker, "concepts" on generated layouts, "refine" on the active plan. */
export const editorHref = (id: string, start?: "draw" | "concepts" | "rooms" | "refine") => `/editor?project=${encodeURIComponent(id)}${start ? `&start=${start}` : ""}`;

async function add(project: ProjectDocument): Promise<string> {
  await browserLibrary().create(project);
  void refreshLibrary();
  return project.id;
}

/** Adds a project made just now: it starts with today's look unless it brings its own. */
function addNew(project: ProjectDocument): Promise<string> {
  return add({ appearance: NEW_PROJECT_APPEARANCE, ...project });
}

/** A new project with a rectangular house of the given dimensions. Throws with a readable message. */
export async function createProjectFromDimensions(values: CreateHouseValues, details?: ProjectDetails): Promise<string> {
  const id = newDocumentId();
  const plan = createPlanDocument({
    id: newDocumentId(),
    name: values.name,
    width: values.width,
    depth: values.depth,
    externalThickness: values.externalThickness,
    wallHeight: values.wallHeight,
    ...(values.outline ? { outline: values.outline } : {}),
  });
  // The internal wall thickness is an editor default rather than part of the plan.
  editorStores.session.setState((s) => ({ settings: { ...s.settings, internalThickness: values.internalThickness } }));
  return addNew({ ...projectFromPlan(plan, { now: now() }), id, ...(details ? { details } : {}) });
}

/** A new project with the default house outline, or the given one, ready for drawing walls. */
export async function createBlankProject(name = "Untitled house", details?: ProjectDetails, outline?: Point2[]): Promise<string> {
  const plan = createPlanDocument({ id: newDocumentId(), name, ...(outline ? { outline } : {}) });
  return addNew({ ...projectFromPlan(plan, { now: now() }), id: newDocumentId(), ...(details ? { details } : {}) });
}

/**
 * A new project that starts by picking rooms: the house is sized from the
 * rooms, and the editor opens on the room picker with a typical family home
 * picked. Throws with a readable message if the rooms can't be laid out.
 */
export async function createRoomsProject(options: { name: string; plot?: PlotLimits; details?: ProjectDetails; houseShape?: HouseShape }): Promise<string> {
  const { houseShape, ...rest } = options;
  const brief = { ...STARTING_BRIEF, ...(houseShape ? { houseShape } : {}) };
  const result = projectFromRooms(brief, { id: newDocumentId(), idPrefix: newIdPrefix(), now: now(), count: 0, ...rest });
  if (!result.ok) throw new Error(result.message);
  return addNew(result.project);
}

/**
 * Home's "Start designing": reopens the newest rooms-first project nobody has
 * touched yet, or starts one with a typical family home picked. Clicking it
 * twice never leaves two empty projects behind.
 */
export async function startDesigning(): Promise<string> {
  const projects = await browserLibrary().list();
  const draft = projects.find((p) => p.project && isUntouchedDraft(p.project));
  return draft ? draft.id : createRoomsProject({ name: DRAFT_NAME });
}

/**
 * Opens a "Send to my computer" link (see domain/project/startLink.ts): the
 * project it made before if that's still here, otherwise a new one. Null
 * when the link is damaged or its plan doesn't check out.
 */
export async function openSentLink(payload: string): Promise<string | null> {
  const snapshot = await decodeSnapshot(payload);
  if (!snapshot) return null;
  const id = await snapshotProjectId(payload);
  const exists = async () => (await browserLibrary().list()).some((p) => p.id === id);
  if (await exists()) return id;
  const project = projectFromSnapshot(snapshot, { id, idPrefix: newIdPrefix(), now: now() });
  if (!project) return null;
  try {
    return await addNew(project);
  } catch (error) {
    // Opened twice at once (a re-run effect): the other open made it.
    if (await exists()) return id;
    throw error;
  }
}

/** A new project from a house in the catalogue: its rooms, five layouts with the catalogue's first, and its look. */
export async function createProjectFromCatalogue(entry: CatalogueEntry): Promise<string> {
  const result = projectFromRooms(entry.brief, { id: newDocumentId(), idPrefix: newIdPrefix(), now: now(), name: entry.name, count: 5 });
  if (!result.ok) throw new Error(result.message);
  return add({ ...result.project, appearance: catalogueAppearance(entry) });
}

export async function createProjectFromTemplate(template: ProjectTemplate): Promise<string> {
  const project = projectFromTemplate(template, { id: newDocumentId(), idPrefix: newIdPrefix(), now: now() });
  if (!project) throw new Error(`The ${template.name} template couldn't be laid out.`);
  return addNew(project);
}

/**
 * Adds an already validated project file to the library as a new project.
 * It always gets a new id, so importing the same file twice never overwrites a project.
 */
export async function createProjectFromImport(project: ProjectDocument, name: string, details?: ProjectDetails): Promise<string> {
  // A saved project keeps its look: without one it stays flat-roofed, as it was made.
  return add({ ...project, id: newDocumentId(), name: name.trim() || project.name, ...(details ? { details } : {}) });
}

export async function renameProject(id: string, name: string): Promise<void> {
  await browserLibrary().rename(id, name);
  await refreshLibrary();
}

export async function duplicateProject(id: string): Promise<void> {
  await browserLibrary().duplicate(id, newDocumentId());
  await refreshLibrary();
}

export async function deleteProject(id: string): Promise<void> {
  await browserLibrary().remove(id);
  await refreshLibrary();
}
