import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Id, Level, RoomType } from "@/domain/plan/types";
import type { Appearance } from "@/domain/project/schema";
import { MATERIAL_FILL, PLAN_THEME, SITE_THEME } from "../konva/theme";
import { buildHouseModel, type Box, type HouseModel, type HouseModelOptions } from "./houseModel";

/**
 * The three.js side of the 3D view: turns a HouseModel into meshes and runs
 * the camera, lights and picking. Plan (x, y) maps to three (x, −z), height
 * to +y. Imperative by design; ThreeView feeds it state from the stores.
 */

/** "exterior" is the garden-side quick view, orbitable like "orbit". */
export type CameraMode = "orbit" | "pan" | "walk" | "interior" | "aerial" | "exterior";
export type Lighting = "morning" | "midday" | "evening" | "night";

export interface ViewerState {
  level: Level;
  display: HouseModelOptions;
  appearance: Appearance;
  lighting: Lighting;
  shadows: boolean;
  sunAzimuth: number;
  ground: "lawn" | "gravel" | "paving";
  sky: "clear" | "overcast";
  selectedRoomId: Id | null;
}

export type PreviewView = { kind: "exterior" } | { kind: "room"; roomId: Id };

const EYE = 1.6;
const DAY_ROOMS: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining", "office"]);

const EXTERIOR: Record<Appearance["exterior"], string> = { white_render: "#f1eee7", brick: "#9d5b43", timber: "#8c6a49", dark_render: "#33373a" };
const FRAMES: Record<Appearance["frames"], string> = { black: "#24282b", white: "#f4f4f1", oak: "#b4885a" };
const ROOF: Record<Appearance["roof"], string> = { membrane: "#3b3f42", zinc: "#8d949a" };
const GROUND: Record<ViewerState["ground"], string> = { lawn: "#8ea36a", gravel: "#cdc4b2", paving: "#d9d1c3" };

const LIGHTS: Record<Lighting, { azimuth: number; elevation: number; sun: string; sunPower: number; sky: string; ground: string; hemi: number; background: string }> = {
  morning: { azimuth: 100, elevation: 20, sun: "#ffd9a8", sunPower: 2.3, sky: "#cfe0f0", ground: "#b9a98f", hemi: 0.9, background: "#dfe8ee" },
  midday: { azimuth: 160, elevation: 58, sun: "#fff4e3", sunPower: 2.8, sky: "#d8e6f2", ground: "#bfb39c", hemi: 1.1, background: "#e9eef1" },
  evening: { azimuth: 250, elevation: 12, sun: "#ffb27a", sunPower: 2.1, sky: "#e8cdb8", ground: "#9c8c76", hemi: 0.7, background: "#efdccd" },
  night: { azimuth: 210, elevation: 40, sun: "#9fb4d8", sunPower: 0.35, sky: "#2a3550", ground: "#141821", hemi: 0.35, background: "#1c2230" },
};

/** Tiled canvas textures for the finishes that aren't plain colours. */
function patternTexture(kind: "brick" | "timber" | "planks"): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  if (!g) return null;
  if (kind === "brick") {
    g.fillStyle = "#d8cfc2";
    g.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 4; col++) {
        const shade = 140 + ((row * 7 + col * 13) % 5) * 9;
        g.fillStyle = `rgb(${shade + 20}, ${shade * 0.55}, ${shade * 0.42})`;
        g.fillRect(col * 32 + (row % 2) * 16 + 1, row * 16 + 1, 30, 14);
      }
    }
  } else if (kind === "timber") {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#8a6847" : "#7f5f40";
      g.fillRect(i * 16, 0, 16, 128);
      g.fillStyle = "#4e3a28";
      g.fillRect(i * 16, 0, 1.5, 128);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 3 === 0 ? "#d7b994" : (i + j) % 3 === 1 ? "#cfae86" : "#dcc09c";
        g.fillRect(j * 64 + ((i % 2) * 32), i * 16, 64, 16);
        g.fillStyle = "rgba(90, 60, 30, 0.35)";
        g.fillRect(j * 64 + ((i % 2) * 32), i * 16, 64, 1);
        g.fillRect(j * 64 + ((i % 2) * 32), i * 16, 1, 16);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Box UVs in metres ÷ tile size, so patterns keep their scale on any wall. */
function worldUVs(geometry: THREE.BoxGeometry, l: number, h: number, d: number, tile: number) {
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  // Faces in BoxGeometry order: +x, −x, +y, −y, +z, −z; four vertices each.
  const dims: Array<[number, number]> = [
    [d, h],
    [d, h],
    [l, d],
    [l, d],
    [l, h],
    [l, h],
  ];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[face][0]) / tile, (uv.getY(i) * dims[face][1]) / tile);
    }
  }
  uv.needsUpdate = true;
}

