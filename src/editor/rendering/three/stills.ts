import * as THREE from "three";
import type { Id, Level } from "@/domain/plan/types";
import type { Appearance } from "@/domain/project/schema";
import { aerialCameraPose, exteriorCameraPose, roomCameraPose, type CameraPose } from "../scene/roomCamera";
import { buildHouseModel } from "./houseModel";
import { applyLighting, buildHouse, clearGroup, TextureCache, type LightTarget } from "./sceneBuilder";

/**
 * Still images of any plan from 3D, without the interactive viewer on
 * screen: a room from inside, or the house from the garden. One shared
 * off-screen renderer (browsers allow only a handful of WebGL contexts) and
 * a small cache of built scenes, so a board of concept cards stays cheap.
 */

export type StillView = { kind: "exterior" } | { kind: "aerial" } | { kind: "room"; roomId: Id };

export interface StillOptions {
  width: number;
  height: number;
  appearance: Appearance;
  /** JPEG quality, 0–1. */
  quality?: number;
}

interface Prepared extends LightTarget {
  level: Level;
  key: string;
  group: THREE.Group;
  exposure: number;
}

const CACHE_SIZE = 3;
const textures = new TextureCache();
let renderer: THREE.WebGLRenderer | null = null;
let unavailable = false;
let prepared: Prepared[] = [];

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer || unavailable) return renderer;
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    canvas.addEventListener("webglcontextlost", () => disposeStills());
    return renderer;
  } catch {
    unavailable = true;
    return null;
  }
}

function prepare(level: Level, appearance: Appearance, mode: StillView["kind"], r: THREE.WebGLRenderer): Prepared {
  const interior = mode === "room";
  const key = JSON.stringify([appearance, mode]);
  const hit = prepared.find((p) => p.level === level && p.key === key);
  if (hit) {
    // Most recently used last.
    prepared = [...prepared.filter((p) => p !== hit), hit];
    return hit;
  }
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const nightLights = new THREE.Group();
  const group = new THREE.Group();
  scene.add(hemi, sun, sun.target, group, nightLights);
  // A roof gives rooms a ceiling; dimensions and cutaways are for the interactive view.
  // From above the roof comes off, to see into the rooms.
  const model = buildHouseModel(level, { cutaway: false, roof: mode !== "aerial", dimensions: false, landscape: true, furniture: true });
  buildHouse(group, model, { appearance, ground: "lawn", landscape: true, labels: false }, textures);
  if (interior) {
    // A plain white ceiling under the roof slabs, as rooms have, and none over the garden.
    const paint = new THREE.MeshStandardMaterial({ color: "#f4f2ee", roughness: 0.95 });
    for (const o of model.slabs) {
      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(o.maxX - o.minX, o.maxY - o.minY), paint);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set((o.minX + o.maxX) / 2, model.wallHeight - 0.002, -(o.minY + o.maxY) / 2);
      group.add(ceiling);
    }
  }
  const entry: Prepared = { level, key, group, scene, renderer: r, hemi, sun, nightLights, exposure: 1 };
  // Inside, the roof would shade every room from the sun; light rooms evenly instead.
  applyLighting(entry, model, { lighting: "midday", sky: "clear", shadows: !interior, sunAzimuth: 0 }, textures);
  if (interior) {
    hemi.intensity *= 1.6;
    r.toneMappingExposure = 1.15;
  }
  entry.exposure = r.toneMappingExposure;
  prepared.push(entry);
  while (prepared.length > CACHE_SIZE) {
    const old = prepared.shift()!;
    clearGroup(old.group, textures);
    clearGroup(old.nightLights, textures);
  }
  return entry;
}

function poseFor(level: Level, view: StillView, aspect: number): CameraPose | null {
  if (view.kind === "room") return roomCameraPose(level, view.roomId, aspect);
  return view.kind === "aerial" ? aerialCameraPose(level, aspect) : exteriorCameraPose(level, aspect);
}

function draw(level: Level, view: StillView, opts: StillOptions): HTMLCanvasElement | null {
  const r = getRenderer();
  if (!r) return null;
  const pose = poseFor(level, view, opts.width / opts.height);
  if (!pose) return null;
  try {
    const { scene, exposure } = prepare(level, opts.appearance, view.kind, r);
    r.toneMappingExposure = exposure;
    const camera = new THREE.PerspectiveCamera(pose.vfov, opts.width / opts.height, 0.05, 400);
    camera.position.set(pose.eye.x, pose.eye.z, -pose.eye.y);
    camera.lookAt(pose.target.x, pose.target.z, -pose.target.y);
    r.setSize(opts.width, opts.height, false);
    r.render(scene, camera);
    return r.domElement;
  } catch {
    return null;
  }
}

/** A still as a JPEG data URL, or null where WebGL isn't available or the room is gone. */
export function renderStill(level: Level, view: StillView, opts: StillOptions): string | null {
  return draw(level, view, opts)?.toDataURL("image/jpeg", opts.quality ?? 0.85) ?? null;
}

/** A still as a JPEG blob, for uploading. */
export function renderStillBlob(level: Level, view: StillView, opts: StillOptions): Promise<Blob | null> {
  const canvas = draw(level, view, opts);
  if (!canvas) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", opts.quality ?? 0.88));
}

/** Frees the renderer and cached scenes (also after a lost WebGL context). */
export function disposeStills() {
  for (const p of prepared) {
    clearGroup(p.group, textures);
    clearGroup(p.nightLights, textures);
  }
  prepared = [];
  renderer?.dispose();
  renderer = null;
}
