import { useStore } from "zustand";
import { createPlanDocument } from "@/domain/commands";
import { createStripPlanner } from "@/domain/design/stripPlanner";
import { browserLibrary } from "@/persistence/browserLibrary";
import { httpInterpreter } from "./aiInterpreter";
import { httpPhotoRenderer } from "./imageRenderer";
import { createRenders, type RendersState } from "./renders";
import { createDesignActions } from "./design";
import { createRoomOptions, type RoomOptionsState } from "./roomOptions";
import type { Level } from "@/domain/plan/types";
import { activeLevelOf, createEditorActions, createEditorStores, displayedDocument, type DocumentState, type ProjectState, type SessionState } from "./stores";

/** The application's editor instance. Tests create their own via createEditorStores. */
export const editorStores = createEditorStores(createPlanDocument({ id: "unsaved", name: "Untitled house" }));
export const editor = createEditorActions(editorStores);
const planner = createStripPlanner();
/** Design intents → planner → new plan variants. */
export const design = createDesignActions(editorStores, editor, planner, httpInterpreter());
/** What each quick action would do for the room picked in Refine, worked out in idle moments. */
export const roomOptions = createRoomOptions(editorStores, planner, design.remember);

export function useRoomOptions<T>(selector: (state: RoomOptionsState) => T): T {
  return useStore(roomOptions.store, selector);
}

export function useDocumentState<T>(selector: (state: DocumentState) => T): T {
  return useStore(editorStores.documents, selector);
}

export function useSessionState<T>(selector: (state: SessionState) => T): T {
  return useStore(editorStores.session, selector);
}

export function useProjectState<T>(selector: (state: ProjectState) => T): T {
  return useStore(editorStores.project, selector);
}

/** The floor being edited, from the committed plan (or, with `displayed`, from the preview while a gesture runs). */
export function useActiveLevel(displayed = false): Level {
  const id = useSessionState((s) => s.activeLevelId);
  return useDocumentState((s) => activeLevelOf(displayed ? displayedDocument(s) : s.history.present, id));
}

/** Shrinks a photo for storage: JPEG, at most 1280 px wide. Falls back to the original. */
async function compressPhoto(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1280 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const small = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return small && small.size < blob.size ? small : blob;
  } catch {
    return blob;
  }
}

/** Photo renders of the open project's rooms. */
export const renders = createRenders({
  storage: {
    list: (projectId) => browserLibrary().renders.list(projectId),
    put: (record) => browserLibrary().renders.put(record),
    prune: (projectId, live) => browserLibrary().renders.prune(projectId, live),
  },
  renderer: httpPhotoRenderer(),
  // three.js loads only when a still is needed, so the home screen stays light.
  still: async (level, target, appearance) => (await import("../rendering/three/stills")).renderStillBlob(level, target, { width: 1024, height: 768, appearance }),
  compress: compressPhoto,
});

export function useRenders<T>(selector: (state: RendersState) => T): T {
  return useStore(renders.store, selector);
}
