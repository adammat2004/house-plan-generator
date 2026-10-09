import type { HouseBrief } from "../brief/schema";
import { createPlanDocument } from "../commands/factory";
import { planLayouts } from "../design/stripPlanner";
import { presetOutline } from "../geometry/outlinePresets";
import { ringSignedArea } from "../geometry/polygons";
import type { PlanDocument, Point2 } from "../plan/types";
import { projectFromPlan, type ProjectDocument } from "./schema";

/**
 * Starter projects. A template is a footprint plus a brief; its plan is laid
 * out by the same deterministic planner as the AI Designer, so a template is
 * exactly as editable as anything the user draws.
 */

export type TemplateStyle = "bungalow" | "detached" | "semi" | "annexe";

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  /** Outside dimensions of the footprint (its bounding box), m. */
  width: number;
  depth: number;
  /** Outside faces of a footprint that isn't a rectangle. */
  outline?: Point2[];
  brief: HouseBrief;
  /** Which planner arrangement to use (its candidate index). */
  arrangement: number;
  /** The exterior drawn on the template card. */
  style: TemplateStyle;
}

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: "bungalow-3",
    name: "3 Bed Bungalow",
    description: "Single-storey family home with an open-plan kitchen and living space on the garden side.",
    width: 13,
    depth: 10,
    brief: { bedrooms: 3, bathrooms: 2, requiredSpaces: ["kitchen", "living", "dining", "utility"], preferences: ["open_plan"], additionalInstructions: "" },
    arrangement: 0,
    style: "bungalow",
  },
  {
    id: "detached-4",
    name: "4 Bed Detached",
    description: "Generous ground floor with separate living room, kitchen/dining and a home office.",
    width: 15,
    depth: 12,
    brief: {
      bedrooms: 4,
      bathrooms: 2,
      requiredSpaces: ["kitchen", "living", "dining", "office", "utility"],
      preferences: ["separate_living_room"],
      additionalInstructions: "",
    },
    arrangement: 1,
    style: "detached",
  },
  {
    id: "semi-3",
    name: "3 Bed Semi-Detached",
    description: "Narrow, deep plan with living spaces to the garden and bedrooms to the street.",
    width: 8.5,
    depth: 13,
    brief: { bedrooms: 3, bathrooms: 1, requiredSpaces: ["kitchen", "living", "dining"], preferences: ["open_plan"], additionalInstructions: "" },
    arrangement: 0,
    style: "semi",
  },
  {
    id: "annexe-1",
    name: "1 Bed Annexe",
    description: "Compact garden annexe with a kitchen/living room, one bedroom and a shower room.",
    width: 8,
    depth: 6.5,
    brief: { bedrooms: 1, bathrooms: 1, requiredSpaces: ["kitchen", "living"], preferences: ["open_plan"], additionalInstructions: "" },
    arrangement: 0,
    style: "annexe",
  },
  {
    id: "l-bungalow-3",
    name: "L-shaped Bungalow",
    description: "A single-storey home in two wings, wrapped around a sheltered garden corner.",
    width: 15,
    depth: 13,
    outline: presetOutline("L", { width: 15, depth: 13, front: 6, wing: 6 }),
    brief: { bedrooms: 3, bathrooms: 2, requiredSpaces: ["kitchen", "living", "dining", "utility"], preferences: ["open_plan"], additionalInstructions: "" },
    arrangement: 0,
    style: "bungalow",
  },
];

/** Gross external floor area, m². */
export const templateArea = (t: ProjectTemplate) => Math.round(t.outline ? ringSignedArea(t.outline) : t.width * t.depth);

/** Lays out a template's plan. Ids are namespaced by `idPrefix`, so every call can produce a fresh copy. */
export function buildTemplatePlan(template: ProjectTemplate, idPrefix: string): PlanDocument | null {
  const source = createPlanDocument({
    id: `${idPrefix}-source`,
    name: template.name,
    width: template.width,
    depth: template.depth,
    idPrefix: `${idPrefix}-src`,
    ...(template.outline ? { outline: template.outline } : {}),
  });
  const result = planLayouts({
    intent: { action: "generate_layouts", brief: template.brief, count: template.arrangement + 1 },
    source,
    brief: template.brief,
    idPrefix,
  });
  const candidate = result.candidates[template.arrangement] ?? result.candidates[0];
  return candidate ? { ...candidate.document, name: template.name } : null;
}

/** A new project started from a template: one user plan plus the template's brief. */
export function projectFromTemplate(template: ProjectTemplate, options: { id: string; idPrefix: string; now: string }): ProjectDocument | null {
  const plan = buildTemplatePlan(template, options.idPrefix);
  if (!plan) return null;
  return { ...projectFromPlan(plan, { now: options.now, brief: template.brief }), id: options.id };
}
