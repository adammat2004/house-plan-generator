import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { groundLevel, levelOf } from "@/domain/plan/levels";
import type { Id, PlanDocument, RoomType } from "@/domain/plan/types";
import type { Appearance } from "@/domain/project/schema";
import { PLAN_THEME } from "../konva/theme";
import { buildBuildingModel } from "./buildingModel";
import { ensureFurnitureModels, furnitureModels, furnitureModelsReady, placedItems } from "./furnitureAssets";
import type { HouseModel, HouseModelOptions } from "./houseModel";
import { roomCameraPose } from "../scene/roomCamera";
import { applyLighting, buildHouse, clearGroup, TextureCache, type Ground, type Lighting, type Sky } from "./sceneBuilder";

export type { Lighting };

/**
 * The three.js side of the 3D view: turns a HouseModel into meshes and runs
 * the camera, lights and picking. Plan (x, y) maps to three (x, −z), height
 * to +y. Imperative by design; ThreeView feeds it state from the stores.
 */

/** "exterior" is the garden-side quick view, orbitable like "orbit". */
export type CameraMode = "orbit" | "pan" | "walk" | "interior" | "aerial" | "exterior";

export interface ViewerState {
  plan: PlanDocument;
  /** The highest floor shown; every floor when absent. */
  upTo?: Id | null;
  display: HouseModelOptions;
  appearance: Appearance;
  lighting: Lighting;
  shadows: boolean;
  sunAzimuth: number;
  /** The site's north, degrees clockwise from up the plan. */
  north?: number;
  ground: Ground;
  sky: Sky;
  selectedRoomId: Id | null;
}

const EYE = 1.6;
const DAY_ROOMS: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining", "office"]);

