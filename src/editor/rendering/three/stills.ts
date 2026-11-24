import { styleResolver } from "@/domain/interior/itemStyles";
import * as THREE from "three";
import { groundLevel, levelOf } from "@/domain/plan/levels";
import type { Rect } from "@/domain/geometry/vector";
import type { Level, PlanDocument } from "@/domain/plan/types";
import { effectiveRoofPitch } from "@/domain/project/exterior";
import type { Appearance } from "@/domain/project/schema";
import { exteriorAnglePose } from "../scene/exteriorAngles";
import { aerialCameraPose, exteriorCameraPose, roomCameraPose, spotCameraPose, type CameraPose } from "../scene/roomCamera";
import type { StillTarget } from "@/domain/design/renderRequest";
import { buildBuildingModel, planOf } from "./buildingModel";
import { ensureFurnitureModels, furnitureModels, furnitureModelsGeneration } from "./furnitureAssets";
import type { HouseModel } from "./houseModel";
import { applyLighting, buildHouse, clearGroup, TextureCache, type LightTarget } from "./sceneBuilder";

/**
 * Still images of any plan from 3D, without the interactive viewer on
 * screen: a room from inside, or the house from the garden. One shared
 * off-screen renderer (browsers allow only a handful of WebGL contexts) and
 * a small cache of built scenes, so a board of concept cards stays cheap.
 */

export type StillView = StillTarget;

export interface StillOptions {
  width: number;
  height: number;
  appearance: Appearance;
  /** JPEG quality, 0–1. */
  quality?: number;
}

interface Prepared extends LightTarget {
  plan: PlanDocument;
  model: HouseModel;
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
  // ?webgl=off: behave as on a machine without WebGL, to check the pages still read without pictures.
  if (new URLSearchParams(window.location.search).get("webgl") === "off") {
    unavailable = true;
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.localClippingEnabled = true;
    canvas.addEventListener("webglcontextlost", () => disposeStills());
    return renderer;
  } catch {
    unavailable = true;
    return null;
  }
}

function prepare(plan: PlanDocument, appearance: Appearance, mode: StillView["kind"], r: THREE.WebGLRenderer): Prepared {
  const interior = mode === "room";
  // Scenes built while furniture models were still loading are built again once they've come.
  const key = JSON.stringify([appearance, mode, furnitureModelsGeneration()]);
  const hit = prepared.find((p) => p.plan === plan && p.key === key);
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
  const model = buildBuildingModel(plan, { cutaway: false, roof: mode !== "aerial", dimensions: false, landscape: true, furniture: true, roofForm: appearance.roofForm, roofPitch: effectiveRoofPitch(appearance) });
  buildHouse(group, model, { appearance, ground: "lawn", landscape: true, labels: false }, textures, furnitureModels);
  if (interior) {
    // A plain white ceiling on every floor, as rooms have, and none over the garden.
    const paint = new THREE.MeshStandardMaterial({ color: "#f4f2ee", roughness: 0.95 });
    for (const { rect: o, z } of model.ceilings ?? model.slabs.map((rect) => ({ rect, z: model.wallHeight }))) {
      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(o.maxX - o.minX, o.maxY - o.minY), paint);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set((o.minX + o.maxX) / 2, z - 0.002, -(o.minY + o.maxY) / 2);
      group.add(ceiling);
    }
  }
  const entry: Prepared = { plan, model, key, group, scene, renderer: r, hemi, sun, nightLights, exposure: 1 };
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

/** Where the camera stands; a room upstairs is seen from its own floor, and the house from outside is framed to its full height. */
function poseFor(plan: PlanDocument, model: HouseModel, view: StillView, aspect: number): CameraPose | null {
  const raise = (pose: CameraPose | null, eye: number, target: number): CameraPose | null =>
    pose && { ...pose, eye: { ...pose.eye, z: pose.eye.z + eye }, target: { ...pose.target, z: pose.target.z + target } };
  if (view.kind === "room") {
    const level = levelOf(plan, view.roomId);
    const z = level?.elevation ?? 0;
    if (!level) return null;
    return raise(view.spot ? spotCameraPose(view.spot, aspect) : roomCameraPose(level, view.roomId, aspect), z, z);
  }
  const ground = groundLevel(plan);
  const extra = Math.max(0, model.wallHeight - 3);
  if (view.kind === "aerial") return raise(aerialCameraPose(ground, aspect), extra, 0);
  const pose = raise(exteriorCameraPose(ground, aspect), extra * 0.6, extra / 2);
  // A tall house, or one under a pitched roof, is framed by its full height.
  const framed = pose && (extra > 0 || model.roofs) && model.outside ? backedOff(pose, model.outside, model.roofs ? (model.top ?? model.wallHeight) : model.wallHeight + PARAPET_TOP) : pose;
  return framed && exteriorAnglePose(framed, view.angle);
}

/** Roof slab and parapet above the tallest wall. */
const PARAPET_TOP = 0.55;

/**
 * Steps the camera back from a tall house until its full height fits the
 * frame with a margin: the single-storey framing goes by width alone, which
 * puts a compact two-storey house's wall across the whole picture.
 */
function backedOff(pose: CameraPose, outside: Rect, top: number): CameraPose {
  const dx = pose.eye.x - pose.target.x;
  const dy = pose.eye.y - pose.target.y;
  const distance = Math.hypot(dx, dy);
  const reach = Math.max(outside.maxX - outside.minX, outside.maxY - outside.minY) / 2;
  const needed = reach + (0.75 * top) / Math.tan((pose.vfov * Math.PI) / 360);
  const k = Math.max(1, needed / distance);
  return { ...pose, eye: { ...pose.eye, x: pose.target.x + dx * k, y: pose.target.y + dy * k } };
}

function draw(source: Level | PlanDocument, view: StillView, opts: StillOptions): HTMLCanvasElement | null {
  const r = getRenderer();
  if (!r) return null;
  const plan = planOf(source);
  try {
    const { scene, exposure, model } = prepare(plan, opts.appearance, view.kind, r);
    const pose = poseFor(plan, model, view, opts.width / opts.height);
    if (!pose) return null;
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

/** Loads the furniture models a plan's stills will show; render after it resolves to get models rather than boxes. Never rejects. */
export function prepareStillModels(source: Level | PlanDocument, appearance: Appearance): Promise<void> {
  const plan = planOf(source);
  return ensureFurnitureModels(
    plan.levels.flatMap((level) => Object.values(level.furniture)),
    styleResolver(plan.levels, appearance.interiorStyle),
  );
}

/** A still of a plan (or one floor) as a JPEG data URL, or null where WebGL isn't available or the room is gone. */
export function renderStill(plan: Level | PlanDocument, view: StillView, opts: StillOptions): string | null {
  return draw(plan, view, opts)?.toDataURL("image/jpeg", opts.quality ?? 0.85) ?? null;
}

/** A still as a JPEG blob, for uploading. */
export async function renderStillBlob(plan: Level | PlanDocument, view: StillView, opts: StillOptions): Promise<Blob | null> {
  await prepareStillModels(plan, opts.appearance);
  const canvas = draw(plan, view, opts);
  if (!canvas) return null;
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
