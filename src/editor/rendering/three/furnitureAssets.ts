import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Furniture } from "@/domain/plan/types";
import { styleOfItem, type StyleArg, type StyleOf } from "@/domain/interior/itemStyles";
import type { InteriorStyle } from "@/domain/project/schema";
import { assetForItem, assetScale, type FurnitureAsset } from "../assets/manifest";
import type { FurniturePlacement } from "./houseModel";

/**
 * Furniture models from the asset library (ADR 0012), loaded once and
 * shared: every sofa in every scene is a copy of one loaded template whose
 * geometry and materials are marked `sharedAsset`, so clearing a scene
 * doesn't free them. Until a model has loaded, or where there's none, the
 * piece is drawn from boxes as before.
 */

export interface FurnitureModels {
  /** A placed copy of the item's model, or null to draw it from boxes. */
  instance(item: Furniture, style: InteriorStyle | undefined): THREE.Object3D | null;
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const templates = new Map<string, THREE.Object3D>();
const loading = new Map<string, Promise<void>>();
/** Models that have loaded or failed. */
const settled = new Set<string>();
const listeners = new Set<() => void>();
let generation = 0;

function markShared(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.userData.sharedAsset = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.userData.sharedAsset = true;
    }
  });
}

function load(asset: FurnitureAsset): Promise<void> {
  let pending = loading.get(asset.glb);
  if (!pending) {
    pending = loader
      .loadAsync(asset.glb)
      .then((gltf) => {
        markShared(gltf.scene);
        templates.set(asset.glb, gltf.scene);
        generation++;
      })
      // A model that won't load leaves the piece drawn from boxes.
      .catch(() => undefined)
      .then(() => {
        settled.add(asset.glb);
        for (const fn of listeners) fn();
      });
    loading.set(asset.glb, pending);
  }
  return pending;
}

/** Loads the models a set of furniture needs, in a style. Resolves when all have loaded or failed; never rejects. */
export function ensureFurnitureModels(items: Iterable<Furniture>, style: StyleArg): Promise<void> {
  const wanted = new Map<string, FurnitureAsset>();
  for (const item of items) {
    const asset = assetForItem(item, styleOfItem(style, item));
    if (asset && !templates.has(asset.glb)) wanted.set(asset.glb, asset);
  }
  return Promise.all([...wanted.values()].map(load)).then(() => undefined);
}

/** Whether every model a set of furniture needs has loaded (or failed, and will stay boxes). */
export function furnitureModelsReady(items: Iterable<Furniture>, style: StyleArg): boolean {
  for (const item of items) {
    const asset = assetForItem(item, styleOfItem(style, item));
    if (asset && !settled.has(asset.glb)) return false;
  }
  return true;
}

/** Changes each time a model finishes loading, so scenes built with box stand-ins know to rebuild. */
export const furnitureModelsGeneration = () => generation;

export function onFurnitureModelsLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The pieces of a plan's furniture, for loading their models. */
export const placedItems = (placements: FurniturePlacement[] | undefined) => (placements ?? []).map((p) => p.item);

/** The library as `buildHouse` uses it: a copy of a loaded model, scaled and turned like the item. */
export const furnitureModels: FurnitureModels = {
  instance(item, style) {
    const asset = assetForItem(item, styleOfItem(style, item));
    const template = asset && templates.get(asset.glb);
    if (!asset || !template) return null;
    const copy = template.clone(true);
    const holder = new THREE.Group();
    holder.add(copy);
    const [sx, sy, sz] = assetScale(item, asset);
    holder.scale.set(sx, sy, sz);
    holder.rotation.y = (item.rotation * Math.PI) / 180;
    holder.position.set(item.position.x, 0, -item.position.y);
    holder.userData.furnitureId = item.id;
    return holder;
  },
};

/** Each placed piece's style: its room's own where it has one, else the house's. */
export const placementStyles = (placements: FurniturePlacement[] | undefined, house: InteriorStyle | undefined): StyleOf => {
  const own = new Map((placements ?? []).filter((p) => p.style).map((p) => [p.item.id, p.style]));
  return (item) => own.get(item.id) ?? house;
};
