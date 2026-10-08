import { z } from "zod";
import { DEFAULT_BRIEF, houseBriefSchema, normaliseBrief, type HouseBrief } from "../brief/schema";
import type { PlanIssue } from "../commands/types";
import { loadPlanDocument } from "../commands/serialization";
import type { Id, PlanDocument } from "../plan/types";

/**
 * A project: the user's brief plus one or more alternative plans. Each plan
 * variant is a complete, independently valid PlanDocument with its lineage
 * (where it came from, which part of the source it changed).
 */

export const PROJECT_FORMAT = "floor-plan-project" as const;
export const PROJECT_SCHEMA_VERSION = 1 as const;
export const MAX_PLANS = 40;

const idSchema = z.string().min(1).max(200);

export const planOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({
    kind: z.literal("generated"),
    /** Identifies the generation request; candidates of one request share it. */
    requestId: idSchema,
    planner: z.string().min(1).max(100),
    /** Candidate index within the request; with the request, reproduces the plan. */
    seed: z.number().int().nonnegative(),
    summary: z.string().max(400).optional(),
    notes: z.array(z.string().max(400)).max(20).optional(),
    /** The planner's arrangement for whole-plan layouts; optional for plans saved before it existed. */
    arrangement: z.string().max(60).optional(),
  }),
]);

/** What a variant changed relative to its parent: the whole plan, or a set of rooms. */
export const planScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan") }),
  z.object({ kind: z.literal("rooms"), roomIds: z.array(idSchema).min(1) }),
]);

/** Where the project is and what it is. Recorded for later use; nothing checks plans against regulations yet. */
export const PROJECT_LOCATIONS = ["ireland", "uk", "other"] as const;
export const PROJECT_TYPES = ["house", "extension", "other"] as const;

export const projectDetailsSchema = z.object({
  location: z.enum(PROJECT_LOCATIONS).nullable(),
  type: z.enum(PROJECT_TYPES).nullable(),
});

export const PROJECT_LOCATION_LABEL: Record<ProjectLocation, string> = { ireland: "Ireland", uk: "United Kingdom", other: "Somewhere else" };
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = { house: "House", extension: "Extension", other: "Other" };

/** How the house looks outside, for the 3D view. Recorded per project. */
export const EXTERIOR_FINISHES = ["white_render", "brick", "timber", "dark_render"] as const;
export const FRAME_FINISHES = ["black", "white", "oak"] as const;
export const ROOF_FINISHES = ["membrane", "zinc"] as const;

export const appearanceSchema = z.object({
  exterior: z.enum(EXTERIOR_FINISHES),
  frames: z.enum(FRAME_FINISHES),
  roof: z.enum(ROOF_FINISHES),
});

export const DEFAULT_APPEARANCE: Appearance = { exterior: "white_render", frames: "black", roof: "membrane" };

const planVariantShape = {
  id: idSchema,
  label: z.string().trim().min(1).max(60),
  parentId: idSchema.nullable(),
  origin: planOriginSchema,
  scope: planScopeSchema,
  createdAt: z.string().max(40),
};

const rawProjectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: idSchema,
  name: z.string().max(200),
  brief: houseBriefSchema,
  /** Optional: projects saved before details existed have none. */
  details: projectDetailsSchema.optional(),
  /** Optional: projects saved before the 3D view have the default look. */
  appearance: appearanceSchema.optional(),
  activePlanId: idSchema,
  plans: z
    .array(z.object({ ...planVariantShape, document: z.unknown() }))
    .min(1)
    .max(MAX_PLANS),
});

