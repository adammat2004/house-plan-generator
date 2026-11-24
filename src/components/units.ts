"use client";

import { useCallback, useSyncExternalStore } from "react";
import { areaText, lengthText as lengthIn, showsSquareFeet, sizeText as sizeIn, type AreaUnits } from "@/domain/geometry/units";

/**
 * The units preference, kept per browser like the profile name. Unset
 * means "auto": square feet alongside m² for en-GB browsers. "imperial"
 * shows every length in feet and inches and every area in square feet.
 */

const KEY = "homedesign.units.area";
const listeners = new Set<() => void>();

function readUnits(): AreaUnits {
  try {
    const value = localStorage.getItem(KEY);
    return value === "metric" || value === "both" || value === "imperial" ? value : "auto";
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

/**
 * Whether lengths show in feet and inches, for code outside React (the
 * plan's canvas, exports). Pages read the setting when they draw, and the
 * Settings page is its own route, so a change shows on the next visit.
 */
export const isImperial = () => readUnits() === "imperial";

/** Whether lengths show in feet and inches. False while server rendering. */
export function useImperial(): boolean {
  return useSyncExternalStore(subscribe, isImperial, () => false);
}

/** Whether areas show square feet too. False while server rendering. */
export function useSquareFeet(): boolean {
  return useSyncExternalStore(subscribe, readSquareFeet, () => false);
}

/** Formats an area in the reader's units: `area(152)` → "152 m² · 1,636 sq ft" for UK browsers. */
export function useAreaText(): (m2: number, digits?: number) => string {
  const sqft = useSquareFeet();
  const imperial = useImperial();
  return useCallback((m2: number, digits = 0) => areaText(m2, { sqft, digits, imperial }), [sqft, imperial]);
}

/** Formats a length in the reader's units: "3.60 m" or `11′ 10″`. */
export function useLengthText(): (m: number, digits?: number) => string {
  const imperial = useImperial();
  return useCallback((m: number, digits = 2) => lengthIn(m, { imperial, digits }), [imperial]);
}

/** Formats width by depth in the reader's units: "3.60 × 6.53 m" or `11′ 10″ × 21′ 5″`. */
export function useSizeText(): (w: number, d: number, digits?: number) => string {
  const imperial = useImperial();
  return useCallback((w: number, d: number, digits = 2) => sizeIn(w, d, { imperial, digits }), [imperial]);
}

/** A length in the reader's units, outside hooks: for the editor, which only draws in the browser. */
export const lengthText = (m: number, digits = 2) => lengthIn(m, { imperial: isImperial(), digits });

/** Width by depth in the reader's units, outside hooks: for the editor, which only draws in the browser. */
export const sizeText = (w: number, d: number, digits = 2) => sizeIn(w, d, { imperial: isImperial(), digits });

/** An area in m², or square feet in imperial, outside hooks: for detail rows in the editor. */
export const areaLabel = (m2: number, digits = 1) => areaText(m2, { imperial: isImperial(), digits });

