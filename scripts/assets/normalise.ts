import { NodeIO, type Document, type Mesh } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { clearNodeTransform, dedup, flatten, join, meshopt, prune, simplify, textureCompress, transformMesh, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

/**
 * Squares up a model from an image-to-3D service so it can stand in for a
 * catalog piece: turned so its back is at -Z (the plan's +y, as at rotation
 * 0), centred over the origin, standing on Y = 0 and sized to the catalog's
 * width (X), height (Y) and depth (Z). Then it's simplified and compressed.
 *
 * The orientation helpers work on plain point lists so they can be tested
 * without a model.
 */

export type Turns = 0 | 1 | 2 | 3;

const MATTE_ROUGHNESS = 0.8;

export interface Orientation {
  /** Small turn about the vertical that squares the footprint up, degrees. */
  yawDeg: number;
  /** Quarter turns after that, counterclockwise seen from above. */
  turns: Turns;
  /** How sure the back was found: 0 means it was guessed. */
  confidence: number;
  source: "auto" | "override";
}

export interface NormaliseResult {
  orientation: Orientation;
  /** Size of the model as it came, after turning, in its own units. */
  nativeDims: [number, number, number];
  /** Size after normalising, m: width, depth, height. */
  dims: [number, number, number];
  /** How much each axis (width, depth, height) was stretched beyond an even scale. 1 is none. */
  distortion: [number, number, number];
  tris: number;
}

export interface Target {
  width: number;
  depth: number;
  height: number;
  /** Ignore the catalog height and keep the model's own proportions upright: a bed's catalog height is the mattress, not the headboard. */
  naturalHeight?: boolean;
  /** "stretch" fits each axis to the catalog; "fit" scales evenly to fit inside it (cars, plants). */
  fit: "stretch" | "fit";
  /** Pieces with their back to a wall have a tall back (sofa, headboard, cistern) that shows which way they face. */
  placement: "wall" | "free";
}

/** Points as flat [x, y, z, x, y, z, …]. */
export type Points = Float64Array;

/** Turns points about the vertical by `angle` radians, the way three's makeRotationY does. */
export function rotateY(points: Points, angle: number): Points {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const z = points[i + 2];
    out[i] = c * x + s * z;
    out[i + 1] = points[i + 1];
    out[i + 2] = -s * x + c * z;
  }
  return out;
}

export function bounds(points: Points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = points[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as [number, number, number] };
}

