import { z } from "zod";
import { DEFAULT_BRIEF, houseBriefSchema, normaliseBrief, type HouseBrief } from "../brief/schema";
import type { PlanIssue } from "../commands/types";
import { loadPlanDocument } from "../commands/serialization";
import type { Id, PlanDocument } from "../plan/types";
import { siteSchema, type Site } from "./site";

/**
 * A project: the user's brief plus one or more alternative plans. Each plan
 * variant is a complete, independently valid PlanDocument with its lineage
 * (where it came from, which part of the source it changed).
 */

export const PROJECT_FORMAT = "floor-plan-project" as const;
export const PROJECT_SCHEMA_VERSION = 1 as const;
export const MAX_PLANS = 60;

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
    /** For layouts sized from the rooms: arrangement@WxD, which tells layouts in the same arrangement apart. */
    variant: z.string().max(80).optional(),
    /** Why to pick it over the others generated with it ("Most compact"); see design/layoutNames.ts. */
    title: z.string().max(60).optional(),
    /** The brief it was generated from, so Design history can bring the rooms back. Absent on plans made before history. */
    brief: houseBriefSchema.optional(),
    /** When it was generated, ISO 8601. */
    at: z.string().max(40).optional(),
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
export const EXTERIOR_FINISHES = ["white_render", "brick", "timber", "dark_render", "painted_brick", "stone"] as const;
export const FRAME_FINISHES = ["black", "white", "oak", "grey", "bronze"] as const;
/** Curated wall colours for the painted finishes (render, painted brick). No free colour picker, so every house stays tasteful. */
export const WALL_COLOURS = ["white", "cream", "sage", "sky", "stone_grey", "sand", "terracotta", "charcoal"] as const;
export const DOOR_COLOURS = ["white", "black", "navy", "green", "red", "yellow", "oak"] as const;
export const ROOF_FINISHES = ["membrane", "zinc", "slate", "tile"] as const;
export const ROOF_FORMS = ["hipped", "gabled", "flat"] as const;
/** The finishes each roof shape can take: a membrane only lies flat, slate and tile only on a slope. */
export const ROOF_FINISHES_FOR: Record<(typeof ROOF_FORMS)[number], readonly (typeof ROOF_FINISHES)[number][]> = { flat: ["membrane", "zinc"], hipped: ["slate", "tile", "zinc"], gabled: ["slate", "tile", "zinc"] };

/** How rooms are furnished and finished in photo renders. */
export const INTERIOR_STYLES = ["modern", "scandinavian", "warm_minimal", "industrial", "farmhouse", "coastal"] as const;
export const INTERIOR_STYLE_LABEL: Record<InteriorStyle, string> = {
  modern: "Modern",
  scandinavian: "Scandinavian",
  warm_minimal: "Warm minimal",
  industrial: "Industrial",
  farmhouse: "Farmhouse",
  coastal: "Coastal",
};

/** The house's architectural style in exterior photo renders. */
export const EXTERIOR_STYLES = ["contemporary", "farmhouse", "cottage", "craftsman", "scandinavian", "mediterranean", "traditional", "coastal"] as const;
export const EXTERIOR_STYLE_LABEL: Record<(typeof EXTERIOR_STYLES)[number], string> = {
  contemporary: "Contemporary",
  farmhouse: "Modern farmhouse",
  cottage: "Cottage",
  craftsman: "Craftsman",
  scandinavian: "Scandinavian",
  mediterranean: "Mediterranean",
  traditional: "Traditional brick",
  coastal: "Coastal",
};

/** Roof pitch in degrees, per pitched form. A flat roof has none. */
export const ROOF_PITCH_RANGE = { hipped: { min: 20, max: 45, default: 35 }, gabled: { min: 20, max: 50, default: 35 } } as const;

export const appearanceSchema = z.object({
  exterior: z.enum(EXTERIOR_FINISHES),
  frames: z.enum(FRAME_FINISHES),
  roof: z.enum(ROOF_FINISHES),
  /** Optional: projects saved before pitched roofs stay flat. */
  roofForm: z.enum(ROOF_FORMS).optional(),
  /** Optional: projects saved before photo renders use the default style. */
  interiorStyle: z.enum(INTERIOR_STYLES).optional(),
  /** Optional: absent means no particular style, as before styles existed. */
  exteriorStyle: z.enum(EXTERIOR_STYLES).optional(),
  /** Optional: absent means the finish's own colour. Only render and painted brick take one. */
  wallColour: z.enum(WALL_COLOURS).optional(),
  /** Optional: absent means the default off-white door. */
  doorColour: z.enum(DOOR_COLOURS).optional(),
  /** Optional, degrees: absent means the default pitch. Ignored on a flat roof. */
  roofPitch: z.number().min(15).max(55).optional(),
});

/**
 * Where generated layouts get their house size: the user's own house
 * ("source"), or chosen per layout from the rooms ("auto"), within a plot.
 */
export const plotSchema = z.object({ maxWidth: z.number().min(4).max(200).optional(), maxDepth: z.number().min(4).max(200).optional() });
export const sizingSchema = z.object({ footprint: z.enum(["source", "auto"]), plot: plotSchema.optional() });

/** How a project with no appearance looks: flat-roofed, as every project was before pitched roofs. */
export const DEFAULT_APPEARANCE: Appearance = { exterior: "white_render", frames: "black", roof: "membrane" };
/** How a project made now starts out: a hipped slate roof. */
export const NEW_PROJECT_APPEARANCE: Appearance = { ...DEFAULT_APPEARANCE, roof: "slate", roofForm: "hipped" };

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
  /** Optional: absent means layouts use the user's own house. */
  sizing: sizingSchema.optional(),
  /** Optional: the plot, its gaps and north, once set on the Map step. */
  site: siteSchema.optional(),
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
export type WallColour = (typeof WALL_COLOURS)[number];
export type DoorColour = (typeof DOOR_COLOURS)[number];
export type InteriorStyle = (typeof INTERIOR_STYLES)[number];
export type ExteriorStyle = (typeof EXTERIOR_STYLES)[number];
export type Sizing = z.infer<typeof sizingSchema>;
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
  sizing?: Sizing;
  site?: Site;
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
