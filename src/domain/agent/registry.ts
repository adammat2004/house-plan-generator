import { z } from "zod";
import type { AgentTool } from "./types";

/**
 * The extension point for the assistant. A tool is a name, a description for
 * the model, a zod input schema and a `run` that returns a new plan or a
 * structured failure (see types.ts). To teach the assistant something new,
 * such as exterior finishes or interior furnishing, write its tools in their
 * own module and add them where the registry is built:
 *
 *   createToolRegistry([...builtinTools, ...exteriorTools])
 *
 * The loop, the route and the chat panel need no change: they list whatever
 * the registry holds, show each successful call's `summary` as a change, and
 * report each failure to the model.
 */
export interface ToolRegistry {
  get(name: string): AgentTool | undefined;
  list(): AgentTool[];
  /** The tools as the Messages API takes them. */
  definitions(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}

export function createToolRegistry(tools: AgentTool[]): ToolRegistry {
  const byName = new Map<string, AgentTool>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Two agent tools are called ${tool.name}.`);
    byName.set(tool.name, tool);
  }
  return {
    get: (name) => byName.get(name),
    list: () => [...byName.values()],
    definitions: () =>
      [...byName.values()].map((tool) => {
        const schema = z.toJSONSchema(tool.input) as Record<string, unknown>;
        delete schema.$schema;
        return { name: tool.name, description: tool.description, input_schema: schema };
      }),
  };
}