export type PlanOrigin = z.infer<typeof planOriginSchema>;
export type ProjectLocation = (typeof PROJECT_LOCATIONS)[number];
export type ProjectType = (typeof PROJECT_TYPES)[number];
export type ProjectDetails = z.infer<typeof projectDetailsSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;
export type ExteriorFinish = Appearance["exterior"];
export type FrameFinish = Appearance["frames"];
export type RoofFinish = Appearance["roof"];
export type PlanScope = z.infer<typeof planScopeSchema>;
export type PlanVariantMeta = Omit<z.infer<typeof rawProjectSchema>["plans"][number], "document">;
export interface PlanVariant extends PlanVariantMeta {
  document: PlanDocument;
}
export interface ProjectDocument {
  format: typeof PROJECT_FORMAT;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: Id;
  name: string;
  brief: HouseBrief;
  details?: ProjectDetails;
  appearance?: Appearance;
  activePlanId: Id;
  plans: PlanVariant[];
}

export type ProjectLoadResult =
  | { ok: true; project: ProjectDocument; /** True when the input was a bare PlanDocument. */ wrapped: boolean }
  | { ok: false; issues: PlanIssue[] };

/** Wraps a single plan as a project with one user plan. */
export function projectFromPlan(document: PlanDocument, options: { now: string; brief?: HouseBrief; label?: string }): ProjectDocument {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: document.id,
    name: document.name,
    brief: options.brief ?? DEFAULT_BRIEF,
    activePlanId: document.id,
    plans: [
      {
        id: document.id,
        label: options.label ?? "My plan",
        parentId: null,
        origin: { kind: "user" },
        scope: { kind: "plan" },
        createdAt: options.now,
        document,
      },
    ],
  };
}

const malformed = (message: string): ProjectLoadResult => ({ ok: false, issues: [{ code: "malformed-file", message, entityIds: [] }] });

/**
 * Parses and fully validates a project, or a bare PlanDocument (which is
 * wrapped as a one-plan project). Every plan goes through the same
 * migration and geometric validation as a single-plan file.
 */
export function loadProjectDocument(raw: unknown, now: string): ProjectLoadResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return malformed("The file does not contain a floor plan.");
  if ((raw as { format?: unknown }).format !== PROJECT_FORMAT) {
    const plan = loadPlanDocument(raw);
    return plan.ok ? { ok: true, project: projectFromPlan(plan.document, { now }), wrapped: true } : plan;
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === "number" && version > PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [{ code: "unsupported-version", message: `This project uses format version ${version}, which is newer than this editor supports (version ${PROJECT_SCHEMA_VERSION}).`, entityIds: [] }],
    };
  }
  const parsed = rawProjectSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return malformed(`Invalid ${issue?.path.length ? issue.path.join(".") : "project"}: ${issue?.message ?? "unknown problem"}`);
  }
  const plans: PlanVariant[] = [];
  const ids = new Set<string>();
  for (const plan of parsed.data.plans) {
    if (ids.has(plan.id)) return malformed(`Two plans share the id ${plan.id}.`);
    ids.add(plan.id);
    const document = loadPlanDocument(plan.document);
    if (!document.ok) {
      return { ok: false, issues: document.issues.map((i) => ({ ...i, message: `${plan.label}: ${i.message}` })) };
    }
    plans.push({ ...plan, document: document.document });
  }
  if (!ids.has(parsed.data.activePlanId)) return malformed("The active plan is missing from the project.");
  for (const plan of plans) {
    if (plan.parentId !== null && !ids.has(plan.parentId)) return malformed(`${plan.label} refers to a plan that isn't in the project.`);
  }
  return { ok: true, project: { ...parsed.data, brief: normaliseBrief(parsed.data.brief), plans }, wrapped: false };
}

export function parseProjectJson(text: string, now: string): ProjectLoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return malformed("The file is not valid JSON.");
  }
  return loadProjectDocument(raw, now);
}

export function serializeProject(project: ProjectDocument): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

/** The next free "Plan A", "Plan B", … label. */
export function nextPlanLabel(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 0; ; n++) {
    let label = "";
    let k = n;
    do {
      label = String.fromCharCode(65 + (k % 26)) + label;
      k = Math.floor(k / 26) - 1;
    } while (k >= 0);
    if (!used.has(`Plan ${label}`)) return `Plan ${label}`;
  }
}
