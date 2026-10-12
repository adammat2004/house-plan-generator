import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { SPRITE } from "./config";

/**
 * Draws the plan picture and a preview of a normalised model in headless
 * Chromium with three.js, so the plan's furniture is the 3D model seen from
 * above. Files are served by intercepting requests to a made-up origin: no
 * server, no Next.
 */

const ORIGIN = "http://bake.local";
const HERE = join(process.cwd(), "scripts/assets/bake");
const THREE = join(process.cwd(), "node_modules/three");

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary" };

export interface Baker {
  bake(glb: Uint8Array, dims: { width: number; depth: number; height: number }): Promise<{ sprite: Buffer; preview: Buffer; size: [number, number] }>;
  close(): Promise<void>;
}

export async function createBaker(): Promise<Baker> {
  const browser: Browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page: Page = await browser.newPage();
  const models = new Map<string, Uint8Array>();
  let next = 0;
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    let body: Buffer | Uint8Array | null = null;
    if (path.startsWith("/model/")) body = models.get(path) ?? null;
    else if (path.startsWith("/three/")) body = await readFile(normalize(join(THREE, path.slice("/three/".length)))).catch(() => null);
    else body = await readFile(normalize(join(HERE, path === "/" ? "harness.html" : path))).catch(() => null);
    if (!body) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: Buffer.from(body), contentType: TYPES[extname(path)] ?? "application/octet-stream" });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/harness.html`);
  await page.waitForFunction(() => (window as unknown as { bakeReady?: boolean }).bakeReady === true, null, { timeout: 30_000 }).catch(() => {
    throw new Error(`The bake page didn't start: ${errors.join("; ") || "no error reported"}`);
  });

  return {
    async bake(glb, dims) {
      const url = `/model/${next++}.glb`;
      models.set(url, glb);
      try {
        const { sprite, preview } = await page.evaluate(
          async ([u, d]) => (window as unknown as { bake: (u: string, d: unknown) => Promise<{ sprite: string; preview: string }> }).bake(u, d),
          [`${ORIGIN}${url}`, { ...dims, pxPerM: SPRITE.pxPerM, marginM: SPRITE.marginM }] as const,
        );
        const png = (data: string) => Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
        const spritePng = png(sprite);
        const meta = await sharp(spritePng).metadata();
        return {
          sprite: await sharp(spritePng).webp({ quality: 86, alphaQuality: 90, effort: 5 }).toBuffer(),
          preview: await sharp(png(preview)).webp({ quality: 82 }).toBuffer(),
          size: [meta.width ?? 0, meta.height ?? 0],
        };
      } finally {
        models.delete(url);
      }
    },
    close: () => browser.close(),
  };
}
