import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Document } from "@gltf-transform/core";
import { afterAll, beforeAll, describe, it } from "vitest";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import type { FurnitureKind } from "@/domain/plan/types";
import type { InteriorStyle } from "@/domain/project/schema";
import { furnitureBoxes, type FurnitureTone } from "@/editor/rendering/three/furnitureModel";
import { createBaker, type Baker } from "./bake";
import { ANY_STYLE, SHEET, cacheDir, runOptions, textureSize, triangleBudget } from "./config";
import { REFERENCE_MODEL, referencePicture } from "./gemini";
import { gltfIO, normaliseGlb, type NormaliseResult, type Target, type Turns } from "./normalise";
import { PROMPT_VERSION, referencePrompt } from "./prompts";
import { fetchModel, submitModel, uploadPicture, vendor } from "./vendors";

/**
 * `npm run assets:build`: makes furniture assets stage by stage, each cached
 * in .assets-cache by what went into it, so a run that stops picks up where
 * it left off and nothing paid is made twice:
 *
 *   reference picture (Gemini) → 3D model (fal.ai) → normalised GLB → plan picture
 *
 * Then it writes a contact sheet to test-results/assets/index.html.
 *
 *   npm run assets:build                                    the spike: warm_minimal × 5 kinds × 5 services
 *   ASSETS_KINDS=sofa_3 ASSETS_VENDOR=tripo npm run assets:build
 *   ASSETS_FORCE=mesh …                                     make a stage again (ref, mesh, normalise, sprite)
 *   ASSETS_DRY=1 …                                          say what would be made and what it costs
 *   ASSETS_VENDOR=none …                                    reference pictures only
 *   ASSETS_SMOKE=1 …                                        no keys, no calls: box furniture through the later stages
 *
 * Keys come from .env.local: GEMINI_API_KEY and FAL_KEY.
 */

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const options = runOptions();
const SMOKE = process.env.ASSETS_SMOKE === "1";
const REVIEW_FILE = "scripts/assets/review.json";
const HARNESS_VERSION = 1;

type Review = Record<string, { vendor?: string; status?: "approved" | "rejected"; turns?: Turns; yawDeg?: number; note?: string }>;
const review: Review = existsSync(REVIEW_FILE) ? JSON.parse(readFileSync(REVIEW_FILE, "utf8")) : {};

const hash = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const FIT: Partial<Record<FurnitureKind, Target["fit"]>> = { car: "fit", toilet: "fit", plant: "fit" };
/** The catalog height of a bed is the mattress; the headboard stands higher. */
const NATURAL_HEIGHT: FurnitureKind[] = ["bed_single", "bed_double", "bed_king"];

function targetOf(kind: FurnitureKind): Target {
  const s = FURNITURE_CATALOG[kind];
  return { width: s.width, depth: s.depth, height: s.height, fit: FIT[kind] ?? "stretch", placement: s.placement, naturalHeight: NATURAL_HEIGHT.includes(kind) };
}

interface Row {
  style: InteriorStyle | "any";
  kind: FurnitureKind;
  ref?: string;
  results: Array<{ vendor: string; error?: string; norm?: NormaliseResult & { bytes: number; meshSeconds?: number }; sprite?: string; preview?: string; spriteSize?: [number, number] }>;
}

const rows: Row[] = [];
const spent: Array<{ what: string; usd: number }> = [];
let baker: Baker | null = null;
let baking: Promise<unknown> = Promise.resolve();

/** One bake at a time: each one opens WebGL contexts, and the page has only so many. */
function bakeOne(glb: Uint8Array, kind: FurnitureKind) {
  const { width, depth, height } = FURNITURE_CATALOG[kind];
  const run = baking.then(() => baker!.bake(glb, { width, depth, height }));
  baking = run.catch(() => undefined);
  return run;
}

