import { useEffect, useSyncExternalStore } from "react";
import type { Furniture } from "@/domain/plan/types";
import type { InteriorStyle } from "@/domain/project/schema";
import { assetForItem, assetScale, type FurnitureAsset } from "../assets/manifest";

/**
 * The asset library's pictures of furniture seen from above (ADR 0012), for
 * the plan. Each loads once and is shared; until it has, or where there's no
 * picture, a piece is drawn from its symbol as before.
 */

const images = new Map<string, HTMLImageElement>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function load(url: string): Promise<void> {
  let pending = loading.get(url);
  if (!pending) {
    pending = new Promise<void>((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        images.set(url, img);
        version++;
        for (const fn of listeners) fn();
        resolve();
      };
      // A picture that won't load leaves the piece drawn from its symbol.
      img.onerror = () => resolve();
      img.src = url;
    });
    loading.set(url, pending);
  }
  return pending;
}

/** Loads the pictures a set of furniture needs. Never rejects. */
export function loadFurnitureSprites(items: Iterable<Furniture>, style: InteriorStyle | undefined): Promise<void> {
  const urls = new Set<string>();
  for (const item of items) {
    const asset = assetForItem(item, style);
    if (asset) urls.add(asset.sprite.url);
  }
  return Promise.all([...urls].map(load)).then(() => undefined);
}

/** Resolves once every picture asked for so far has loaded or failed, or after `timeout` ms. */
export function spritesSettled(timeout = 3000): Promise<void> {
  return Promise.race([Promise.all(loading.values()).then(() => undefined), new Promise<void>((r) => setTimeout(r, timeout))]);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Loads the pictures for the furniture shown, and changes whenever one arrives so the plan redraws. */
export function useFurnitureSprites(items: Furniture[], style: InteriorStyle | undefined, enabled: boolean): number {
  useEffect(() => {
    if (enabled) void loadFurnitureSprites(items, style);
  }, [items, style, enabled]);
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

export interface SpritePlacement {
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleY: number;
}

/**
 * Where an item's picture goes on the plan. The picture has the piece's back
 * at the top and a margin of shadow round it; the plan is drawn with y up, so
 * the picture is flipped back (scaleY −1) and turned like the item.
 */
export function spriteTransform(item: Furniture, asset: FurnitureAsset): Omit<SpritePlacement, "image"> {
  const [sx, , sz] = assetScale(item, asset);
  const width = (asset.sprite.width / asset.sprite.pxPerM) * sx;
  const height = (asset.sprite.height / asset.sprite.pxPerM) * sz;
  return { x: item.position.x, y: item.position.y, width, height, offsetX: width / 2, offsetY: height / 2, rotation: item.rotation, scaleY: -1 };
}

/** An item's picture and where it goes, or null to draw its symbol. */
export function spriteFor(item: Furniture, style: InteriorStyle | undefined): SpritePlacement | null {
  const asset = assetForItem(item, style);
  const image = asset && images.get(asset.sprite.url);
  return asset && image ? { image, ...spriteTransform(item, asset) } : null;
}
