import type { HouseViewer } from "./viewer";

/**
 * The mounted 3D viewer, so chrome outside it (the export menu) can use it
 * without importing three.js. Type-only imports keep this module light.
 */
let current: HouseViewer | null = null;
let waiting: Array<() => void> = [];

export function registerViewer(viewer: HouseViewer | null) {
  current = viewer;
  if (viewer) {
    const ready = waiting;
    waiting = [];
    // A frame later, so the first picture is drawn.
    requestAnimationFrame(() => requestAnimationFrame(() => ready.forEach((resolve) => resolve())));
  }
}

/** Resolves once a 3D viewer is on the page (at once if one is), or false after `timeout` ms. */
export function whenViewerReady(timeout = 8000): Promise<boolean> {
  if (current) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      waiting = waiting.filter((w) => w !== done);
      resolve(false);
    }, timeout);
    waiting.push(done);
  });
}

/** Resolves once the viewer's furniture models are drawn (at once if there's no viewer). */
export function whenFurnitureReady(): Promise<void> {
  return current?.furnitureReady() ?? Promise.resolve();
}

/** How many pieces the viewer draws from library models and from boxes, or null with no viewer. */
export function furnitureStats3d(): { models: number; boxes: number } | null {
  return current?.furnitureStats() ?? null;
}

export function snapshot3d(): string | null {
  return current?.snapshot() ?? null;
}

export function exportModel(): Promise<Blob> | null {
  return current?.exportGlb() ?? null;
}
