import type { HouseBrief } from "@/domain/brief/schema";
import { pinnedMessage, pinnedRoomChanges } from "@/domain/commands";
import type { ToolRegistry } from "@/domain/agent/registry";
import { planSummary } from "@/domain/agent/summary";
import type { AgentChange, AgentEvent, AgentFailure, AgentTurnResult, AgentUnsupported } from "@/domain/agent/types";
import type { Id, PlanDocument } from "@/domain/plan/types";

/**
 * The assistant's turn: a tool-use loop over the domain's tools. The model
 * sees a compact summary of the plan and the conversation so far, calls tools
 * to change a private copy of the plan, and reads each result (a summary or a
 * structured failure) before deciding what next. The loop is stateless: the
 * browser sends the plan and the chat each turn, and gets the new plan back.
 */

export interface AgentContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
export interface AgentResponse {
  stop_reason: string | null;
  content: AgentContentBlock[];
  model?: string;
}
export type AgentMessage = { role: "user" | "assistant"; content: string | unknown[] };
export interface AgentRequestParams {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  messages: AgentMessage[];
}
/** The part of the SDK the loop uses; tests pass a stand-in. */
export interface AgentClient {
  create(params: AgentRequestParams, options?: { signal?: AbortSignal }): Promise<AgentResponse>;
}

export const MAX_ITERATIONS = 8;
export const DEADLINE_MS = 50_000;

export const SYSTEM = `You are the design assistant in a house floor-plan editor, like a pair-designer sitting next to the user. The user types what they want ("make the kitchen bigger", "add a downstairs toilet", "swap bedroom 2 and the study") and you change the plan for them with your tools.

How you work:
- Each turn starts with a JSON summary of the plan: floors, rooms with ids, uses, sizes and openings. Use room and opening ids exactly as given. Never invent ids, and never describe or ask for coordinates: the tools work out the geometry.
- Make the change with tools, then say what you did. You may call several tools in a turn. After a tool succeeds its result tells you the new sizes; you don't need to re-read the plan.
- If a tool fails, read its message. Retry with a different corner, side, size or tool when that could work. If it can't work, tell the user why in plain words.
- Be honest. If part of a request can't be done with your tools (colours, materials, furniture, roofs, exact positions, a stair design), call report_unsupported for that part, or say so. Never claim a change you didn't make, and don't say "done" about something a tool refused.
- If the request is ambiguous in a way that matters (two rooms could be meant), ask one short question and change nothing yet.
- If the user is only asking a question, answer it from the summary without changing anything.
- The plan's north is the top of the screen. "Downstairs" means the ground floor.

Your final message is shown to the user beside a list of exactly the changes your tools made. Keep it to one to three short, friendly sentences in plain language: what you changed and anything you couldn't do. No markdown, no lists, no ids.`;

export type { AgentEvent, AgentTurnResult };

export interface AgentTurnInput {
  client: AgentClient;
  model: string;
  registry: ToolRegistry;
  document: PlanDocument;
  brief: HouseBrief;
  selectedRoomId?: Id | null;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  text: string;
  maxIterations?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  /** Unique per turn; seeds the ids tools create. */
  idPrefix: string;
}

