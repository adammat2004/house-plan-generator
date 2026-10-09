import type { HouseBrief } from "../brief/schema";
import type { PlanDocument } from "../plan/types";
import type { Footprint } from "./footprint";
import type { DesignIntent, RoomGoal } from "./intent";

/**
 * The boundary between intent and geometry. A planner receives a structured
 * intent and the plan it applies to, and returns complete, validated plan
 * documents. It never mutates its inputs and must be deterministic for a
 * given request, so results can be reproduced and debugged.
 */
export interface PlanningRequest {
  intent: DesignIntent;
  /** The plan the request starts from (its envelope, rear wall, …). */
  source: PlanDocument;
  /** The project's brief, for intents that act on part of a plan. */
  brief: HouseBrief;
  /** Prefix for every id the planner creates (documents, walls, rooms, openings). */
  idPrefix: string;
  /** The brief's free-text notes have already been read into its structured fields. */
  instructionsRead?: boolean;
}

export interface PlanCandidate {
  document: PlanDocument;
  /** One line describing the idea behind this layout. */
  summary: string;
  /** Compromises made to satisfy the brief, e.g. rooms merged to fit. */
  notes: string[];
  /** Index of the candidate within its request; with the request, reproduces the result. */
  seed: number;
  /** Which arrangement of the planner produced a whole-plan layout, for "generate similar". */
  arrangement?: string;
  /** For layouts whose house size was chosen from the rooms: the outside size and its shape. */
  footprint?: Footprint;
  /** Room changes: a short name for the option, the goal it pursues, and a key that identifies it across requests. */
  title?: string;
  goal?: RoomGoal;
  variant?: string;
  /** For partial redesigns: the rooms the candidate changed. Absent for whole-plan layouts. */
  changedRoomIds?: string[];
}

export interface PlanningIssue {
  code: "unsupported-intent" | "does-not-fit" | "invalid-source" | "room-pinned";
  message: string;
  /** The user's own house is too small for the brief; sizing houses from the rooms would work. */
  tooSmall?: boolean;
}

export interface PlanningResult {
  candidates: PlanCandidate[];
  issues: PlanningIssue[];
}

export interface LayoutPlanner {
  /** Stable identifier recorded on every plan it generates. */
  readonly id: string;
  plan(request: PlanningRequest): Promise<PlanningResult>;
}
