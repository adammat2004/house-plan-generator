import type { HouseViewer, PreviewView } from "./viewer";

/**
 * The mounted 3D viewer, so chrome outside it (export menu, quick views) can
 * use it without importing three.js. Type-only imports keep this module light.
 */
let current: HouseViewer | null = null;
const listeners = new Set<() => void>();

export function registerViewer(viewer: HouseViewer | null) {
  current = viewer;
  for (const l of listeners) l();
}

/** Called when a viewer mounts or unmounts. */
export function onViewerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const viewerReady = () => current !== null;

export function previewImage(view: PreviewView, width: number, height: number): string | null {
  return current?.preview(view, width, height) ?? null;
}

export function snapshot3d(): string | null {
  return current?.snapshot() ?? null;
}

export function exportModel(): Promise<Blob> | null {
  return current?.exportGlb() ?? null;
}
