import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import type { FurnitureKind } from "@/domain/plan/types";
import type { FurnitureAssetManifest } from "@/editor/rendering/assets/manifest";
import { CACHE, SPRITE } from "./config";
import type { NormaliseResult } from "./normalise";
import { vendor } from "./vendors";

/**
 * `npm run assets:publish`: copies the made assets the app should use into
 * public/assets/furniture, named by content so they can be cached forever,
 * and writes the manifest the app reads (src/editor/rendering/assets/
 * furnitureAssets.json). No paid calls.
 *
 * Each style/kind uses the service named for it in scripts/assets/review.json,
 * else Tripo; pieces marked "rejected" there are left out (and drawn in code).
 */

const OUT = "public/assets/furniture";
const MANIFEST = "src/editor/rendering/assets/furnitureAssets.json";
const REVIEW_FILE = "scripts/assets/review.json";
const DEFAULT_VENDOR = "tripo";

type Review = Record<string, { vendor?: string; status?: "approved" | "rejected" }>;

it("publishes the furniture assets", () => {
  const review: Review = existsSync(REVIEW_FILE) ? JSON.parse(readFileSync(REVIEW_FILE, "utf8")) : {};
  const entries: FurnitureAssetManifest["entries"] = [];
  const kept = new Set<string>();

  for (const style of existsSync(CACHE) ? readdirSync(CACHE) : []) {
    const styleDir = join(CACHE, style);
    if (!statSync(styleDir).isDirectory()) continue;
    for (const kind of readdirSync(styleDir) as FurnitureKind[]) {
      if (!(kind in FURNITURE_CATALOG)) continue;
      const key = `${style}/${kind}`;
      const r = review[key];
      if (r?.status === "rejected") continue;
      const v = r?.vendor ?? DEFAULT_VENDOR;
      const dir = join(styleDir, kind);
      const files = { glb: join(dir, `norm.${v}.glb`), sprite: join(dir, `sprite.${v}.webp`), norm: join(dir, `norm.${v}.json`), size: join(dir, `sprite.${v}.json`) };
      if (!Object.values(files).every(existsSync)) continue;

      const glb = readFileSync(files.glb);
      const sprite = readFileSync(files.sprite);
      const norm = JSON.parse(readFileSync(files.norm, "utf8")) as NormaliseResult & { hash: string; bytes: number };
      const size = JSON.parse(readFileSync(files.size, "utf8")) as { size: [number, number] };
      const short = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 8);
      const glbName = `${kind}.${short(glb)}.glb`;
      const spriteName = `${kind}.${short(sprite)}.webp`;
      mkdirSync(join(OUT, style), { recursive: true });
      copyFileSync(files.glb, join(OUT, style, glbName));
      copyFileSync(files.sprite, join(OUT, style, spriteName));
      kept.add(join(style, glbName)).add(join(style, spriteName));

      const spec = FURNITURE_CATALOG[kind];
      entries.push({
        kind,
        style: style as FurnitureAssetManifest["entries"][number]["style"],
        glb: `/assets/furniture/${style}/${glbName}`,
        sprite: { url: `/assets/furniture/${style}/${spriteName}`, width: size.size[0], height: size.size[1], pxPerM: SPRITE.pxPerM, marginM: SPRITE.marginM },
        dims: norm.dims,
        catalog: [spec.width, spec.depth, spec.height],
        tris: norm.tris,
        bytes: glb.byteLength,
        vendor: v,
        licence: vendor(v).licence,
        sourceHash: norm.hash,
      });
    }
  }

  // Files from earlier publishes that nothing points at any more.
  for (const style of existsSync(OUT) ? readdirSync(OUT) : []) {
    for (const file of readdirSync(join(OUT, style))) if (!kept.has(join(style, file))) rmSync(join(OUT, style, file));
  }

  entries.sort((a, b) => `${a.style}/${a.kind}`.localeCompare(`${b.style}/${b.kind}`));
  const manifest: FurnitureAssetManifest = { version: 1, entries };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Published ${entries.length} assets (${Math.round(entries.reduce((s, e) => s + e.bytes, 0) / 1024)} KB of models) to ${OUT}.\n`);
});
