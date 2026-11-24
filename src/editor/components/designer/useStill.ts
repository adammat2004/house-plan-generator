"use client";

import { useEffect, useState } from "react";
import type { Level, PlanDocument } from "@/domain/plan/types";
import type { Appearance } from "@/domain/project/schema";
import { targetKey } from "@/domain/design/renderRequest";
import { prepareStillModels, renderStill, type StillView } from "../../rendering/three/stills";

/**
 * 3D preview images for cards and galleries. Stills render one at a time,
 * a frame apart, only once their card is on screen and its furniture models
 * have loaded, and are cached per plan so scrolling back is instant.
 */

interface Size {
  width: number;
  height: number;
}

const cache = new WeakMap<Level | PlanDocument, Map<string, string | null>>();
const queue: Array<() => void> = [];
let pumping = false;

function pump() {
  if (pumping) return;
  pumping = true;
  requestAnimationFrame(function next() {
    const job = queue.shift();
    job?.();
    if (queue.length) requestAnimationFrame(next);
    else pumping = false;
  });
}

const keyOf = (view: StillView, size: Size, appearance: Appearance) => `${view.kind === "room" ? targetKey(view) : "exterior"}|${size.width}x${size.height}|${JSON.stringify(appearance)}`;

/** A cached still, if one was rendered already. */
export function cachedStill(level: Level | PlanDocument, view: StillView, size: Size, appearance: Appearance): string | null | undefined {
  return cache.get(level)?.get(keyOf(view, size, appearance));
}

/** Returns a ref for the element showing the still, and the still once it's ready (null if it can't be rendered). */
export function useStill(level: Level | PlanDocument, view: StillView, size: Size, appearance: Appearance): { ref: (el: Element | null) => void; url: string | null | undefined } {
  const key = keyOf(view, size, appearance);
  const [element, setElement] = useState<Element | null>(null);
  const [result, setResult] = useState<{ level: Level | PlanDocument; key: string; url: string | null } | null>(null);
  const known = cache.get(level)?.get(key);
  // The view as it is when the still is drawn; its key covers everything that changes the picture.
  const shown: StillView = view.kind === "room" ? view : { kind: "exterior" };

  useEffect(() => {
    if (!element || known !== undefined) return;
    let cancelled = false;
    let queued: (() => void) | null = null;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || queued) return;
      observer.disconnect();
      queued = () => {
        if (cancelled) return;
        const still = renderStill(level, shown, { ...size, appearance });
        if (!cache.has(level)) cache.set(level, new Map());
        cache.get(level)!.set(key, still);
        setResult({ level, key, url: still });
      };
      const job = queued;
      // Furniture models first, so the still shows them rather than boxes.
      void prepareStillModels(level, appearance).then(() => {
        if (cancelled) return;
        queue.push(job);
        pump();
      });
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (queued) {
        const i = queue.indexOf(queued);
        if (i >= 0) queue.splice(i, 1);
      }
    };
    // size and appearance are captured in key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, level, key, known]);

  const url = known !== undefined ? known : result && result.level === level && result.key === key ? result.url : undefined;
  // The state setter is stable, so it serves as a callback ref.
  return { ref: setElement, url };
}