export class HouseViewer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  private readonly controls: OrbitControls;
  readonly hemi = new THREE.HemisphereLight();
  readonly sun = new THREE.DirectionalLight();
  private house = new THREE.Group();
  readonly nightLights = new THREE.Group();
  private floors: THREE.Mesh[] = [];
  private model: HouseModel | null = null;
  private state: ViewerState | null = null;
  private houseKey = "";
  private mode: CameraMode = "orbit";
  private readonly textures = new TextureCache();
  private readonly keys = new Set<string>();
  private walk = { yaw: 0, pitch: -0.05 };
  private down: { x: number; y: number; id: number } | null = null;
  private last = performance.now();
  private active = true;
  private readonly onSelect: (roomId: Id | null) => void;

  constructor(private readonly container: HTMLElement, onSelect: (roomId: Id | null) => void) {
    this.onSelect = onSelect;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Furniture models are cut by a clipping plane in the cutaway.
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.className = "three-canvas";
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "three-labels";
    container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    // Lighter shadows read calmer, and keep the shaded side of the house legible.
    this.sun.shadow.intensity = 0.7;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.house, this.nightLights);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.pointerDown);
    el.addEventListener("pointermove", this.pointerMove);
    el.addEventListener("pointerup", this.pointerUp);
    el.addEventListener("keydown", this.keyDown);
    el.addEventListener("keyup", this.keyUp);
    el.addEventListener("blur", () => this.keys.clear());
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  // ── State ────────────────────────────────────────────────────────────
  update(state: ViewerState) {
    const prev = this.state;
    this.state = state;
    const key = JSON.stringify([state.display, state.appearance, state.ground]);
    const rebuilt = !prev || prev.plan !== state.plan || prev.upTo !== state.upTo || key !== this.houseKey;
    if (rebuilt) {
      this.houseKey = key;
      this.rebuild();
      if (!prev) this.setCamera("orbit");
    }
    if (rebuilt || prev.lighting !== state.lighting || prev.shadows !== state.shadows || prev.sunAzimuth !== state.sunAzimuth || prev.north !== state.north || prev.sky !== state.sky) this.light();
    if (rebuilt || prev.selectedRoomId !== state.selectedRoomId) this.highlight();
  }

  setActive(active: boolean) {
    this.active = active;
    if (active) this.last = performance.now();
  }

  /** Widths covered by panels on the left and right; the view is centred in what's left. */
  private insets = { left: 0, right: 0 };

  setInsets(left: number, right: number) {
    if (left === this.insets.left && right === this.insets.right) return;
    this.insets = { left, right };
    this.resize();
  }

  resize() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Shift the picture left by half the covered width so the house sits in the visible part.
    const shift = Math.max(-w / 4, Math.min((this.insets.right - this.insets.left) / 2, w / 4));
    if (shift !== 0) this.camera.setViewOffset(w, h, shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ── Building ─────────────────────────────────────────────────────────
  private rebuild() {
    const state = this.state!;
    clearGroup(this.house, this.textures);
    const options = { ...state.display, roofForm: state.appearance.roofForm, upTo: state.upTo };
    let model: ReturnType<typeof buildBuildingModel>;
    try {
      model = buildBuildingModel(state.plan, options);
    } catch (error) {
      // The roof is the fragile part (polygon unions); the house still shows without it.
      console.warn("The roof couldn't be built, so the house is shown without it.", error);
      model = buildBuildingModel(state.plan, { ...options, roof: false });
    }
    this.model = model;
    this.floors = buildHouse(this.house, model, { appearance: state.appearance, ground: state.ground, landscape: state.display.landscape, labels: true }, this.textures, furnitureModels);
    // Furniture shows as boxes until its models arrive, then the house is built again with them.
    const items = placedItems(model.furniture);
    const style = state.appearance.interiorStyle;
    this.modelsReady = furnitureModelsReady(items, style)
      ? Promise.resolve()
      : ensureFurnitureModels(items, style).then(() => {
          if (this.model !== model || this.disposed) return;
          this.rebuild();
          this.highlight();
        });
  }

  private modelsReady: Promise<void> = Promise.resolve();
  private disposed = false;

  /** Resolves once the furniture models the current house needs are drawn. */
  async furnitureReady(): Promise<void> {
    let seen: Promise<void> | null = null;
    while (seen !== this.modelsReady) {
      seen = this.modelsReady;
      await seen;
    }
  }

  /** How many pieces are drawn from library models, and how many from boxes. */
  furnitureStats(): { models: number; boxes: number } {
    let models = 0;
    const boxed = new Set<string>();
    this.house.traverse((o) => {
      if (o.userData.furnitureId && !(o instanceof THREE.Mesh)) models++;
    });
    for (const b of this.model?.boxes ?? []) if (b.furnitureId) boxed.add(b.furnitureId);
    return { models, boxes: Math.max(0, boxed.size - models) };
  }

  private light() {
    applyLighting(this, this.model, this.state!, this.textures);
  }

  private highlight() {
    const id = this.state?.selectedRoomId ?? null;
    for (const mesh of this.floors) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const selected = mesh.userData.roomId === id;
      material.emissive.set(selected ? PLAN_THEME.accent : "#000000");
      material.emissiveIntensity = selected ? 0.35 : 0;
    }
  }

  // ── Cameras ──────────────────────────────────────────────────────────
  private frame() {
    const o = this.model?.outside ?? { minX: -5, minY: -5, maxX: 5, maxY: 5 };
    const c = new THREE.Vector3((o.minX + o.maxX) / 2, 0, -(o.minY + o.maxY) / 2);
    const size = Math.max(o.maxX - o.minX, o.maxY - o.minY, 4);
    // How much taller than a bungalow the house stands: cameras rise and aim higher by part of it.
    const extra = Math.max(0, (this.model?.wallHeight ?? 0) - 3);
    return { o, c, size, extra };
  }

  /** Room to stand in: the given one, the selected one, else the largest day room. */
  private interiorRoom(roomId?: Id | null) {
    const floors = this.model?.floors ?? [];
    const id = roomId ?? this.state?.selectedRoomId;
    return floors.find((f) => f.roomId === id) ?? [...floors].filter((f) => DAY_ROOMS.has(f.type)).sort((a, b) => b.area - a.area)[0] ?? floors[0];
  }

  /** Where a camera mode stands and looks. */
  private pose(mode: CameraMode, roomId?: Id | null): { position: THREE.Vector3; target: THREE.Vector3 } {
    const { o, c, size, extra } = this.frame();
    if (mode === "aerial") return { position: new THREE.Vector3(c.x + size * 0.15, size * 1.9 + extra, c.z + size * 0.55), target: c.clone() };
    if (mode === "interior") {
      const room = this.interiorRoom(roomId);
      const level = room && this.state ? levelOf(this.state.plan, room.roomId) : undefined;
      const view = room && level ? roomCameraPose(level, room.roomId, this.camera.aspect || 1.5) : null;
      if (view) {
        const z = room!.z ?? 0;
        return { position: new THREE.Vector3(view.eye.x, view.eye.z + z, -view.eye.y), target: new THREE.Vector3(view.target.x, view.target.z + z, -view.target.y) };
      }
    }
    if (mode === "walk") {
      // Start outside the front (south) of the house, looking in.
      return { position: new THREE.Vector3(c.x, EYE, -(o.minY - 3)), target: new THREE.Vector3(c.x, EYE, c.z) };
    }
    if (mode === "exterior") {
      // From the garden, across the rear corner.
      const ground = this.state ? groundLevel(this.state.plan) : null;
      const env = ground ? analyzeEnvelope(ground) : null;
      const rear = env?.ok && ground?.rearWallId ? env.info.sideOfWall[ground.rearWallId] : "north";
      const dir = { north: [0.45, 1], south: [-0.45, -1], east: [1, -0.45], west: [-1, 0.45] }[rear];
      return { position: new THREE.Vector3(c.x + dir[0] * size * 1.7, 3.2 + extra * 0.6, c.z - dir[1] * size * 1.7), target: new THREE.Vector3(c.x, 1.2 + extra / 2, c.z) };
    }
    return { position: new THREE.Vector3(c.x + size * 0.85, size * 1.05 + extra * 0.6, c.z + size * 1.25), target: new THREE.Vector3(c.x, 0.6 + extra / 2, c.z) };
  }

  setCamera(mode: CameraMode, roomId?: Id | null) {
    this.mode = mode;
    // Wider lens inside, as a person would see the room.
    this.camera.fov = mode === "interior" || mode === "walk" ? 68 : 45;
    this.camera.updateProjectionMatrix();
    const { position, target } = this.pose(mode === "pan" ? "orbit" : mode, roomId);
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.enabled = mode !== "walk";
    this.controls.mouseButtons = {
      LEFT: mode === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: mode === "pan" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
    };
    this.controls.minDistance = mode === "interior" ? 0.3 : 2;
    this.controls.maxDistance = 120;
    this.camera.lookAt(target);
    if (mode === "walk") {
      const d = target.clone().sub(position);
      this.walk = { yaw: Math.atan2(-d.x, -d.z), pitch: -0.05 };
      this.renderer.domElement.focus();
    }
    this.controls.update();
  }

  // ── Input ────────────────────────────────────────────────────────────
  private pointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    if (this.mode === "walk") this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private pointerMove = (e: PointerEvent) => {
    if (this.mode !== "walk" || !this.down || this.down.id !== e.pointerId) return;
    this.walk.yaw -= e.movementX * 0.005;
    this.walk.pitch = Math.max(-1.2, Math.min(1.2, this.walk.pitch - e.movementY * 0.005));
  };

  private pointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    // A click, not a drag: pick the room under the pointer.
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.floors, false)[0];
    this.onSelect((hit?.object.userData.roomId as Id | undefined) ?? null);
  };

  private keyDown = (e: KeyboardEvent) => {
    if (this.mode !== "walk") return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      e.preventDefault();
      e.stopPropagation();
      this.keys.add(k);
    }
  };

  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  private tick = () => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.active) return;
    if (this.mode === "walk") {
      const forward = (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0) - (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0);
      const strafe = (this.keys.has("d") ? 1 : 0) - (this.keys.has("a") ? 1 : 0);
      this.walk.yaw += ((this.keys.has("arrowleft") ? 1 : 0) - (this.keys.has("arrowright") ? 1 : 0)) * dt * 1.6;
      const speed = 2.2 * dt;
      const p = this.camera.position;
      p.x += (-Math.sin(this.walk.yaw) * forward + Math.cos(this.walk.yaw) * strafe) * speed;
      p.z += (-Math.cos(this.walk.yaw) * forward - Math.sin(this.walk.yaw) * strafe) * speed;
      // Stay within the site around the house.
      const { o } = this.frame();
      p.x = Math.max(o.minX - 8, Math.min(o.maxX + 8, p.x));
      p.z = Math.max(-(o.maxY + 8), Math.min(-(o.minY - 8), p.z));
      p.y = EYE;
      this.camera.rotation.set(this.walk.pitch, this.walk.yaw, 0, "YXZ");
    } else this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };

  // ── Output ───────────────────────────────────────────────────────────
  /** The current view as a PNG data URL. */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** The house (without labels) as a binary glTF. */
  async exportGlb(): Promise<Blob> {
    const exporter = new GLTFExporter();
    const meshes = new THREE.Group();
    this.house.updateWorldMatrix(true, true);
    this.house.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // Library models sit inside a placed, scaled group: export each mesh where it actually is.
      const copy = o.clone();
      o.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
      meshes.add(copy);
    });
    const result = await exporter.parseAsync(meshes, { binary: true });
    return new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.pointerDown);
    el.removeEventListener("pointermove", this.pointerMove);
    el.removeEventListener("pointerup", this.pointerUp);
    el.removeEventListener("keydown", this.keyDown);
    el.removeEventListener("keyup", this.keyUp);
    this.controls.dispose();
    clearGroup(this.house, this.textures);
    clearGroup(this.nightLights, this.textures);
    this.textures.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelRenderer.domElement.remove();
  }
}
