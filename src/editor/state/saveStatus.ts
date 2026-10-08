import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { SaveStatus } from "@/persistence/autosave";

export const saveStatusStore = createStore<{ status: SaveStatus; previousAvailable: boolean }>(() => ({
  status: { state: "idle" },
  previousAvailable: false,
}));

export const setSaveStatus = (status: SaveStatus) =>
  saveStatusStore.setState((s) => ({ status, previousAvailable: s.previousAvailable || status.state === "saved" }));

export function useSaveStatus() {
  return useStore(saveStatusStore);
}
