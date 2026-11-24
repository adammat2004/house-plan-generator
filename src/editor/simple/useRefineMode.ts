"use client";

import { useSyncExternalStore } from "react";
import { parseRefineMode, REFINE_MODE_KEY, type RefineMode } from "./mode";

/** Kept per browser, like the units and name preferences. */
const listeners = new Set<() => void>();
let memory: RefineMode | null = null;

const read = (): RefineMode => {
  try {
    return parseRefineMode(localStorage.getItem(REFINE_MODE_KEY));
  } catch {
    return "simple";
  }
};

export function setRefineMode(mode: RefineMode) {
  try {
    localStorage.setItem(REFINE_MODE_KEY, mode);
  } catch {
    // Private windows may refuse storage; the choice lasts until the page closes.
    memory = mode;
  }
  listeners.forEach((l) => l());
}

const current = (): RefineMode => memory ?? read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) =>
    e.key === REFINE_MODE_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const useRefineMode = (): RefineMode =>
  useSyncExternalStore(subscribe, current, () => "simple");