/** Box furniture from the 3D view, turned and shrunk the way a service's model might arrive. */
async function smokeModel(kind: FurnitureKind): Promise<Uint8Array> {
  const s = FURNITURE_CATALOG[kind];
  const doc = new Document();
  const buffer = doc.createBuffer();
  const root = doc.createNode().setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]).setScale([0.5, 0.5, 0.5]);
  doc.createScene().addChild(root);
  const colours: Partial<Record<FurnitureTone, [number, number, number]>> = { fabric: [0.55, 0.52, 0.47], cushion: [0.7, 0.67, 0.6], wood: [0.45, 0.3, 0.18], duvet: [0.62, 0.68, 0.72], linen: [0.92, 0.9, 0.86] };
  const boxes = furnitureBoxes({ id: "smoke", kind, position: { x: 0, y: 0 }, rotation: 0, width: s.width, depth: s.depth, height: s.height });
  for (const b of boxes) {
    const [x0, x1, y0, y1, z0, z1] = [b.center.x - b.length / 2, b.center.x + b.length / 2, b.z0, b.z0 + b.height, -(b.center.y + b.depth / 2), -(b.center.y - b.depth / 2)];
    const c = (i: number) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
    const faces = [
      [0, 2, 3, 1],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [2, 6, 7, 3],
      [0, 4, 6, 2],
      [1, 3, 7, 5],
    ];
    const positions = Float32Array.from(faces.flatMap(([a, b2, d, e]) => [a, b2, d, a, d, e].flatMap(c)));
    const material = doc
      .createMaterial()
      .setBaseColorFactor([...(colours[b.tone as FurnitureTone] ?? [0.9, 0.9, 0.88]), 1])
      .setRoughnessFactor(0.8);
    const prim = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer)).setMaterial(material);
    root.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  }
  return (await gltfIO()).writeBinary(doc);
}

async function reference(style: InteriorStyle | "any", kind: FurnitureKind, dir: string): Promise<{ png: Buffer; hash: string }> {
  const prompt = referencePrompt(kind, style);
  const h = hash(prompt, PROMPT_VERSION, REFERENCE_MODEL);
  const file = join(dir, "ref.png");
  const meta = readJson<{ hash: string }>(join(dir, "ref.json"));
  if (existsSync(file) && meta?.hash === h && !options.force.has("ref")) return { png: readFileSync(file), hash: h };
  const png = await referencePicture(prompt);
  spent.push({ what: `reference ${style}/${kind}`, usd: 0.07 });
  writeFileSync(file, png);
  writeJson(join(dir, "ref.json"), { hash: h, prompt, model: REFERENCE_MODEL, createdAt: new Date().toISOString() });
  return { png, hash: h };
}

async function mesh(vendorId: string, kind: FurnitureKind, dir: string, ref: { png: Buffer; hash: string }): Promise<{ glb: Uint8Array; hash: string; seconds?: number }> {
  const v = vendor(vendorId);
  const h = hash(ref.hash, v.endpoint, v.input("x"));
  const file = join(dir, `mesh.${vendorId}.glb`);
  const metaFile = join(dir, `mesh.${vendorId}.json`);
  let meta = readJson<{ hash: string; requestId?: string; seconds?: number; submittedAt?: string }>(metaFile);
  if (existsSync(file) && meta?.hash === h && !options.force.has("mesh")) return { glb: readFileSync(file), hash: h, seconds: meta.seconds };
  // A model queued by a run that stopped is collected, not paid for again.
  if (meta?.hash !== h || !meta.requestId || options.force.has("mesh")) {
    const imageUrl = await uploadPicture(ref.png);
    const requestId = await submitModel(v, imageUrl);
    meta = { hash: h, requestId, submittedAt: new Date().toISOString() };
    writeJson(metaFile, meta);
    spent.push({ what: `${vendorId} ${kind}`, usd: v.costUsd });
  }
  const started = Date.now();
  const glb = await fetchModel(v, meta.requestId!);
  writeFileSync(file, glb);
  const seconds = Math.round((Date.now() - (meta.submittedAt ? Date.parse(meta.submittedAt) : started)) / 1000);
  writeJson(metaFile, { ...meta, seconds });
  return { glb, hash: h, seconds };
}

