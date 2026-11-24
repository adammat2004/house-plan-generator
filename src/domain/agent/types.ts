import type { z } from "zod";
import type { HouseBrief } from "../brief/schema";
import type { Id, PlanDocument } from "../plan/types";

/**
 * The agent's tools are the only way it changes a plan. Each one runs the
 * domain's validated commands or planners on a copy of the plan, so a bad
 * request comes back as a structured failure the model can read and retry,
 * and nothing the agent does can produce a plan the editor couldn't.
 *
 * Tools never take coordinates from the model: they name rooms by id and say
 * what they want (a side, a size, a goal); the tool works out the geometry.
 */

export interface ToolContext {
  /** The plan as it stands after the tools that already ran this turn. */
  document: PlanDocument;
  brief: HouseBrief;
  /** Unique per tool call; prefix for every id the call creates. */
  idPrefix: string;
}

export type ToolOutcome =
  | {
      ok: true;
      kind: "change";
      document: PlanDocument;
      /** One plain sentence about what changed, with the sizes involved. Shown to the user and to the model. */
      summary: string;
      /** Rooms the change touched, so the editor can show them. */
      roomIds: Id[];
      /** Facts the model needs next (ids of rooms the call created). */
      data?: Record<string, unknown>;
    }
  | { ok: true; kind: "unsupported"; request: string; reason: string }
  | { ok: false; code: string; message: string };

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  /** snake_case; unique in a registry. */
  name: string;
  /** What it does and when to use it, written for the model. */
  description: string;
  input: S;
  run(context: ToolContext, input: z.infer<S>): ToolOutcome;
}

/** A change the agent made, as listed under its reply. */
export interface AgentChange {
  tool: string;
  summary: string;
  roomIds: Id[];
}

export interface AgentFailure {
  tool: string;
  message: string;
}

export interface AgentUnsupported {
  request: string;
  reason: string;
}

/** Progress while a turn runs. */
export type AgentEvent = { type: "thinking" } | { type: "tool"; name: string; ok: boolean; text: string };

export interface AgentTurnResult {
  reply: string;
  document: PlanDocument;
  changes: AgentChange[];
  failures: AgentFailure[];
  unsupported: AgentUnsupported[];
  stopped: "done" | "iteration-cap" | "timeout";
  iterations: number;
  model?: string;
}

/** One line of the server's streamed response: progress, then the result or an error. */
export type AgentStreamEvent = AgentEvent | { type: "result"; result: AgentTurnResult } | { type: "error"; message: string; status: number };
