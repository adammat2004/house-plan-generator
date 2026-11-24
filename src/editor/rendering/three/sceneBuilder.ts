import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { COLOR } from "@/design/tokens";
import type { MultiPolygon } from "@/domain/geometry/polygons";
import { takesWallColour } from "@/domain/project/exterior";
import type { Appearance, DoorColour, WallColour } from "@/domain/project/schema";
import { MATERIAL_FILL, PLAN_THEME, SITE_THEME } from "../konva/theme";
import { FINISH_TONE, finishTile, roomFinish, type FinishId, type OutdoorId } from "../scene/finishes";
import { finishCanvas } from "../scene/paintFinish";
import type { FurnitureTone } from "./furnitureModel";
import { modelFurnitureColour } from "../scene/style";
import type { FurnitureModels } from "./furnitureAssets";
import type { Box, HouseModel } from "./houseModel";
import { roofSurfaces, type P3, type RoofPiece } from "./roofModel";

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
  /** Degrees clockwise from up the plan to north, once the site says; the sun keeps to the real compass. */
  north?: number;
}

export interface LightTarget {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  nightLights: THREE.Group;
}

/** Floors in 3D are painted at this density, px per metre. */
const FLOOR_DENSITY = 256;
/** Metres of wall per repeat of a textured exterior finish. */
const WALL_TILE = 1.2;

/** Pattern textures, made once per owner and shared by its materials. */
export class TextureCache {
  private readonly made = new Map<string, THREE.Texture | null>();

  get(kind: "brick" | "timber" | "painted_brick" | "stone" | "fade"): THREE.Texture | null {
    if (!this.made.has(kind)) this.made.set(kind, kind === "fade" ? fadeTexture() : patternTexture(kind));
    return this.made.get(kind) ?? null;
  }

  /** A floor finish as on the plan, one texture repeat per tile (floor UVs are in metres). */
  floor(finish: FinishId | OutdoorId): THREE.Texture | null {
    const key = `floor:${finish}`;
    if (!this.made.has(key)) {
      const tile = finishTile(finish);
      const canvas = finishCanvas(tile, FLOOR_DENSITY);
      let texture: THREE.CanvasTexture | null = null;
      if (canvas) {
        texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.repeat.set(1 / tile.width, 1 / tile.height);
      }
      this.made.set(key, texture);
    }
    return this.made.get(key) ?? null;
  }

  owns(texture: THREE.Texture): boolean {
    return [...this.made.values()].includes(texture);
  }

  dispose() {
    for (const t of this.made.values()) t?.dispose();
    this.made.clear();
  }
}

const EXTERIOR: Record<Appearance["exterior"], string> = { white_render: "#f1eee7", brick: "#9d5b43", timber: "#8c6a49", dark_render: "#33373a", painted_brick: "#f1eee7", stone: "#b9b1a3" };
/** Curated wall colours for render and painted brick; the swatches in the panel read these too. */
export const WALL_COLOUR: Record<WallColour, string> = { white: "#f1eee7", cream: "#eadfc4", sage: "#a9b79c", sky: "#b9cfdc", stone_grey: "#b3b0a8", sand: "#dcc7a1", terracotta: "#c98a67", charcoal: "#33373a" };
export const DOOR_COLOUR: Record<DoorColour, string> = { white: "#eee8de", black: "#24282b", navy: "#27384f", green: "#3f5a46", red: "#8e2f2a", yellow: "#d9ad3c", oak: "#a97c50" };
export const FRAMES: Record<Appearance["frames"], string> = { black: "#24282b", white: "#f4f4f1", oak: "#b4885a", grey: "#6b7378", bronze: "#5b4a3b" };
const ROOF: Record<Appearance["roof"], string> = { membrane: "#3b3f42", zinc: "#8d949a", slate: "#4b5157", tile: "#9b5a45" };
/** Muted, so the house stays the subject. */
const GROUND: Record<Ground, string> = { lawn: "#a9b48f", gravel: "#cfc7b6", paving: "#d9d1c3" };
/** Ground radius, m. It fades into the sky from about halfway out, so there's no horizon line. */
const GROUND_RADIUS = 60;
const CANOPY = ["#7f9467", "#93a57a"];
const STEM = "#4b443c";
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
  morning: { azimuth: 100, elevation: 20, sun: "#ffdcb0", sunPower: 2.3, sky: "#d6e4f1", ground: "#c9bea9", hemi: 1.15, background: "#dfe8ee" },
  midday: { azimuth: 160, elevation: 58, sun: "#fff4e3", sunPower: 2.8, sky: "#d8e6f2", ground: "#bfb39c", hemi: 1.1, background: COLOR.sky },
  evening: { azimuth: 250, elevation: 12, sun: "#ffbf8c", sunPower: 2, sky: "#ecd9ca", ground: "#bba98f", hemi: 1, background: "#efdccd" },
  night: { azimuth: 210, elevation: 40, sun: "#9fb4d8", sunPower: 0.35, sky: "#2a3550", ground: "#141821", hemi: 0.35, background: "#1c2230" },
};

