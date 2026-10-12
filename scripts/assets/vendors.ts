import { createFalClient, type FalClient } from "@fal-ai/client";
import type { ColourCorrection, Turns } from "./normalise";

/**
 * Image-to-3D services, all reached through fal.ai with one key. Each turns
 * a reference picture into a GLB. Hunyuan3D is left out on purpose: its
 * licence excludes the EU and UK.
 */

export interface MeshVendor {
  id: string;
  endpoint: string;
  licence: string;
  /** Quarter turns that square the service's own facing up to ours, used when a piece has no back to go by. */
  facing: Turns;
  /** Undoes the service's colour habit in its textures, if it has one. */
  colour?: ColourCorrection;
  /** Rough price of one model, USD, for the run's cost estimate. */
  costUsd: number;
  input(imageUrl: string): Record<string, unknown>;
  /** Where the GLB is in the service's answer. */
  glbUrl(output: Record<string, unknown>): string | undefined;
}

const fileUrl = (value: unknown) => (value && typeof value === "object" && "url" in value ? String((value as { url: unknown }).url) : undefined);

export const VENDORS: Record<string, MeshVendor> = {
  trellis: {
    id: "trellis",
    facing: 0,
    endpoint: "fal-ai/trellis",
    licence: "MIT (Microsoft TRELLIS); fal output, commercial use",
    costUsd: 0.02,
    input: (image_url) => ({ image_url, texture_size: 1024, mesh_simplify: 0.95, seed: 7 }),
    glbUrl: (o) => fileUrl(o.model_mesh),
  },
  trellis2: {
    id: "trellis2",
    facing: 0,
    endpoint: "fal-ai/trellis-2",
    licence: "MIT (Microsoft TRELLIS.2); fal output, commercial use",
    costUsd: 0.3,
    input: (image_url) => ({ image_url, resolution: 1024, texture_size: 2048, decimation_target: 100_000, seed: 7 }),
    glbUrl: (o) => fileUrl(o.model_glb),
  },
  tripo: {
    id: "tripo",
    facing: 3,
    // Its oak comes out orange next to the reference pictures.
    colour: { saturation: 0.8, brightness: 1.04 },
    endpoint: "tripo3d/tripo/v2.5/image-to-3d",
    licence: "Tripo API output, commercial use on paid plans",
    costUsd: 0.3,
    // "default" orientation asks for the model squared up, not turned as in the picture.
    input: (image_url) => ({ image_url, texture: "HD", pbr: true, orientation: "default", face_limit: 60_000, seed: 7 }),
    glbUrl: (o) => fileUrl(o.pbr_model) ?? fileUrl(o.model_mesh),
  },
  meshy: {
    id: "meshy",
    facing: 0,
    endpoint: "meshy/v7.1/image-to-3d",
    licence: "Meshy API output, commercial use on paid plans",
    costUsd: 0.4,
    input: (image_url) => ({ image_url, model_type: "standard", topology: "triangle", target_polycount: 30_000, symmetry_mode: "auto", should_remesh: true, should_texture: true, enable_pbr: true }),
    glbUrl: (o) => fileUrl(o.model_glb),
  },
  rodin: {
    id: "rodin",
    facing: 0,
    endpoint: "fal-ai/hyper3d/rodin",
    licence: "Hyper3D Rodin API output, commercial use",
    costUsd: 0.4,
    input: (image_url) => ({ input_image_urls: [image_url], geometry_file_format: "glb", material: "PBR", quality: "medium", tier: "Regular", seed: 7 }),
    glbUrl: (o) => fileUrl(o.model_mesh),
  },
};

export function vendor(id: string): MeshVendor {
  const v = VENDORS[id];
  if (!v) throw new Error(`Unknown 3D service ${id}; one of ${Object.keys(VENDORS).join(", ")}.`);
  return v;
}

let client: FalClient | null = null;

function fal(): FalClient {
  const credentials = process.env.FAL_KEY;
  if (!credentials) throw new Error("FAL_KEY isn't set (.env.local).");
  client ??= createFalClient({ credentials });
  return client;
}

/** Uploads a reference picture to fal's storage and returns its URL. */
export async function uploadPicture(png: Buffer): Promise<string> {
  try {
    return await fal().storage.upload(new Blob([new Uint8Array(png)], { type: "image/png" }));
  } catch (error) {
    throw falError("upload", error);
  }
}

/** fal's errors carry the reason (an empty balance, a bad input) in the body, not the message. */
function falError(what: string, error: unknown): Error {
  const body = (error as { body?: { detail?: unknown } }).body;
  const detail = body?.detail ?? body;
  return new Error(`${what}: ${error instanceof Error ? error.message : String(error)}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)}` : ""}`);
}

/** Queues a model. The request id is saved by the caller, so a run that stops can pick it up again. */
export async function submitModel(v: MeshVendor, imageUrl: string): Promise<string> {
  try {
    const queued = await fal().queue.submit(v.endpoint, { input: v.input(imageUrl) });
    return queued.request_id;
  } catch (error) {
    throw falError("submit", error);
  }
}

/** Waits for a queued model and downloads its GLB. */
export async function fetchModel(v: MeshVendor, requestId: string, timeoutMs = 600_000): Promise<Buffer> {
  const started = Date.now();
  for (;;) {
    const status = await fal().queue.status(v.endpoint, { requestId, logs: false });
    if (status.status === "COMPLETED") break;
    if (Date.now() - started > timeoutMs) throw new Error(`${v.id} took longer than ${timeoutMs / 1000} s (request ${requestId}).`);
    await new Promise((r) => setTimeout(r, 4000));
  }
  const result = await fal().queue.result(v.endpoint, { requestId });
  const url = v.glbUrl(result.data as Record<string, unknown>);
  if (!url) throw new Error(`${v.id} answered without a model: ${JSON.stringify(result.data).slice(0, 300)}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download the ${v.id} model (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