function footprintArea(points: Points, angle: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const x = c * points[i] + s * points[i + 2];
    const z = -s * points[i] + c * points[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return (x1 - x0) * (z1 - z0);
}

/** The turn within ±45° that gives the smallest box round the footprint, radians. Under 1.5° counts as square already. */
export function footprintYaw(points: Points): number {
  let best = 0;
  let bestArea = footprintArea(points, 0);
  const deg = Math.PI / 180;
  for (let a = -45; a <= 45; a += 0.5) {
    const area = footprintArea(points, a * deg);
    if (area < bestArea - 1e-12) [best, bestArea] = [a * deg, area];
  }
  for (let a = best - 0.5 * deg; a <= best + 0.5 * deg; a += 0.05 * deg) {
    const area = footprintArea(points, a);
    if (area < bestArea - 1e-12) [best, bestArea] = [a, area];
  }
  // Snap if the gain is too small to be worth a skewed model: square shapes give noisy angles.
  return Math.abs(best) < 1.5 * deg || bestArea > footprintArea(points, 0) * 0.985 ? 0 : best;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * Which quarter turn puts the piece's back at -Z. The catalog's width and
 * depth decide between sideways and not when they differ; the side where the
 * height is (the back of a sofa, a headboard) decides front from back.
 */
export function chooseTurns(points: Points, target: Target, facing: Turns = 0): { turns: Turns; confidence: number } {
  const elongated = Math.abs(target.width - target.depth) / Math.max(target.width, target.depth) > 0.15;
  const candidates: Array<{ turns: Turns; score: number }> = [];
  for (const turns of [0, 1, 2, 3] as Turns[]) {
    const p = rotateY(points, (turns * Math.PI) / 2);
    const { min, max, size } = bounds(p);
    if (elongated && size[0] > size[2] !== target.width > target.depth) continue;
    const strip = 0.3 * size[2];
    const back: number[] = [];
    const front: number[] = [];
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 2] < min[2] + strip) back.push(p[i + 1]);
      else if (p[i + 2] > max[2] - strip) front.push(p[i + 1]);
    }
    const score = (percentile(back, 0.9) - percentile(front, 0.9)) / Math.max(size[1], 1e-9);
    candidates.push({ turns, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  // Pieces like tables and chests have no tall back; trust the service's own facing then, or the turn nearest it.
  if (!best || best.score < 0.08) {
    const away = (t: Turns) => Math.min((t - facing + 4) % 4, (facing - t + 4) % 4);
    const fallback = candidates.map((c) => c.turns).sort((a, b) => away(a) - away(b) || a - b)[0] ?? facing;
    return { turns: fallback, confidence: 0 };
  }
  return { turns: best.turns, confidence: Math.min(1, best.score) };
}

/** A column-major 4×4 matrix: scale · translate · rotateY(angle), as glTF wants. */
export function placeMatrix(angle: number, translate: [number, number, number], scale: [number, number, number]): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [sx, sy, sz] = scale;
  const [tx, ty, tz] = translate;
  // Rows of S·T·R applied to (x, y, z, 1): x' = sx(c x + s z + tx), y' = sy(y + ty), z' = sz(-s x + c z + tz).
  return [sx * c, 0, -sz * s, 0, 0, sy, 0, 0, sx * s, 0, sz * c, 0, sx * tx, sy * ty, sz * tz, 1];
}

export function applyMatrix(points: Points, m: number[]): Points {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const [x, y, z] = [points[i], points[i + 1], points[i + 2]];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/** Works out the matrix that squares a model up to the target, from its points. */
export function solvePlacement(points: Points, target: Target, override?: { yawDeg?: number; turns?: Turns }, facing: Turns = 0) {
  const yaw = override?.yawDeg !== undefined ? (override.yawDeg * Math.PI) / 180 : footprintYaw(points);
  const yawed = rotateY(points, yaw);
  const chosen = override?.turns !== undefined ? { turns: override.turns, confidence: 1 } : chooseTurns(yawed, target, facing);
  const angle = yaw + (chosen.turns * Math.PI) / 2;
  const { min, max, size } = bounds(rotateY(points, angle));
  const [ex, ey, ez] = size.map((v) => Math.max(v, 1e-9));
  const per: [number, number, number] = [target.width / ex, target.height / ey, target.depth / ez];
  if (target.naturalHeight) per[1] = Math.sqrt(per[0] * per[2]);
  const even = target.fit === "fit" ? Math.min(...per) : Math.cbrt(per[0] * per[1] * per[2]);
  const scale: [number, number, number] = target.fit === "fit" ? [even, even, even] : per;
  const translate: [number, number, number] = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  const orientation: Orientation = {
    yawDeg: Math.round(((yaw * 180) / Math.PI) * 100) / 100,
    turns: chosen.turns,
    confidence: Math.round(chosen.confidence * 100) / 100,
    source: override?.yawDeg !== undefined || override?.turns !== undefined ? "override" : "auto",
  };
  return {
    matrix: placeMatrix(angle, translate, scale),
    orientation,
    nativeDims: [ex, ez, ey] as [number, number, number],
    dims: [ex * scale[0], ez * scale[2], ey * scale[1]] as [number, number, number],
    distortion: [scale[0] / even, scale[2] / even, scale[1] / even] as [number, number, number],
  };
}

export async function gltfIO(): Promise<NodeIO> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

function meshesOf(doc: Document): Mesh[] {
  return doc.getRoot().listMeshes();
}

/** Every vertex, in world space once node transforms are baked. At most `limit` points, evenly sampled. */
export function collectPoints(doc: Document, limit = 40_000): Points {
  const all: number[] = [];
  let total = 0;
  for (const mesh of meshesOf(doc)) for (const prim of mesh.listPrimitives()) total += prim.getAttribute("POSITION")?.getCount() ?? 0;
  const stride = Math.max(1, Math.floor(total / limit));
  let n = 0;
  const el: number[] = [];
  for (const mesh of meshesOf(doc)) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++, n++) {
        if (n % stride) continue;
        pos.getElement(i, el);
        all.push(el[0], el[1], el[2]);
      }
    }
  }
  return Float64Array.from(all);
}

export function triangleCount(doc: Document): number {
  let tris = 0;
  for (const mesh of meshesOf(doc))
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      tris += Math.floor((indices ? indices.getCount() : (prim.getAttribute("POSITION")?.getCount() ?? 0)) / 3);
    }
  return tris;
}

/**
 * Normalises a GLB: bakes node transforms into the meshes, squares the model
 * up, tames materials (image-to-3D services like shiny, glowing surfaces),
 * simplifies to the triangle budget, and compresses textures to WebP and
 * geometry with meshopt.
 */
export async function normaliseGlb(
  glb: Uint8Array,
  target: Target,
  budget: { tris: number; textureSize: number },
  override?: { yawDeg?: number; turns?: Turns },
  facing: Turns = 0,
): Promise<{ glb: Uint8Array; result: NormaliseResult }> {
  const io = await gltfIO();
  const doc = await io.readBinary(glb);
  await doc.transform(flatten());
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node);

  const placement = solvePlacement(collectPoints(doc), target, override, facing);
  const done = new Set<Mesh>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh && !done.has(mesh)) {
      transformMesh(mesh, placement.matrix as Parameters<typeof transformMesh>[1]);
      done.add(mesh);
    }
  }

  // Matte everywhere: services ship glossy roughness maps that catch the light and wash colours out,
  // and furniture seen across a room or from above reads as matte anyway.
  for (const material of doc.getRoot().listMaterials()) {
    material.setMetallicRoughnessTexture(null);
    material.setMetallicFactor(0);
    material.setRoughnessFactor(MATTE_ROUGHNESS);
    material.setEmissiveFactor([0, 0, 0]);
    material.setEmissiveTexture(null);
  }

  await doc.transform(weld(), dedup(), join(), prune());
  const before = triangleCount(doc);
  if (before > budget.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget.tris / before, error: 0.01 }));
  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [budget.textureSize, budget.textureSize], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const out = await io.writeBinary(doc);
  return {
    glb: out,
    result: {
      orientation: placement.orientation,
      nativeDims: placement.nativeDims.map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
      dims: placement.dims.map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
      distortion: placement.distortion.map((v) => Math.round(v * 100) / 100) as [number, number, number],
      tris: triangleCount(doc),
    },
  };
}