/** Tiled canvas textures for the finishes that aren't plain colours. */
function patternTexture(kind: "brick" | "timber" | "painted_brick" | "stone"): THREE.CanvasTexture | null {
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
  } else if (kind === "painted_brick") {
    // Near-white, so the wall colour tints it; the mortar lines stay a touch darker.
    g.fillStyle = "#bdbab3";
    g.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 4; col++) {
        const shade = 244 - ((row * 7 + col * 13) % 5) * 4;
        g.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        g.fillRect(col * 32 + (row % 2) * 16 + 1, row * 16 + 1, 30, 14);
      }
    }
  } else if (kind === "stone") {
    g.fillStyle = "#8c867b";
    g.fillRect(0, 0, 128, 128);
    const courses = [22, 34, 26, 46];
    let y = 0;
    courses.forEach((h, c) => {
      let x = -(c * 19) % 40;
      for (let k = 0; x < 128; k++) {
        const w = 30 + ((c * 5 + k * 11) % 4) * 9;
        const shade = 150 + ((c * 17 + k * 29) % 6) * 9;
        g.fillStyle = `rgb(${shade}, ${shade - 6}, ${shade - 16})`;
        g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
        x += w;
      }
      y += h;
    });
  } else {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#8a6847" : "#7f5f40";
      g.fillRect(i * 16, 0, 16, 128);
      g.fillStyle = "#4e3a28";
      g.fillRect(i * 16, 0, 1.5, 128);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Opaque in the middle, clear at the rim: the ground's alpha map, so the site melts into the sky. */
function fadeTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const gradient = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.45, "#ffffff");
  gradient.addColorStop(1, "#000000");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
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

/** Flat shapes on the plan raised into slabs `height` tall, standing at `y`; their texture, if any, is laid in metres. */
function extrude(shapes: MultiPolygon, height: number, material: THREE.Material, y: number, shadows = false): THREE.Object3D {
  const outline = shapes.map((polygon) => {
    const shape = new THREE.Shape(polygon.outer.map((p) => new THREE.Vector2(p.x, p.y)));
    shape.holes.push(...polygon.holes.map((hole) => new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y)))));
    return shape;
  });
  if (!outline.length) return new THREE.Group();
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.castShadow = shadows;
  return mesh;
}

