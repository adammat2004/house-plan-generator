import Anthropic from "@anthropic-ai/sdk";
import type { AgentRequest } from "@/domain/agent/request";
import type { ToolRegistry } from "@/domain/agent/registry";
import type { AgentStreamEvent } from "@/domain/agent/types";
import { runAgentTurn, type AgentClient } from "./loop";

const setupHint = (hint: string) => (process.env.NODE_ENV === "production" ? "The AI isn't available right now." : hint);

/** What a failed call to Claude means for the person using the editor. */
export function describeAgentError(error: unknown): { status: number; message: string } {
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) return { status: 504, message: "The assistant took too long to answer." };
  if (error instanceof Anthropic.AuthenticationError) return { status: 503, message: setupHint("The API key was rejected. Check ANTHROPIC_API_KEY in .env.local.") };
  if (error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.NotFoundError) return { status: 503, message: setupHint("This API key can't use the assistant's model. Set ANTHROPIC_AGENT_MODEL to one it can.") };
  if (error instanceof Anthropic.RateLimitError) return { status: 429, message: "The AI is busy (rate limited). Try again in a minute." };
  if (error instanceof Anthropic.APIError) return { status: 502, message: `The AI service had a problem (${error.status ?? "no status"}).` };
  if (error instanceof Error && error.name === "TimeoutError") return { status: 504, message: "The assistant took too long to answer." };
  return { status: 500, message: "The assistant ran into a problem. Nothing was changed." };
}

/** Runs one turn and streams its events as newline-delimited JSON. */
export function agentStream(request: AgentRequest, deps: { client: AgentClient; registry: ToolRegistry; model: string; signal?: AbortSignal; idPrefix: string }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (event: AgentStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser went away; the turn stops at its next model call.
        }
      };
      try {
        const result = await runAgentTurn({
          ...deps,
          document: request.document,
          brief: request.brief,
          selectedRoomId: request.selectedRoomId,
          history: request.history,
          text: request.text,
          onEvent: send,
        });
        send({ type: "result", result });
      } catch (error) {
        const { status, message } = describeAgentError(error);
        if (status === 500) console.error("Assistant turn failed", error);
        send({ type: "error", message, status });
      }
      controller.close();
    },
  });
}
