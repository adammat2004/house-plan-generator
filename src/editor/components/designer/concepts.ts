import { useMemo } from "react";
import { useStore } from "zustand";
import { assessHouse, briefFit, PLAN_FEATURE_LABEL, type PlanAssessment } from "@/domain/design/analysis";
import { assessHouseSense, type HouseSense } from "@/domain/design/houseSense";
import { arrangementTitle } from "@/domain/design/stripPlanner";
import type { Level, PlanDocument } from "@/domain/plan/types";
import type { PlanVariantMeta } from "@/domain/project/schema";
import { editor, editorStores, useProjectState } from "../../state/editor";

export interface PlanEntry {
  meta: PlanVariantMeta;
  /** The whole house, and its ground floor. */
  plan: PlanDocument;
  level: Level;
}

export interface Concept extends PlanEntry {
  /** "A", "B", … from the plan's label, or its position; empty for the user's own house. */
  letter: string;
  /** Changed since it was generated (so it no longer belongs to its set's comparison). */
  edited: boolean;
  title: string;
  description: string;
  assessment: PlanAssessment;
  /** Whether the plan makes sense: things to check, and a score. */
  sense: HouseSense;
}

const AUTO_LABEL = /^Plan ([A-Z]+)$/;

/** "B · Long and narrow", or the title alone for the user's own house. */
export const conceptName = (c: Concept) => (c.letter ? `${c.letter} · ${c.title}` : c.title);

/** A name for a concept: the user's own label, else why to pick it, else the idea behind it. */
function titleOf(meta: PlanVariantMeta, a: PlanAssessment): string {
  if (!AUTO_LABEL.test(meta.label)) return meta.label;
  if (meta.origin.kind === "generated" && meta.origin.title) return meta.origin.title;
  if (meta.origin.kind === "generated" && meta.scope.kind === "rooms" && meta.origin.summary) return meta.origin.summary.replace(/\.$/, "");
  const arrangement = meta.origin.kind === "generated" ? meta.origin.arrangement : undefined;
  const title = arrangement ? arrangementTitle(arrangement) : null;
  if (title) return title;
  const lead = a.features.find((f) => f === "open_plan" || f === "separate_living" || f === "kitchen_diner");
  return lead ? PLAN_FEATURE_LABEL[lead] : "Variation";
}

function describe(meta: PlanVariantMeta, plans: PlanVariantMeta[]): string {
  if (meta.origin.kind === "generated") return meta.origin.summary ?? "Generated from your brief.";
  const parent = plans.find((p) => p.id === meta.parentId);
  return parent ? `Your copy of ${parent.label}, to change as you like.` : "Your own plan.";
}

/**
 * The project's plans as the concept board sees them: the user's starting
 * plans, and the concepts derived from them with a recommendation that
 * weighs both the brief and whether the plan makes sense.
 */
export function useConcepts(): { shells: PlanEntry[]; concepts: Concept[]; recommendedId: string | null } {
  const plans = useProjectState((s) => s.plans);
  const sizing = useProjectState((s) => s.sizing);
  const parked = useProjectState((s) => s.parked);
  const activePlanId = useProjectState((s) => s.activePlanId);
  const brief = useProjectState((s) => s.brief);
  const active = useStore(editorStores.documents, (s) => s.history.present);
  return useMemo(() => {
    const planOf = (id: string) => (id === activePlanId ? active : parked[id]?.present);
    const shells: PlanEntry[] = [];
    const concepts: Concept[] = [];
    for (const meta of plans) {
      const plan = planOf(meta.id);
      if (!plan) continue;
      const level = plan.levels[0];
      const shell = meta.parentId === null && meta.origin.kind === "user";
      if (shell) {
        shells.push({ meta, plan, level });
        // A rooms-first project's shell is an empty placeholder; a drawn house is a real plan to show.
        if (sizing?.footprint === "auto") continue;
      }
      const assessment = assessHouse(plan);
      const letter = shell ? "" : (AUTO_LABEL.exec(meta.label)?.[1] ?? String.fromCharCode(65 + (concepts.length % 26)));
      const edited = meta.origin.kind === "generated" && editor.planEdited(meta.id);
      concepts.push({ meta, plan, level, letter, edited, title: titleOf(meta, assessment), description: describe(meta, plans), assessment, sense: assessHouseSense(plan) });
    }
    let recommendedId: string | null = null;
    const choices = concepts.filter((c) => c.meta.origin.kind === "generated");
    if (choices.length > 1) {
      let best = -Infinity;
      for (const c of choices) {
        // How well it answers the brief, and how much sense it makes (a 0–100 score worth up to 4 brief points).
        const score = briefFit(c.assessment, brief) + c.sense.score / 25;
        if (score > best + 1e-9) [best, recommendedId] = [score, c.meta.id];
      }
    }
    return { shells, concepts, recommendedId };
  }, [plans, sizing, parked, activePlanId, active, brief]);
}
