import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

/** What the 3D area shows: the live model, the exterior photo gallery, or the elevation drawings. */
export type PresentTab = "3d" | "gallery" | "elevations";

export const presentTabStore = createStore<{ tab: PresentTab }>(() => ({ tab: "3d" }));

export const setPresentTab = (tab: PresentTab) => presentTabStore.setState({ tab });

export const usePresentTab = () => useStore(presentTabStore, (s) => s.tab);
