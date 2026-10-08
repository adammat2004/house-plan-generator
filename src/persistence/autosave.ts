import type { ProjectDocument } from "@/domain/project/schema";
import type { PlanStorage } from "./planStorage";

export type SaveStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "saving" }
  | { state: "saved"; at: number }
  | { state: "error"; message: string };

/** What autosave watches: committed project content, never previews or session state. */
export interface AutosaveSource {
  /** Calls back whenever committed content may have changed. */
  subscribe(onChange: () => void): () => void;
  /** Identity of the committed content; equal keys mean there is nothing new to save. */
  key(): readonly unknown[];
  snapshot(): ProjectDocument;
}

const sameKey = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Debounced autosave of the latest committed project. Previews, history and
 * in-progress gestures are never written. Failures are reported and retried
 * on the next edit; the in-memory project is never discarded.
 */
export function startAutosave(source: AutosaveSource, storage: PlanStorage, onStatus: (status: SaveStatus) => void, debounceMs = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved: readonly unknown[] = source.key();
  let lastSeen = lastSaved;
  let inFlight: Promise<void> | null = null;
  let queued = false;

  const flush = async () => {
    timer = null;
    if (inFlight) {
      queued = true;
      return;
    }
    const key = source.key();
    if (sameKey(key, lastSaved)) {
      onStatus({ state: "saved", at: Date.now() });
      return;
    }
    onStatus({ state: "saving" });
    inFlight = storage
      .save(source.snapshot())
      .then(() => {
        lastSaved = key;
        onStatus({ state: "saved", at: Date.now() });
      })
      .catch((error: Error) => {
        onStatus({ state: "error", message: error?.message || "Saving failed" });
      })
      .finally(() => {
        inFlight = null;
        if (queued) {
          queued = false;
          void flush();
        }
      });
  };

  const unsubscribe = source.subscribe(() => {
    const key = source.key();
    if (sameKey(key, lastSeen)) return;
    lastSeen = key;
    onStatus({ state: "pending" });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
  });

  // Stopping (e.g. leaving the editor) still writes a change that is waiting for its debounce.
  return () => {
    unsubscribe();
    if (timer) {
      clearTimeout(timer);
      void flush();
    }
  };
}

/** Saves immediately (used right after loading or creating a plan). */
export function markForSave(storage: PlanStorage, project: ProjectDocument, onStatus: (s: SaveStatus) => void) {
  onStatus({ state: "saving" });
  return storage.save(project).then(
    () => onStatus({ state: "saved", at: Date.now() }),
    (error: Error) => onStatus({ state: "error", message: error?.message || "Saving failed" }),
  );
}