async function normalise(vendorId: string, kind: FurnitureKind, style: string, dir: string, raw: { glb: Uint8Array; hash: string }) {
  const r = review[`${style}/${kind}`];
  const override = r && (r.vendor ?? vendorId) === vendorId && (r.turns !== undefined || r.yawDeg !== undefined) ? { turns: r.turns, yawDeg: r.yawDeg } : undefined;
  const target = targetOf(kind);
  const budget = { tris: triangleBudget(kind), textureSize: textureSize(kind) };
  const facing = vendorId === "smoke" ? 0 : vendor(vendorId).facing;
  const h = hash(raw.hash, target, budget, override, facing, "normalise-3");
  const file = join(dir, `norm.${vendorId}.glb`);
  const metaFile = join(dir, `norm.${vendorId}.json`);
  const meta = readJson<NormaliseResult & { hash: string; bytes: number }>(metaFile);
  if (existsSync(file) && meta?.hash === h && !options.force.has("normalise")) return { glb: readFileSync(file), hash: h, result: meta };
  const { glb, result } = await normaliseGlb(raw.glb, target, budget, override, facing);
  writeFileSync(file, glb);
  const full = { ...result, bytes: glb.byteLength, hash: h };
  writeJson(metaFile, full);
  return { glb, hash: h, result: full };
}

async function sprite(vendorId: string, kind: FurnitureKind, dir: string, norm: { glb: Uint8Array; hash: string }) {
  const h = hash(norm.hash, HARNESS_VERSION);
  const spriteFile = join(dir, `sprite.${vendorId}.webp`);
  const previewFile = join(dir, `preview.${vendorId}.webp`);
  const metaFile = join(dir, `sprite.${vendorId}.json`);
  const meta = readJson<{ hash: string; size: [number, number] }>(metaFile);
  if (existsSync(spriteFile) && meta?.hash === h && !options.force.has("sprite")) return { spriteFile, previewFile, size: meta.size };
  const baked = await bakeOne(norm.glb, kind);
  writeFileSync(spriteFile, baked.sprite);
  writeFileSync(previewFile, baked.preview);
  writeJson(metaFile, { hash: h, size: baked.size });
  return { spriteFile, previewFile, size: baked.size };
}

/** ASSETS_VENDOR=none makes only the reference pictures, e.g. before there's a fal key. */
const REF_ONLY = options.vendors.length === 1 && options.vendors[0] === "none";
const keysPresent = !!process.env.GEMINI_API_KEY && (REF_ONLY || !!process.env.FAL_KEY);

