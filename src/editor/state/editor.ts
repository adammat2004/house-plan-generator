import { useStore } from "zustand";
import { createPlanDocument } from "@/domain/commands";
import { createStripPlanner } from "@/domain/design/stripPlanner";
import { createDesignActions } from "./design";
import { createEditorActions, createEditorStores, type DocumentState, type ProjectState, type SessionState } from "./stores";

/** The application's editor instance. Tests create their own via createEditorStores. */
export const editorStores = createEditorStores(createPlanDocument({ id: "unsaved", name: "Untitled house" }));
export const editor = createEditorActions(editorStores);
/** Design intents → planner → new plan variants. */
export const design = createDesignActions(editorStores, editor, createStripPlanner());

export function useDocumentState<T>(selector: (state: DocumentState) => T): T {
  return useStore(editorStores.documents, selector);
}

export function useSessionState<T>(selector: (state: SessionState) => T): T {
  return useStore(editorStores.session, selector);
}

export function useProjectState<T>(selector: (state: ProjectState) => T): T {
  return useStore(editorStores.project, selector);
}