export class HouseViewer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  private readonly controls: OrbitControls;
  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private house = new THREE.Group();
  private nightLights = new THREE.Group();
  private floors: THREE.Mesh[] = [];
  private model: HouseModel | null = null;
  private state: ViewerState | null = null;
  private houseKey = "";
  private mode: CameraMode = "orbit";
  private readonly textures = new Map<string, THREE.Texture | null>();
  private readonly keys = new Set<string>();
  private walk = { yaw: 0, pitch: -0.05 };
  private down: { x: number; y: number; id: number } | null = null;
  private last = performance.now();
  private active = true;
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private readonly onSelect: (roomId: Id | null) => void;

  constructor(private readonly container: HTMLElement, onSelect: (roomId: Id | null) => void) {
    this.onSelect = onSelect;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
    if (!prev || prev.level !== state.level || key !== this.houseKey) {
      this.houseKey = key;
      this.rebuild();
      if (!prev) this.setCamera("orbit");
    }
    if (!prev || prev.lighting !== state.lighting || prev.shadows !== state.shadows || prev.sunAzimuth !== state.sunAzimuth || prev.sky !== state.sky || prev.level !== state.level) this.light();
    if (!prev || prev.selectedRoomId !== state.selectedRoomId || prev.level !== state.level) this.highlight();
  }

  setActive(active: boolean) {
    this.active = active;
    if (active) this.last = performance.now();
  }

  /** Width covered by a panel on the right; the view is centred in what's left. */
  private insetRight = 0;

  setInsetRight(px: number) {
    if (px === this.insetRight) return;
    this.insetRight = px;
    this.resize();
  }

  resize() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Shift the picture left by half the covered width so the house sits in the visible part.
    const shift = Math.min(this.insetRight / 2, w / 4);
    if (shift > 0) this.camera.setViewOffset(w, h, shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ── Building ─────────────────────────────────────────────────────────
  private texture(kind: "brick" | "timber" | "planks") {
    if (!this.textures.has(kind)) this.textures.set(kind, patternTexture(kind));
    return this.textures.get(kind) ?? null;
  }

  private rebuild() {
    const state = this.state!;
    this.clear(this.house);
    this.floors = [];
    const model = buildHouseModel(state.level, state.display);
    this.model = model;
    const { appearance } = state;
    const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
    const interior = std("#f3f1ec");
    const top = std(PLAN_THEME.wallFill);
    const exteriorMap = appearance.exterior === "brick" ? this.texture("brick") : appearance.exterior === "timber" ? this.texture("timber") : null;
    const exterior = std(exteriorMap ? "#ffffff" : EXTERIOR[appearance.exterior], exteriorMap ? { map: exteriorMap } : {});
    const frame = std(FRAMES[appearance.frames], { roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: "#a9c7da", transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const door = std("#eee8de", { roughness: 0.8 });
    const roof = std(ROOF[appearance.roof], { roughness: 0.75, metalness: appearance.roof === "zinc" ? 0.4 : 0 });

    for (const box of model.boxes) this.house.add(this.boxMesh(box, { interior, top, exterior, exteriorTiled: !!exteriorMap, frame, glass, door, roof }));

    // Floors as thin slabs following each room's outline.
    for (const floor of model.floors) {
      const shapes = floor.rings.map((ring) => new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, p.y))));
      const [outer, ...holes] = shapes;
      outer.holes.push(...holes.map((h) => new THREE.Path(h.getPoints())));
      const geometry = new THREE.ExtrudeGeometry(outer, { depth: 0.04, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      const planks = floor.material === "timber" ? this.texture("planks") : null;
      const color = floor.material ? MATERIAL_FILL[floor.material] : "#e6d5bb";
      const material = std(planks ? "#ffffff" : color, planks ? { map: planks.clone() } : {});
      if (material.map) material.map.repeat.set(1 / 1.6, 1 / 1.6);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      mesh.userData = { roomId: floor.roomId, baseColor: material.color.getHex() };
      this.floors.push(mesh);
      this.house.add(mesh);
    }

    // Site: ground, a paved apron, trees.
    if (model.outside) {
      const o = model.outside;
      const cx = (o.minX + o.maxX) / 2;
      const cy = (o.minY + o.maxY) / 2;
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), std(state.display.landscape ? GROUND[state.ground] : "#e7e3db"));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(cx, -0.02, -cy);
      ground.receiveShadow = true;
      this.house.add(ground);
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(o.maxX - o.minX + 2.4, o.maxY - o.minY + 2.4), std(SITE_THEME.paving));
      apron.rotation.x = -Math.PI / 2;
      apron.position.set(cx, -0.01, -cy);
      apron.receiveShadow = true;
      this.house.add(apron);
    }
    if (model.site) {
      const trunk = std("#6b4f36");
      const tiles = std(SITE_THEME.paving);
      for (const t of model.site.tiles) {
        const tile = new THREE.Mesh(new THREE.BoxGeometry(t.size, 0.03, t.size), tiles);
        tile.position.set(t.x + t.size / 2, 0, -(t.y + t.size / 2));
        tile.receiveShadow = true;
        this.house.add(tile);
      }
      model.site.trees.forEach((t, i) => {
        const tree = new THREE.Group();
        const height = 1.4 + t.r * 1.2;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, height, 6), trunk);
        stem.position.y = height / 2;
        const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(t.r * 1.15, 1), std(t.shade, { flatShading: true }));
        canopy.position.y = height + t.r * 0.6;
        canopy.scale.y = 0.85 + (i % 3) * 0.08;
        for (const m of [stem, canopy]) m.castShadow = m.receiveShadow = true;
        tree.add(stem, canopy);
        tree.position.set(t.x, 0, -t.y);
        this.house.add(tree);
      });
    }

    for (const label of model.labels) {
      const div = document.createElement("div");
      div.className = "three-label";
      div.textContent = label.text;
      const object = new CSS2DObject(div);
      object.position.set(label.at.x, label.z, -label.at.y);
      this.house.add(object);
    }
  }

  private boxMesh(
    box: Box,
    m: { interior: THREE.Material; top: THREE.Material; exterior: THREE.Material; exteriorTiled: boolean; frame: THREE.Material; glass: THREE.Material; door: THREE.Material; roof: THREE.Material },
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(box.length, box.height, box.depth);
    let material: THREE.Material | THREE.Material[];
    if (box.kind === "wall" || box.kind === "lintel" || box.kind === "sill") {
      // Faces: +x, −x, +y, −y, +z, −z. Tops are drawn dark, as on the plan; the outside face takes the exterior finish.
      const faces: THREE.Material[] = [m.interior, m.interior, m.top, m.interior, m.interior, m.interior];
      if (box.outward) {
        const c = Math.cos(box.angle);
        const s = Math.sin(box.angle);
        const alongX = box.outward.x * c + box.outward.y * s;
        const alongZ = box.outward.x * s - box.outward.y * c;
        const face = Math.abs(alongZ) >= Math.abs(alongX) ? (alongZ > 0 ? 4 : 5) : alongX > 0 ? 0 : 1;
        faces[face] = m.exterior;
        if (m.exteriorTiled) worldUVs(geometry, box.length, box.height, box.depth, 1.2);
      }
      material = faces;
    } else if (box.kind === "parapet") material = [m.exterior, m.exterior, m.top, m.exterior, m.exterior, m.exterior];
    else material = box.kind === "glass" ? m.glass : box.kind === "frame" ? m.frame : box.kind === "door" ? m.door : m.roof;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(box.center.x, box.z0 + box.height / 2, -box.center.y);
    mesh.rotation.y = box.angle;
    mesh.castShadow = box.kind !== "glass";
    mesh.receiveShadow = true;
    return mesh;
  }

  private clear(group: THREE.Group) {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          // Shared pattern textures are kept; cloned ones (floors) go with their material.
          const map = (mat as THREE.MeshStandardMaterial).map;
          if (map && ![...this.textures.values()].includes(map)) map.dispose();
          mat.dispose();
        }
      }
      if (o instanceof CSS2DObject) o.element.remove();
    });
    group.clear();
  }

  // ── Light ────────────────────────────────────────────────────────────
  private light() {
    const state = this.state!;
    const preset = LIGHTS[state.lighting];
    const overcast = state.sky === "overcast";
    this.hemi.color.set(preset.sky);
    this.hemi.groundColor.set(preset.ground);
    this.hemi.intensity = preset.hemi * (overcast ? 1.25 : 1);
    this.sun.color.set(preset.sun);
    this.sun.intensity = preset.sunPower * (overcast ? 0.35 : 1);
    this.sun.castShadow = state.shadows && !overcast;
    const background = new THREE.Color(overcast ? "#d9dcdf" : preset.background);
    if (overcast && state.lighting === "night") background.set("#1a1d24");
    this.scene.background = background;
    this.scene.fog = new THREE.Fog(background, 45, 140);
    this.renderer.toneMappingExposure = state.lighting === "night" ? 0.9 : 1.05;

    const o = this.model?.outside;
    const c = o ? { x: (o.minX + o.maxX) / 2, y: (o.minY + o.maxY) / 2 } : { x: 0, y: 0 };
    const size = o ? Math.max(o.maxX - o.minX, o.maxY - o.minY) : 10;
    const az = THREE.MathUtils.degToRad(preset.azimuth + state.sunAzimuth);
    const el = THREE.MathUtils.degToRad(preset.elevation);
    const r = size * 2.5 + 10;
    // Azimuth from north (+y in plan, −z in three), clockwise.
    this.sun.position.set(c.x + Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, -(c.y + Math.cos(az) * Math.cos(el) * r));
    this.sun.target.position.set(c.x, 0, -c.y);
    const cam = this.sun.shadow.camera;
    const half = size * 0.9 + 8;
    cam.left = cam.bottom = -half;
    cam.right = cam.top = half;
    cam.near = 1;
    cam.far = r * 2.5;
    cam.updateProjectionMatrix();

    // At night, rooms glow with a warm light each.
    this.clear(this.nightLights);
    if (state.lighting === "night" && this.model) {
      for (const floor of this.model.floors) {
        if (floor.area < 3) continue;
        const lamp = new THREE.PointLight("#ffcf8a", 4, 7, 1.6);
        lamp.position.set(floor.label.x, 2.1, -floor.label.y);
        this.nightLights.add(lamp);
      }
    }
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
    return { o, c, size };
  }

  /** Room to stand in: the given one, the selected one, else the largest day room. */
  private interiorRoom(roomId?: Id | null) {
    const floors = this.model?.floors ?? [];
    const id = roomId ?? this.state?.selectedRoomId;
    return floors.find((f) => f.roomId === id) ?? [...floors].filter((f) => DAY_ROOMS.has(f.type)).sort((a, b) => b.area - a.area)[0] ?? floors[0];
  }

  /** Where a camera mode stands and looks. */
  private pose(mode: CameraMode, roomId?: Id | null): { position: THREE.Vector3; target: THREE.Vector3 } {
    const { o, c, size } = this.frame();
    if (mode === "aerial") return { position: new THREE.Vector3(c.x + size * 0.15, size * 1.9, c.z + size * 0.55), target: c.clone() };
    if (mode === "interior") {
      const room = this.interiorRoom(roomId);
      if (room) {
        const b = room.bounds;
        const inset = Math.min(0.45, (b.maxX - b.minX) / 4, (b.maxY - b.minY) / 4);
        return {
          position: new THREE.Vector3(b.minX + inset, EYE, -(b.minY + inset)),
          target: new THREE.Vector3((b.minX + b.maxX * 2) / 3, 1.0, -((b.minY + b.maxY * 2) / 3)),
        };
      }
    }
    if (mode === "walk") {
      // Start outside the front (south) of the house, looking in.
      return { position: new THREE.Vector3(c.x, EYE, -(o.minY - 3)), target: new THREE.Vector3(c.x, EYE, c.z) };
    }
    if (mode === "exterior") {
      // From the garden, across the rear corner.
      const env = this.state ? analyzeEnvelope(this.state.level) : null;
      const rear = env?.ok && this.state?.level.rearWallId ? env.info.sideOfWall[this.state.level.rearWallId] : "north";
      const dir = { north: [0.45, 1], south: [-0.45, -1], east: [1, -0.45], west: [-1, 0.45] }[rear];
      return { position: new THREE.Vector3(c.x + dir[0] * size * 1.7, 3.2, c.z - dir[1] * size * 1.7), target: new THREE.Vector3(c.x, 1.2, c.z) };
    }
    return { position: new THREE.Vector3(c.x + size * 0.85, size * 1.05, c.z + size * 1.25), target: new THREE.Vector3(c.x, 0.6, c.z) };
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
  /** A small still from a preset camera, as a data URL. */
  preview(view: PreviewView, width: number, height: number): string | null {
    if (!this.model) return null;
    if (!this.previewRenderer) {
      this.previewRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      this.previewRenderer.shadowMap.enabled = true;
      this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
      this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    const r = this.previewRenderer;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    r.toneMappingExposure = this.renderer.toneMappingExposure;
    const camera = new THREE.PerspectiveCamera(view.kind === "exterior" ? 40 : 60, width / height, 0.1, 400);
    const pose = view.kind === "exterior" ? this.pose("exterior") : this.pose("interior", view.roomId);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    r.render(this.scene, camera);
    return r.domElement.toDataURL("image/jpeg", 0.85);
  }

  /** The current view as a PNG data URL. */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** The house (without labels) as a binary glTF. */
  async exportGlb(): Promise<Blob> {
    const exporter = new GLTFExporter();
    const meshes = new THREE.Group();
    this.house.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.add(o.clone());
    });
    const result = await exporter.parseAsync(meshes, { binary: true });
    return new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.pointerDown);
    el.removeEventListener("pointermove", this.pointerMove);
    el.removeEventListener("pointerup", this.pointerUp);
    el.removeEventListener("keydown", this.keyDown);
    el.removeEventListener("keyup", this.keyUp);
    this.controls.dispose();
    this.clear(this.house);
    this.clear(this.nightLights);
    for (const t of this.textures.values()) t?.dispose();
    this.renderer.dispose();
    this.previewRenderer?.dispose();
    el.remove();
    this.labelRenderer.domElement.remove();
  }
}
