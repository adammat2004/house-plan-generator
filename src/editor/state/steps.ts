import type { PlanVariantMeta, Sizing } from "@/domain/project/schema";
import type { DesignView, Workspace } from "./stores";

/**
 * The five steps people see: Map, Requirements, Explore, Refine, Review.
 * They're a view over the session's workspace and design view, not separate
 * state:
 *
 *   workspace + designView        step
 *   site                     →    map            (the plot and the garden side)
 *   brief                    →    requirements   (the rooms)
 *   design + board           →    explore        (the layouts side by side)
 *   design + plan            →    refine         (one plan: as a plan, furnished, or in 3D)
 *   design + variations      →    refine         (comparing one room's options)
 *   review                   →    review         (the chosen design, summed up)
 *
 * How a plan is drawn (2D plan, furnished, 3D) is a separate choice, not a
 * step. goToStep (shell/tools.ts) goes the other way.
 */
export type Step = "map" | "requirements" | "explore" | "refine" | "review";

export const STEPS: ReadonlyArray<{ id: Step; label: string; key: string }> = [
  { id: "map", label: "Map", key: "1" },
  { id: "requirements", label: "Requirements", key: "2" },
  { id: "explore", label: "Explore", key: "3" },
  { id: "refine", label: "Refine", key: "4" },
  { id: "review", label: "Review", key: "5" },
];

export function stepOf(session: { workspace: Workspace; designView: DesignView }): Step {
  switch (session.workspace) {
    case "site":
      return "map";
    case "brief":
      return "requirements";
    case "review":
      return "review";
    case "design":
      return session.designView === "board" ? "explore" : "refine";
  }
}

/**
 * Whether a step has something to show. Refine and Review need a plan: any
 * generated layout, or the user's own house when the project wasn't sized
 * from its rooms (a rooms-first project's starting shell is an empty
 * rectangle).
 */
export function stepAvailable(project: { plans: ReadonlyArray<Pick<PlanVariantMeta, "origin">>; sizing: Sizing | undefined }, step: Step): boolean {
  if (step === "map" || step === "requirements" || step === "explore") return true;
  return project.sizing?.footprint !== "auto" || project.plans.some((p) => p.origin.kind === "generated");
}

/** Why a step can't be opened yet, for its tooltip. */
export const STEP_UNAVAILABLE = "Generate layouts first";
