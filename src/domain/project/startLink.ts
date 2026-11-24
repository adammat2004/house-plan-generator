import { z } from "zod";
import { houseBriefSchema } from "../brief/schema";
import { projectFromRooms } from "./fromRooms";
import { appearanceSchema, loadProjectDocument, planOriginSchema, projectFromPlan, sizingSchema, type PlanVariant, type ProjectDocument } from "./schema";
import { siteSchema } from "./site";

/**
 * "Send to my computer": one layout, carried in a link to open on another
 * device.
 *
 *   phone                                         computer
 *   { v: 1, name, brief, sizing, plan }           /start#<payload>
 *     JSON → deflate-raw → base64url ──────────▶    base64url → inflate → JSON
 *                                                   → checked like an opened project file
 *                                                     (schema, migrations, geometry)
 *                                                   → project id from a hash of the payload,
 *                                                     so opening the link twice reuses it
 *
 * The payload sits in the URL fragment, so it never reaches a server, and
 * nothing is re-planned on the computer: it gets exactly the plan that was
 * sent, with the brief and plot so "Show three more" works from there.
 */

const MAX_PAYLOAD_CHARS = 200_000;
const MAX_JSON_BYTES = 4_000_000;

const snapshotSchema = z.object({
  v: z.literal(1),
  name: z.string().max(200),
  brief: houseBriefSchema,
  sizing: sizingSchema.optional(),
  site: siteSchema.optional(),
  /** Optional: links made before it was sent take the computer's look for a new project. */
  appearance: appearanceSchema.optional(),
  plan: z.object({ label: z.string().trim().min(1).max(60), origin: planOriginSchema, document: z.unknown() }),
});

export type StartSnapshot = z.infer<typeof snapshotSchema>;

/** What a link carries for one plan of a project, or null if the plan isn't there. */
export function snapshotOf(project: ProjectDocument, planId: string): StartSnapshot | null {
  const plan = project.plans.find((p) => p.id === planId);
  if (!plan) return null;
  return {
    v: 1,
    name: project.name,
    brief: project.brief,
    ...(project.sizing ? { sizing: project.sizing } : {}),
    ...(project.site ? { site: project.site } : {}),
    ...(project.appearance ? { appearance: project.appearance } : {}),
    plan: { label: plan.label, origin: plan.origin, document: plan.document },
  };
}

async function through(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    // A small link that inflates to something huge isn't a plan.
    if (size > limit) {
      await reader.cancel();
      throw new Error("Too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The link payload for a snapshot: compressed JSON, safe in a URL fragment. */
export async function encodeSnapshot(snapshot: StartSnapshot): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(snapshot));
  return toBase64Url(await through(json, new CompressionStream("deflate-raw")));
}

/** Reads a link payload back, or null if it's damaged or isn't a snapshot. */
export async function decodeSnapshot(payload: string): Promise<StartSnapshot | null> {
  if (!payload || payload.length > MAX_PAYLOAD_CHARS || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  try {
    const json = await through(fromBase64Url(payload), new DecompressionStream("deflate-raw"), MAX_JSON_BYTES);
    const parsed = snapshotSchema.safeParse(JSON.parse(new TextDecoder().decode(json)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A project id from the payload itself, so the same link always opens the same project. */
export async function snapshotProjectId(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sent-${hex.slice(0, 24)}`;
}

/**
 * The project a snapshot opens as, validated exactly as an opened project
 * file is; null if the plan inside doesn't pass.
 */
export function projectFromSnapshot(snapshot: StartSnapshot, options: { id: string; idPrefix: string; now: string }): ProjectDocument | null {
  const planId = `${options.id}-1`;
  const sent = { ...(snapshot.plan.document as object), id: planId };
  let project: ProjectDocument;
  if (snapshot.sizing?.footprint === "auto") {
    // A house sized from its rooms keeps its shell, as one started on this computer would.
    const shell = projectFromRooms(snapshot.brief, { id: options.id, idPrefix: options.idPrefix, now: options.now, name: snapshot.name, count: 0, ...(snapshot.sizing.plot ? { plot: snapshot.sizing.plot } : {}) });
    if (!shell.ok) return null;
    const plan = { id: planId, label: snapshot.plan.label, parentId: shell.project.activePlanId, origin: snapshot.plan.origin, scope: { kind: "plan" }, createdAt: options.now, document: sent } as unknown as PlanVariant;
    project = { ...shell.project, ...(snapshot.site ? { site: snapshot.site } : {}), activePlanId: planId, plans: [...shell.project.plans, plan] };
  } else {
    const base = projectFromPlan(sent as PlanVariant["document"], { now: options.now, brief: snapshot.brief, label: snapshot.plan.label });
    project = { ...base, id: options.id, name: snapshot.name, ...(snapshot.sizing ? { sizing: snapshot.sizing } : {}), ...(snapshot.site ? { site: snapshot.site } : {}), plans: base.plans.map((p) => ({ ...p, origin: snapshot.plan.origin })) };
  }
  if (snapshot.appearance) project = { ...project, appearance: snapshot.appearance };
  const loaded = loadProjectDocument(project, options.now);
  return loaded.ok ? loaded.project : null;
}
