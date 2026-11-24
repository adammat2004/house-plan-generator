import { normaliseBrief, type HouseBrief } from "../brief/schema";
import { createPlanDocument } from "../commands/factory";
import { footprintsFor, type PlotLimits } from "../design/footprint";
import { programFromBrief } from "../design/program";
import { layoutNames } from "../design/layoutNames";
import { planLayouts } from "../design/stripPlanner";
import { ARRANGEMENTS, hallWidthFor } from "../design/zoning";
import { DEFAULT_HOUSE } from "../plan/defaults";
import { nextPlanLabel, projectFromPlan, type PlanVariant, type ProjectDetails, type ProjectDocument } from "./schema";

/**
 * A project started from a list of rooms rather than a drawing: the house
 * size comes from the rooms, and the project opens with a set of generated
 * layouts (none when `count` is 0, to pick rooms first). Its own plan is an
 * empty shell at a typical size for those rooms, kept as the starting point
 * the layouts hang off.
 */
export function projectFromRooms(
  brief: HouseBrief,
  options: { id: string; idPrefix: string; now: string; name: string; plot?: PlotLimits; details?: ProjectDetails; count?: number },
): { ok: true; project: ProjectDocument } | { ok: false; message: string } {
  const normalised = normaliseBrief(brief);
  const program = programFromBrief(normalised, 2);
  const typical = footprintsFor(program, ARRANGEMENTS[0], {
    externalThickness: DEFAULT_HOUSE.externalThickness,
    hallWidth: hallWidthFor(new Set(normalised.preferences)),
    plot: options.plot,
  })[0];
  const shell = createPlanDocument({
    id: `${options.id}-shell`,
    name: options.name,
    width: typical?.width ?? DEFAULT_HOUSE.width,
    depth: typical?.depth ?? DEFAULT_HOUSE.depth,
    idPrefix: `${options.idPrefix}-shell`,
  });
  const base = projectFromPlan(shell, { now: options.now, brief: normalised, label: "Shell" });
  const sizing = { footprint: "auto" as const, ...(options.plot ? { plot: options.plot } : {}) };
  // No layouts asked for yet: the project opens on its rooms, ready to generate.
  if (options.count === 0) {
    return { ok: true, project: { ...base, id: options.id, name: options.name, ...(options.details ? { details: options.details } : {}), sizing } };
  }
  const result = planLayouts({
    intent: { action: "generate_layouts", brief: normalised, count: options.count ?? 3, footprint: "auto", ...(options.plot ? { plot: options.plot } : {}) },
    source: shell,
    brief: normalised,
    idPrefix: options.idPrefix,
  });
  if (!result.candidates.length) return { ok: false, message: result.issues[0]?.message ?? "No layout fits these rooms." };

  const titles = layoutNames(result.candidates.map((c) => c.document.levels[0]));
  const labels = ["Shell"];
  const plans: PlanVariant[] = result.candidates.map((c, i) => {
    const label = nextPlanLabel(labels);
    labels.push(label);
    return {
      id: `${options.id}-${i + 1}`,
      label,
      parentId: shell.id,
      origin: {
        kind: "generated",
        requestId: options.idPrefix,
        planner: "strip-planner-v1",
        seed: c.seed,
        summary: c.summary,
        notes: c.notes,
        ...(c.arrangement ? { arrangement: c.arrangement } : {}),
        ...(c.variant ? { variant: c.variant } : {}),
        title: titles[i],
        brief: normalised,
        at: options.now,
      },
      scope: { kind: "plan" },
      createdAt: options.now,
      document: { ...c.document, id: `${options.id}-${i + 1}`, name: options.name },
    };
  });
  return {
    ok: true,
    project: {
      ...base,
      id: options.id,
      name: options.name,
      ...(options.details ? { details: options.details } : {}),
      sizing,
      activePlanId: plans[0].id,
      plans: [...base.plans, ...plans],
    },
  };
}
