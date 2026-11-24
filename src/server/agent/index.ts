import Anthropic from "@anthropic-ai/sdk";
import { builtinTools } from "@/domain/agent/tools";
import { createToolRegistry, type ToolRegistry } from "@/domain/agent/registry";
import type { AgentClient, AgentRequestParams, AgentResponse } from "./loop";

/**
 * Server-only wiring of the assistant to Claude. The key never leaves the
 * server. Add tools here (see domain/agent/registry.ts) and the assistant
 * gains them.
 */

/** Claude model the assistant uses; set ANTHROPIC_AGENT_MODEL to change it. */
export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";
export const agentModel = () => process.env.ANTHROPIC_AGENT_MODEL || DEFAULT_AGENT_MODEL;

export const agentRegistry: ToolRegistry = createToolRegistry(builtinTools);

export const agentAvailable = () => !!process.env.ANTHROPIC_API_KEY;

let shared: Anthropic | null = null;

export function anthropicAgentClient(): AgentClient {
  shared ??= new Anthropic({ timeout: 30_000, maxRetries: 1 });
  const claude = shared;
  return {
    async create(params: AgentRequestParams, options) {
      const response = await claude.messages.create(params as unknown as Anthropic.MessageCreateParamsNonStreaming, options);
      return response as unknown as AgentResponse;
    },
  };
}
