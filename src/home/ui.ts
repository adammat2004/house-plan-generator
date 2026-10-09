"use client";

import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

/** Home-screen UI state shared between the shell (header, dialogs) and the pages. */
interface HomeUiState {
  query: string;
  notice: { tone: "error" | "info"; message: string } | null;
}

export const homeUi = createStore<HomeUiState>(() => ({ query: "", notice: null }));

export function useHomeUi<T>(selector: (state: HomeUiState) => T): T {
  return useStore(homeUi, selector);
}

/** The new-project page, optionally with a starting method chosen. */
export const newProjectHref = (method?: "rooms" | "scratch" | "dimensions" | "import") => (method ? `/new?method=${method}` : "/new");
export const showHomeNotice = (tone: "error" | "info", message: string) => homeUi.setState({ notice: { tone, message } });

/** Relative "Edited 2 hours ago" wording. */
export function editedAgo(iso: string, nowMs = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - nowMs) / 1000);
  if (!Number.isFinite(seconds)) return "Edited recently";
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 45) return "Edited just now";
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];
  let unit = units[0];
  for (const u of units) if (abs >= u[1] * 0.9) unit = u;
  return `Edited ${fmt.format(Math.round(seconds / unit[1]), unit[0])}`;
}
