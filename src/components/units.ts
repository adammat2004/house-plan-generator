"use client";

import { useCallback, useSyncExternalStore } from "react";
import { areaText, showsSquareFeet, type AreaUnits } from "@/domain/geometry/units";

/**
 * The area-units preference, kept per browser like the profile name. Unset
 * means "auto": square feet alongside m² for en-GB browsers.
 */

const KEY = "homedesign.units.area";
const listeners = new Set<() => void>();

function readUnits(): AreaUnits {
  try {
    const value = localStorage.getItem(KEY);
    return value === "metric" || value === "both" ? value : "auto";
  } catch {
    return "auto";
  }
}

export function setAreaUnits(units: AreaUnits) {
  try {
    if (units === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, units);
  } catch {
    // Private windows may refuse storage; the choice lasts until the page closes.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const readSquareFeet = () => showsSquareFeet(readUnits(), navigator.language);

/** The stored choice ("auto" when unset). */
export function useAreaUnits(): AreaUnits {
  return useSyncExternalStore(subscribe, readUnits, () => "auto");
}

/** Whether areas show square feet too. False while server rendering. */
export function useSquareFeet(): boolean {
  return useSyncExternalStore(subscribe, readSquareFeet, () => false);
}

/** Formats an area in the reader's units: `area(152)` → "152 m² · 1,636 sq ft" for UK browsers. */
export function useAreaText(): (m2: number, digits?: number) => string {
  const sqft = useSquareFeet();
  return useCallback((m2: number, digits = 0) => areaText(m2, { sqft, digits }), [sqft]);
}