export function buildHouse(group: THREE.Group, model: HouseModel, opts: BuildOptions, textures: TextureCache, models?: FurnitureModels): THREE.Mesh[] {
  const floors: THREE.Mesh[] = [];
  const { appearance } = opts;
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  const interior = std(PLAN_THEME.paper);
  const top = std(PLAN_THEME.wallFill);
  const patterned = appearance.exterior === "brick" || appearance.exterior === "timber" || appearance.exterior === "painted_brick" || appearance.exterior === "stone";
  const exteriorMap = patterned ? textures.get(appearance.exterior as "brick") : null;
  // Brick, timber and stone show their own colours; painted finishes take the chosen wall colour.
  const wallTint = appearance.wallColour && takesWallColour(appearance.exterior) ? WALL_COLOUR[appearance.wallColour] : EXTERIOR[appearance.exterior];
  const exterior = std(exteriorMap ? (appearance.exterior === "painted_brick" ? wallTint : "#ffffff") : wallTint, exteriorMap ? { map: exteriorMap } : {});
  const frame = std(FRAMES[appearance.frames], { roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: "#a9c7da", transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.2, depthWrite: false });
  const door = std("#eee8de", { roughness: 0.8 });
  const frontDoor = std(DOOR_COLOUR[appearance.doorColour ?? "white"], { roughness: 0.55 });
  const roof = std(ROOF[appearance.roof], { roughness: 0.75, metalness: appearance.roof === "zinc" ? 0.4 : 0 });
  const stair = std("#c9ab84", { roughness: 0.8 });

  const furniture = new Map<FurnitureTone, THREE.Material>();
  const furnitureMaterial = (tone: FurnitureTone) => {
    if (!furniture.has(tone)) {
      const { color, roughness } = FURNITURE[tone];
      // Woods, fabrics and bedding follow the interior style.
      furniture.set(tone, tone === "glass" ? glass : std(modelFurnitureColour(appearance.interiorStyle, tone) ?? color, { roughness }));
    }
    return furniture.get(tone)!;
  };
  // Furniture from the asset library where its model has loaded; the rest stays boxes.
  const modelled = new Set<string>();
  for (const { item, z, cap } of models ? (model.furniture ?? []) : []) {
    const object = models!.instance(item, appearance.interiorStyle);
    if (!object) continue;
    object.position.y = z;
    if (Number.isFinite(cap)) cutModel(object, z + cap);
    group.add(object);
    modelled.add(item.id);
  }
  for (const box of model.boxes) {
    if (box.furnitureId && modelled.has(box.furnitureId)) continue;
    group.add(boxMesh(box, { interior, top, exterior, exteriorTiled: !!exteriorMap, frame, glass, door, frontDoor, roof, stair, furniture: furnitureMaterial }));
  }
  if (model.roofs?.length) group.add(roofMesh(model.roofs, roof, frame, exterior, !!exteriorMap));

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
    // The same finish as the plan: the room's own, else the one its use usually has.
    const finish = roomFinish({ floorMaterial: floor.material, type: floor.type });
    const texture = finish ? textures.floor(finish) : null;
    const color = finish ? FINISH_TONE[finish] : floor.material ? MATERIAL_FILL[floor.material] : "#e6d5bb";
    const material = std(texture ? "#ffffff" : color, texture ? { map: texture } : {});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = floor.z ?? 0;
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
    const fade = textures.get("fade");
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(GROUND_RADIUS, 96),
      std(opts.landscape ? GROUND[opts.ground] : "#e7e3db", fade ? { alphaMap: fade, transparent: true } : {}),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.02, -cy);
    ground.receiveShadow = true;
    // First among the see-through things, so glass seen against the ground keeps its tint.
    ground.renderOrder = -1;
    group.add(ground);
    if (!model.site) {
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(o.maxX - o.minX + 2.4, o.maxY - o.minY + 2.4), std(SITE_THEME.paving));
      apron.rotation.x = -Math.PI / 2;
      apron.position.set(cx, -0.01, -cy);
      apron.receiveShadow = true;
      group.add(apron);
    }
  }
  if (model.site) {
    const stem = std(STEM);
    const leaves = CANOPY.map((c) => std(c, { roughness: 1 }));
    // The garden: gravel round the walls, the terrace and path a step up from it, and hedges on the boundary.
    const paving = textures.floor("paving");
    group.add(
      extrude(model.site.apron, 0.01, std(SITE_THEME.gravel), -0.005),
      extrude(model.site.terrace, 0.03, std(paving ? "#ffffff" : SITE_THEME.paving, paving ? { map: paving } : {}), 0),
      extrude(model.site.path, 0.03, std(paving ? "#ffffff" : SITE_THEME.paving, paving ? { map: paving } : {}), 0),
      extrude(model.site.hedges, 1.1, std(SITE_THEME.hedge, { roughness: 1 }), 0, true),
    );
    // Soft, rounded trees: a short dark stem under two or three overlapping canopies.
    const ball = new THREE.SphereGeometry(1, 20, 14);
    model.site.trees.forEach((t, i) => {
      const tree = new THREE.Group();
      const height = 0.9 + t.r * 0.6;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, height + t.r * 0.4, 8), stem);
      trunk.position.y = (height + t.r * 0.4) / 2;
      trunk.castShadow = true;
      tree.add(trunk);
      const material = leaves[i % leaves.length];
      const lobes = i % 3 === 0 ? 3 : 2;
      for (let k = 0; k < lobes; k++) {
        const r = t.r * (k === 0 ? 1 : 0.72);
        const angle = (i * 1.7 + k * 2.4) % (Math.PI * 2);
        const lobe = new THREE.Mesh(ball, material);
        lobe.scale.set(r, r * 0.92, r);
        lobe.position.set(k === 0 ? 0 : Math.cos(angle) * t.r * 0.55, height + t.r * (k === 0 ? 0.85 : 0.6), k === 0 ? 0 : Math.sin(angle) * t.r * 0.55);
        lobe.castShadow = lobe.receiveShadow = true;
        tree.add(lobe);
      }
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
    /** Doors in an outside wall. */
    frontDoor: THREE.Material;
    roof: THREE.Material;
    stair: THREE.Material;
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
      if (m.exteriorTiled) worldUVs(geometry, box.length, box.height, box.depth, WALL_TILE);
    }
    material = faces;
  } else if (box.kind === "furniture") material = m.furniture(box.tone ?? "white");
  else if (box.kind === "parapet") material = [m.exterior, m.exterior, m.top, m.exterior, m.exterior, m.exterior];
  // The floor between storeys shows as a band of the outside finish; its underside is the ceiling below.
  else if (box.kind === "slab") material = [m.exterior, m.exterior, m.interior, m.interior, m.exterior, m.exterior];
  else if (box.kind === "stair") material = m.stair;
  else if (box.kind === "balustrade") material = m.frame;
  else material = box.kind === "glass" ? m.glass : box.kind === "frame" ? m.frame : box.kind === "door" ? (box.outward ? m.frontDoor : m.door) : m.roof;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(box.center.x, box.z0 + box.height / 2, -box.center.y);
  mesh.rotation.y = box.angle;
  mesh.castShadow = box.kind !== "glass" && box.tone !== "glass";
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A pitched roof: the slopes and soffits in the roof finish, the fascias in
 * the window frames' colour. Faces sharing a plane come merged from
 * `roofSurfaces`; where faces of different planes run into each other the
 * higher shows, which makes the valleys.
 */