describe.skipIf(!SMOKE && !options.dry && !keysPresent)("furniture assets", () => {
  beforeAll(async () => {
    if (!options.dry) baker = await createBaker();
  });

  afterAll(async () => {
    await baker?.close();
    if (options.dry) return;
    writeSheet();
    const total = spent.reduce((sum, s) => sum + s.usd, 0);
    process.stdout.write(`\nPaid calls this run: ${spent.length}, about $${total.toFixed(2)}. Sheet: ${join(SHEET, "index.html")}\n`);
  });

  const jobs = options.styles.flatMap((style) =>
    options.kinds.map((kind) => ({ style: (ANY_STYLE.includes(kind) ? "any" : style) as InteriorStyle | "any", kind })),
  );
  const unique = [...new Map(jobs.map((j) => [`${j.style}/${j.kind}`, j])).values()];
  const vendors = SMOKE ? ["smoke"] : REF_ONLY ? [] : options.vendors;

  if (options.dry) {
    it("says what it would make", () => {
      let usd = 0;
      for (const { style, kind } of unique) {
        const refCached = existsSync(join(cacheDir(style, kind), "ref.png"));
        const missing = vendors.filter((v) => !existsSync(join(cacheDir(style, kind), `mesh.${v}.glb`)));
        usd += (refCached ? 0 : 0.07) + missing.reduce((sum, v) => sum + vendor(v).costUsd, 0);
        process.stdout.write(`${style}/${kind}: reference ${refCached ? "cached" : "to make"}; models to make: ${missing.join(", ") || "none"}\n`);
      }
      process.stdout.write(`About $${usd.toFixed(2)} of paid calls.\n`);
    });
    return;
  }

  it.concurrent.each(unique)("$style/$kind", async ({ style, kind }) => {
    const dir = cacheDir(style, kind);
    mkdirSync(dir, { recursive: true });
    const row: Row = { style, kind, results: [] };
    rows.push(row);
    const ref = SMOKE ? null : await reference(style, kind, dir);
    if (ref) row.ref = join(dir, "ref.png");
    await Promise.all(
      vendors.map(async (vendorId) => {
        try {
          const raw = SMOKE ? { glb: await smokeModel(kind), hash: hash("smoke", kind) } : await mesh(vendorId, kind, dir, ref!);
          const norm = await normalise(vendorId, kind, style, dir, raw);
          const pics = await sprite(vendorId, kind, dir, norm);
          row.results.push({ vendor: vendorId, norm: { ...norm.result, meshSeconds: "seconds" in raw ? raw.seconds : undefined }, sprite: pics.spriteFile, preview: pics.previewFile, spriteSize: pics.size });
        } catch (error) {
          row.results.push({ vendor: vendorId, error: error instanceof Error ? error.message : String(error) });
        }
      }),
    );
    const failed = row.results.filter((r) => r.error);
    if (vendors.length && failed.length === vendors.length) throw new Error(failed.map((f) => `${f.vendor}: ${f.error}`).join("\n"));
  });
});

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A page of every piece made this run, side by side by service, for review. */
function writeSheet() {
  mkdirSync(join(SHEET, "files"), { recursive: true });
  const copy = (path: string | undefined) => {
    if (!path || !existsSync(path)) return "";
    const name = path.replace(/^\.assets-cache\//, "").replaceAll("/", "__");
    copyFileSync(path, join(SHEET, "files", name));
    return `files/${name}`;
  };
  const vendors = [...new Set(rows.flatMap((r) => r.results.map((x) => x.vendor)))].sort();
  const sorted = [...rows].sort((a, b) => `${a.style}/${a.kind}`.localeCompare(`${b.style}/${b.kind}`));
  const cards = sorted.map((row) => {
    const cells = vendors.map((v) => {
      const r = row.results.find((x) => x.vendor === v);
      if (!r) return `<td></td>`;
      if (r.error) return `<td class="err"><b>${esc(v)}</b><br>${esc(r.error)}</td>`;
      const n = r.norm!;
      const flagged = n.distortion.some((d) => d < 0.8 || d > 1.25);
      const [w, h] = r.spriteSize ?? [0, 0];
      return `<td><b>${esc(v)}</b>
        <div class="pics"><img src="${copy(r.preview)}" alt="">
        <div class="plan"><img src="${copy(r.sprite)}" style="width:${w / 2}px;height:${h / 2}px" alt=""></div></div>
        <div class="stats">${n.tris.toLocaleString()} tris · ${Math.round(n.bytes / 1024)} KB${n.meshSeconds ? ` · ${n.meshSeconds}s` : ""}<br>
        turn ${n.orientation.turns}×90° + ${n.orientation.yawDeg}° · back found ${n.orientation.confidence ? `(${n.orientation.confidence})` : "<span class=warn>guessed</span>"}<br>
        stretch w ${n.distortion[0]} · d ${n.distortion[1]} · h ${n.distortion[2]}${flagged ? ` <span class=warn>regenerate?</span>` : ""}</div></td>`;
    });
    return `<tr><th>${esc(row.style)}<br>${esc(row.kind)}${row.ref ? `<br><img class="ref" src="${copy(row.ref)}" alt="">` : ""}</th>${cells.join("")}</tr>`;
  });
  writeFileSync(
    join(SHEET, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Furniture assets</title>
<style>
body{font:13px/1.4 system-ui,sans-serif;margin:24px;color:#222;background:#faf9f7}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left;background:#fff}
th{width:180px}.ref{width:170px;margin-top:6px;border-radius:4px}
.pics{display:flex;gap:8px;align-items:center;margin:6px 0}.pics>img{width:240px;border-radius:4px}
.plan{padding:10px;background:#d8c4a3 repeating-linear-gradient(90deg,#d8c4a3 0 22px,#d2bd9b 22px 23px);border-radius:4px}
.stats{color:#555}.warn{color:#b3261e;font-weight:600}.err{color:#b3261e;max-width:300px}
</style>
<h1>Furniture assets</h1><p>Left: the reference picture. Each service: a three-quarter preview of the normalised model, and the plan picture on oak boards at half size (back at the top).</p>
<table><tr><th></th>${vendors.map((v) => `<th>${esc(v)}</th>`).join("")}</tr>${cards.join("")}</table>`,
  );
}
