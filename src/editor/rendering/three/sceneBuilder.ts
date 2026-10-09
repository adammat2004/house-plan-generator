import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Appearance } from "@/domain/project/schema";
import { MATERIAL_FILL, PLAN_THEME, SITE_THEME } from "../konva/theme";
import type { FurnitureTone } from "./furnitureModel";
import type { Box, HouseModel } from "./houseModel";

/**
 * Meshes, materials and light for a HouseModel, shared by the interactive
 * viewer and the off-screen stills renderer. Plan (x, y) maps to three
 * (x, −z), height to +y.
 */

export type Lighting = "morning" | "midday" | "evening" | "night";
export type Ground = "lawn" | "gravel" | "paving";
export type Sky = "clear" | "overcast";

export interface BuildOptions {
  appearance: Appearance;
  ground: Ground;
  landscape: boolean;
  /** Dimension labels as HTML overlays; only the interactive viewer shows them. */
  labels: boolean;
}

export interface LightOptions {
  lighting: Lighting;
  sky: Sky;
  shadows: boolean;
  sunAzimuth: number;
}

export interface LightTarget {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  nightLights: THREE.Group;
}

/** Pattern textures, made once per owner and shared by its materials. */
export class TextureCache {
  private readonly made = new Map<string, THREE.Texture | null>();

  get(kind: "brick" | "timber" | "planks"): THREE.Texture | null {
    if (!this.made.has(kind)) this.made.set(kind, patternTexture(kind));
    return this.made.get(kind) ?? null;
  }

  owns(texture: THREE.Texture): boolean {
    return [...this.made.values()].includes(texture);
  }

  dispose() {
    for (const t of this.made.values()) t?.dispose();
    this.made.clear();
  }
}

const EXTERIOR: Record<Appearance["exterior"], string> = { white_render: "#f1eee7", brick: "#9d5b43", timber: "#8c6a49", dark_render: "#33373a" };
const FRAMES: Record<Appearance["frames"], string> = { black: "#24282b", white: "#f4f4f1", oak: "#b4885a" };
const ROOF: Record<Appearance["roof"], string> = { membrane: "#3b3f42", zinc: "#8d949a" };
const GROUND: Record<Ground, string> = { lawn: "#8ea36a", gravel: "#cdc4b2", paving: "#d9d1c3" };
const FURNITURE: Record<FurnitureTone, { color: string; roughness: number }> = {
  fabric: { color: "#b9b2a6", roughness: 0.95 },
  cushion: { color: "#cec7ba", roughness: 0.95 },
  wood: { color: "#a9825a", roughness: 0.7 },
  white: { color: "#f2f0eb", roughness: 0.5 },
  dark: { color: "#3a3f42", roughness: 0.6 },
  worktop: { color: "#8f8a82", roughness: 0.4 },
  water: { color: "#cfe0e8", roughness: 0.15 },
  leaf: { color: "#6f8f4f", roughness: 0.9 },
  linen: { color: "#f4f1ea", roughness: 0.95 },
  duvet: { color: "#b9c6cf", roughness: 0.95 },
  glass: { color: "#a9c7da", roughness: 0.05 },
  paint: { color: "#8d969d", roughness: 0.35 },
};

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
    // Staggered boards; rows that start half a board in also cover the left edge, so no gaps tile in.
    for (let i = 0; i < 8; i++) {
      for (let j = -1; j < 2; j++) {
        g.fillStyle = (i + j + 3) % 3 === 0 ? "#d7b994" : (i + j + 3) % 3 === 1 ? "#cfae86" : "#dcc09c";
        g.fillRect(j * 64 + ((i % 2) * 32), i * 16, 64, 16);
        g.fillStyle = "rgba(90, 60, 30, 0.14)";
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

export function buildHouse(group: THREE.Group, model: HouseModel, opts: BuildOptions, textures: TextureCache): THREE.Mesh[] {
  const floors: THREE.Mesh[] = [];
  const { appearance } = opts;
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  const interior = std("#f3f1ec");
  const top = std(PLAN_THEME.wallFill);
  const exteriorMap = appearance.exterior === "brick" ? textures.get("brick") : appearance.exterior === "timber" ? textures.get("timber") : null;
  const exterior = std(exteriorMap ? "#ffffff" : EXTERIOR[appearance.exterior], exteriorMap ? { map: exteriorMap } : {});
  const frame = std(FRAMES[appearance.frames], { roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: "#a9c7da", transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.2, depthWrite: false });
  const door = std("#eee8de", { roughness: 0.8 });
  const roof = std(ROOF[appearance.roof], { roughness: 0.75, metalness: appearance.roof === "zinc" ? 0.4 : 0 });

  const furniture = new Map<FurnitureTone, THREE.Material>();
  const furnitureMaterial = (tone: FurnitureTone) => {
    if (!furniture.has(tone)) {
      const { color, roughness } = FURNITURE[tone];
      furniture.set(tone, tone === "glass" ? glass : std(color, { roughness }));
    }
    return furniture.get(tone)!;
  };
  for (const box of model.boxes) {
    group.add(boxMesh(box, { interior, top, exterior, exteriorTiled: !!exteriorMap, frame, glass, door, roof, furniture: furnitureMaterial }));
  }

  // Floors as thin slabs following each room's outline.
  for (const floor of model.floors) {
    const shapes = floor.polygons.map((polygon) => {
      const shape = new THREE.Shape(polygon.outer.map((p) => new THREE.Vector2(p.x, p.y)));
      shape.holes.push(...polygon.holes.map((hole) => new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y)))));
      return shape;
    });
    if (!shapes.length) continue;
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 0.04, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const planks = floor.material === "timber" ? textures.get("planks") : null;
    const color = floor.material ? MATERIAL_FILL[floor.material] : "#e6d5bb";
    const material = std(planks ? "#ffffff" : color, planks ? { map: planks.clone() } : {});
    if (material.map) material.map.repeat.set(1 / 1.6, 1 / 1.6);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.userData = { roomId: floor.roomId, baseColor: material.color.getHex() };
    floors.push(mesh);
    group.add(mesh);
  }

  // Site: ground, a paved apron, trees.
  if (model.outside) {
    const o = model.outside;
    const cx = (o.minX + o.maxX) / 2;
    const cy = (o.minY + o.maxY) / 2;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), std(opts.landscape ? GROUND[opts.ground] : "#e7e3db"));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.02, -cy);
    ground.receiveShadow = true;
    group.add(ground);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(o.maxX - o.minX + 2.4, o.maxY - o.minY + 2.4), std(SITE_THEME.paving));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(cx, -0.01, -cy);
    apron.receiveShadow = true;
    group.add(apron);
  }
  if (model.site) {
    const trunk = std("#6b4f36");
    const tiles = std(SITE_THEME.paving);
    for (const t of model.site.tiles) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(t.size, 0.03, t.size), tiles);
      tile.position.set(t.x + t.size / 2, 0, -(t.y + t.size / 2));
      tile.receiveShadow = true;
      group.add(tile);
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
      group.add(tree);
    });
  }

  for (const label of opts.labels ? model.labels : []) {
    const div = document.createElement("div");
    div.className = label.kind === "room" ? "three-label is-room" : "three-label";
    div.textContent = label.text;
    if (label.detail) {
      const detail = document.createElement("small");
      detail.textContent = label.detail;
      div.appendChild(detail);
    }
    const object = new CSS2DObject(div);
    object.position.set(label.at.x, label.z, -label.at.y);
    group.add(object);
  }
  return floors;
}

