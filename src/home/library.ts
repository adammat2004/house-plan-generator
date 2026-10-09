"use client";

import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createPlanDocument } from "@/domain/commands";
import type { Point2 } from "@/domain/plan/types";
import { projectFromPlan, type ProjectDetails, type ProjectDocument } from "@/domain/project/schema";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseShape } from "@/domain/brief/schema";
import type { PlotLimits } from "@/domain/design/footprint";
import { projectFromRooms } from "@/domain/project/fromRooms";
import { projectFromTemplate, type ProjectTemplate } from "@/domain/project/templates";
import { editorStores } from "@/editor/state/editor";
import type { CreateHouseValues } from "@/editor/components/CreateHouseDialog";
import { newDocumentId, newIdPrefix } from "@/editor/state/ids";
import { browserLibrary } from "@/persistence/browserLibrary";
import type { ProjectSummary } from "@/persistence/planStorage";

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
    libraryStore.setState({ status: "error", error: (error as Error).message || "Browser storage is unavailable." });
  }
}

const now = () => new Date().toISOString();

/** The editor URL for a project; "rooms" opens on the room picker, "concepts" on generated layouts. */
export const editorHref = (id: string, start?: "draw" | "concepts" | "rooms") => `/editor?project=${encodeURIComponent(id)}${start ? `&start=${start}` : ""}`;

async function add(project: ProjectDocument): Promise<string> {
  await browserLibrary().create(project);
  void refreshLibrary();
  return project.id;
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
  return add({ ...projectFromPlan(plan, { now: now() }), id, ...(details ? { details } : {}) });
}

/** A new project with the default house outline, or the given one, ready for drawing walls. */
export async function createBlankProject(name = "Untitled house", details?: ProjectDetails, outline?: Point2[]): Promise<string> {
  const plan = createPlanDocument({ id: newDocumentId(), name, ...(outline ? { outline } : {}) });
  return add({ ...projectFromPlan(plan, { now: now() }), id: newDocumentId(), ...(details ? { details } : {}) });
}

/**
 * A new project that starts by picking rooms: the house is sized from the
 * rooms, and the editor opens on the room picker with a typical family home
 * picked. Throws with a readable message if the rooms can't be laid out.
 */
export async function createRoomsProject(options: { name: string; plot?: PlotLimits; details?: ProjectDetails; houseShape?: HouseShape }): Promise<string> {
  const { houseShape, ...rest } = options;
  const brief = { ...withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === "family-3")!.picks), ...(houseShape ? { houseShape } : {}) };
  const result = projectFromRooms(brief, { id: newDocumentId(), idPrefix: newIdPrefix(), now: now(), count: 0, ...rest });
  if (!result.ok) throw new Error(result.message);
  return add(result.project);
}

export async function createProjectFromTemplate(template: ProjectTemplate): Promise<string> {
  const project = projectFromTemplate(template, { id: newDocumentId(), idPrefix: newIdPrefix(), now: now() });
  if (!project) throw new Error(`The ${template.name} template couldn't be laid out.`);
  return add(project);
}

/**
 * Adds an already validated project file to the library as a new project.
 * It always gets a new id, so importing the same file twice never overwrites a project.
 */
export async function createProjectFromImport(project: ProjectDocument, name: string, details?: ProjectDetails): Promise<string> {
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