function roofMesh(pieces: readonly RoofPiece[], material: THREE.Material, trim: THREE.Material, wall: THREE.Material, wallTiled: boolean): THREE.Group {
  const surfaces = roofSurfaces(pieces);
  const main: number[] = [];
  const edge: number[] = [];
  const gable: number[] = [];
  const push = (out: number[], a: P3, b: P3, c: P3) => out.push(a.x, a.z, -a.y, b.x, b.z, -b.y, c.x, c.z, -c.y);
  /** Flat polygons as triangles facing up (or down), lifted onto z(x, y). */
  const fill = (polygons: MultiPolygon, z: (x: number, y: number) => number, up: boolean) => {
    for (const polygon of polygons) {
      const contour = polygon.outer.map((p) => new THREE.Vector2(p.x, p.y));
      const holes = polygon.holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)));
      const all = [...contour, ...holes.flat()];
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
        const [a, b, c] = [all[i], all[j], all[k]].map((v) => ({ x: v.x, y: v.y, z: z(v.x, v.y) }));
        const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
        if (ccw === up) push(main, a, b, c);
        else push(main, a, c, b);
      }
    }
  };
  for (const slope of surfaces.slopes) fill(slope.polygons, (x, y) => slope.a * x + slope.b * y + slope.c, true);
  for (const soffit of surfaces.soffits) fill(soffit.polygons, () => soffit.z, false);
  for (const [a, b, c] of surfaces.ends) push(main, a, b, c);
  for (const [a, b, c] of surfaces.gables) push(gable, a, b, c);
  for (const f of surfaces.fascias) {
    const [a0, b0, b1, a1] = [{ ...f.a, z: f.z0 }, { ...f.b, z: f.z0 }, { ...f.b, z: f.z1 }, { ...f.a, z: f.z1 }];
    push(edge, a0, b0, b1);
    push(edge, a0, b1, a1);
  }
  const group = new THREE.Group();
  for (const [positions, mat] of [
    [main, material],
    [edge, trim],
    [gable, wall],
  ] as const) {
    if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    // Gable ends tile the wall finish as the walls do: along the face and up, in metres.
    if (mat === wall && wallTiled) {
      const uv: number[] = [];
      for (let i = 0; i < positions.length; i += 3) uv.push((positions[i] - positions[i + 2]) / WALL_TILE, positions[i + 1] / WALL_TILE);
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Cuts a model off at a height for the cutaway: its materials are copied with a clipping plane (the renderer needs localClippingEnabled). */
function cutModel(object: THREE.Object3D, height: number) {
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), height);
  const copies = new Map<THREE.Material, THREE.Material>();
  const cut = (m: THREE.Material) => {
    let copy = copies.get(m);
    if (!copy) {
      copy = m.clone();
      // The copy is this scene's to free; its textures still belong to the shared model.
      copy.userData = { assetCopy: true };
      copy.clippingPlanes = [plane];
      copy.side = THREE.DoubleSide;
      copies.set(m, copy);
    }
    return copy;
  };
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = Array.isArray(o.material) ? o.material.map(cut) : cut(o.material);
  });
}

export function clearGroup(group: THREE.Group, textures: TextureCache) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      // Library models are shared by every scene: free only this scene's copies of their materials.
      if (!o.userData.sharedAsset) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        if (mat.userData.sharedAsset) continue;
        if (mat.userData.assetCopy) {
          mat.dispose();
          continue;
        }
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
  const az = THREE.MathUtils.degToRad(preset.azimuth + state.sunAzimuth + (state.north ?? 0));
  const el = THREE.MathUtils.degToRad(preset.elevation);
  const r = size * 2.5 + 10;
  // Azimuth clockwise from north: up the plan (+y in plan, −z in three) turned by the site's north.
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
      lamp.position.set(floor.label.x, (floor.z ?? 0) + 2.1, -floor.label.y);
      target.nightLights.add(lamp);
    }
  }
}
