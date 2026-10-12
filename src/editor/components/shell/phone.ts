"use client";

import { useEffect, useSyncExternalStore } from "react";
import { editor } from "../../state/editor";

/**
 * Phones and narrow windows. Width alone picks the one-column layout; only
 * touch-only narrow screens are read-only, so a mouse in a narrow desktop
 * window still edits (in the phone layout) and a landscape iPad (1024 wide
 * and up) keeps the full editor.
 */

export const NARROW = "(max-width: 1023px)";
const COARSE = "(pointer: coarse)";
const ANY_FINE = "(any-pointer: fine)";

/** Plans are read-only on a narrow screen with only touch input. */
export function readOnlyFor(media: { narrow: boolean; coarse: boolean; anyFine: boolean }): boolean {
  return media.narrow && media.coarse && !media.anyFine;
}

const matches = (query: string) => typeof window !== "undefined" && window.matchMedia(query).matches;

function subscribe(queries: string[], listener: () => void) {
  const lists = queries.map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener("change", listener);
  return () => lists.forEach((l) => l.removeEventListener("change", listener));
}

/** True on screens under 1024px wide. False while server rendering. */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    (listener) => subscribe([NARROW], listener),
    () => matches(NARROW),
    () => false,
  );
}

/** Keeps `session.readOnly` in step with the device, including rotation and resizing. */
export function useReadOnlySync() {
  useEffect(() => {
    const update = () => editor.setReadOnly(readOnlyFor({ narrow: matches(NARROW), coarse: matches(COARSE), anyFine: matches(ANY_FINE) }));
    update();
    return subscribe([NARROW, COARSE, ANY_FINE], update);
  }, []);
}
