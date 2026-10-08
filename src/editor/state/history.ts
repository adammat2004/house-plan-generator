import type { PlanDocument } from "@/domain/plan/types";

export const HISTORY_LIMIT = 100;

/**
 * Undo/redo over immutable document snapshots. Documents share unchanged
 * records, so keeping 100 entries in memory is cheap.
 */
export interface History {
  past: PlanDocument[];
  present: PlanDocument;
  future: PlanDocument[];
}

export function createHistory(present: PlanDocument): History {
  return { past: [], present, future: [] };
}

export function pushHistory(history: History, next: PlanDocument, limit = HISTORY_LIMIT): History {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export function undoHistory(history: History): History {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoHistory(history: History): History {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next, future: rest };
}