const textOf = (blocks: AgentContentBlock[]) =>
  blocks
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!.trim())
    .join("\n")
    .trim();

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const { client, model, registry, brief, text, onEvent } = input;
  const maxIterations = input.maxIterations ?? MAX_ITERATIONS;
  const deadline = Date.now() + (input.deadlineMs ?? DEADLINE_MS);
  const tools = registry.definitions();
  const changes: AgentChange[] = [];
  const failures: AgentFailure[] = [];
  const unsupported: AgentUnsupported[] = [];
  let document = input.document;
  let calls = 0;
  let usedModel: string | undefined;

  const messages: AgentMessage[] = [
    ...(input.history ?? []).map((m): AgentMessage => ({ role: m.role, content: m.text })),
    { role: "user", content: `Plan summary (JSON):\n${JSON.stringify(planSummary(document, brief, input.selectedRoomId ?? null))}\n\nThe user wrote:\n<user_text>\n${text}\n</user_text>` },
  ];

  const finish = (reply: string, stopped: AgentTurnResult["stopped"], iterations: number): AgentTurnResult => ({
    reply,
    document,
    changes,
    failures,
    unsupported,
    stopped,
    iterations,
    model: usedModel,
  });

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return finish(stoppedReply("I ran out of time", changes), "timeout", iteration - 1);
    onEvent?.({ type: "thinking" });
    const signals = [AbortSignal.timeout(remaining), ...(input.signal ? [input.signal] : [])];
    const response = await client.create(
      { model, max_tokens: 2048, system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }], tools, messages },
      { signal: AbortSignal.any(signals) },
    );
    usedModel = response.model ?? usedModel;
    const uses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !uses.length) {
      const reply = textOf(response.content);
      if (response.stop_reason === "max_tokens" || !reply) return finish(stoppedReply("My answer got cut off", changes), "done", iteration);
      return finish(reply, "done", iteration);
    }

    const results: unknown[] = [];
    for (const use of uses) {
      const name = use.name ?? "";
      const tool = registry.get(name);
      let content: string;
      let isError = false;
      if (!tool) {
        content = `There is no tool called "${name}". Tools: ${registry.list().map((t) => t.name).join(", ")}.`;
        isError = true;
        failures.push({ tool: name, message: content });
        onEvent?.({ type: "tool", name, ok: false, text: content });
      } else {
        const parsed = tool.input.safeParse(use.input);
        if (!parsed.success) {
          content = `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`;
          isError = true;
          failures.push({ tool: name, message: content });
          onEvent?.({ type: "tool", name, ok: false, text: content });
        } else {
          const outcome = tool.run({ document, brief, idPrefix: `${input.idPrefix}${++calls}-` }, parsed.data);
          if (!outcome.ok) {
            content = `${outcome.message} [${outcome.code}]`;
            isError = true;
            failures.push({ tool: name, message: outcome.message });
            onEvent?.({ type: "tool", name, ok: false, text: outcome.message });
          } else if (outcome.kind === "unsupported") {
            unsupported.push({ request: outcome.request, reason: outcome.reason });
            content = "Recorded. Tell the user about it in your reply.";
            onEvent?.({ type: "tool", name, ok: true, text: `Can't do: ${outcome.request}` });
          } else if (pinnedBreak(input.document, outcome.document)) {
            content = `${pinnedBreak(input.document, outcome.document)} The change was not made.`;
            isError = true;
            failures.push({ tool: name, message: content });
            onEvent?.({ type: "tool", name, ok: false, text: content });
          } else {
            document = outcome.document;
            changes.push({ tool: name, summary: outcome.summary, roomIds: outcome.roomIds });
            content = JSON.stringify({ done: outcome.summary, ...(outcome.data ?? {}) });
            onEvent?.({ type: "tool", name, ok: true, text: outcome.summary });
          }
        }
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: results });
  }
  return finish(stoppedReply("I stopped after several steps without finishing", changes), "iteration-cap", maxIterations);
}

/** A message when the change would alter a pinned room, as applying a planner option is refused. */
function pinnedBreak(before: PlanDocument, after: PlanDocument): string | null {
  for (const level of before.levels) {
    const next = after.levels.find((l) => l.id === level.id);
    const [pinned] = next && next !== level ? pinnedRoomChanges(level, next, { furniture: true }) : [];
    if (pinned) return pinnedMessage(pinned.name);
  }
  return null;
}

function stoppedReply(why: string, changes: AgentChange[]): string {
  return changes.length
    ? `${why}. What I changed is listed below; ask me again for the rest.`
    : `${why}, so I haven't changed anything. Try asking for one thing at a time.`;
}