function boxMesh(
  box: Box,
  m: {
    interior: THREE.Material;
    top: THREE.Material;
    exterior: THREE.Material;
    exteriorTiled: boolean;
    frame: THREE.Material;
    glass: THREE.Material;
    door: THREE.Material;
    roof: THREE.Material;
    furniture: (tone: FurnitureTone) => THREE.Material;
  },
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
  } else if (box.kind === "furniture") material = m.furniture(box.tone ?? "white");
  else if (box.kind === "parapet") material = [m.exterior, m.exterior, m.top, m.exterior, m.exterior, m.exterior];
  else material = box.kind === "glass" ? m.glass : box.kind === "frame" ? m.frame : box.kind === "door" ? m.door : m.roof;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(box.center.x, box.z0 + box.height / 2, -box.center.y);
  mesh.rotation.y = box.angle;
  mesh.castShadow = box.kind !== "glass" && box.tone !== "glass";
  mesh.receiveShadow = true;
  return mesh;
}

export function clearGroup(group: THREE.Group, textures: TextureCache) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        // Shared pattern textures are kept; cloned ones (floors) go with their material.
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map && !textures.owns(map)) map.dispose();
        mat.dispose();
      }
    }
    if (o instanceof CSS2DObject) o.element.remove();
  });
  group.clear();
}

export function applyLighting(target: LightTarget, model: HouseModel | null, state: LightOptions, textures: TextureCache) {
  const preset = LIGHTS[state.lighting];
  const overcast = state.sky === "overcast";
  target.hemi.color.set(preset.sky);
  target.hemi.groundColor.set(preset.ground);
  target.hemi.intensity = preset.hemi * (overcast ? 1.25 : 1);
  target.sun.color.set(preset.sun);
  target.sun.intensity = preset.sunPower * (overcast ? 0.35 : 1);
  target.sun.castShadow = state.shadows && !overcast;
  const background = new THREE.Color(overcast ? "#d9dcdf" : preset.background);
  if (overcast && state.lighting === "night") background.set("#1a1d24");
  target.scene.background = background;
  target.scene.fog = new THREE.Fog(background, 45, 140);
  target.renderer.toneMappingExposure = state.lighting === "night" ? 0.9 : 1.05;

  const o = model?.outside;
  const c = o ? { x: (o.minX + o.maxX) / 2, y: (o.minY + o.maxY) / 2 } : { x: 0, y: 0 };
  const size = o ? Math.max(o.maxX - o.minX, o.maxY - o.minY) : 10;
  const az = THREE.MathUtils.degToRad(preset.azimuth + state.sunAzimuth);
  const el = THREE.MathUtils.degToRad(preset.elevation);
  const r = size * 2.5 + 10;
  // Azimuth from north (+y in plan, −z in three), clockwise.
  target.sun.position.set(c.x + Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, -(c.y + Math.cos(az) * Math.cos(el) * r));
  target.sun.target.position.set(c.x, 0, -c.y);
  const cam = target.sun.shadow.camera;
  const half = size * 0.9 + 8;
  cam.left = cam.bottom = -half;
  cam.right = cam.top = half;
  cam.near = 1;
  cam.far = r * 2.5;
  cam.updateProjectionMatrix();

  // At night, rooms glow with a warm light each.
  clearGroup(target.nightLights, textures);
  if (state.lighting === "night" && model) {
    for (const floor of model.floors) {
      if (floor.area < 3) continue;
      const lamp = new THREE.PointLight("#ffcf8a", 4, 7, 1.6);
      lamp.position.set(floor.label.x, 2.1, -floor.label.y);
      target.nightLights.add(lamp);
    }
  }
}
