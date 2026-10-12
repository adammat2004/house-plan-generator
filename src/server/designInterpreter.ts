import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PREFERENCE_LABEL, PREFERENCE_IDS } from "@/domain/brief/schema";
import { aiReplySchema, type AiReply, type AiRequest } from "@/domain/design/aiInterpretation";
import { ROOM_GOAL_LABEL, ROOM_GOALS, SUPPORTED_ROOM_GOALS } from "@/domain/design/intent";

/**
 * Server-only: asks Claude to read the user's words into structured intent.
 * The API key never leaves the server. Claude sees a summary of the plan
 * (names, uses, areas, which rooms connect) and replies in a fixed schema;
 * the planners do every bit of geometry.
 */

export const MODEL = "claude-opus-5";

export type InterpretResult =
  | { ok: true; reply: AiReply; model: string }
  | { ok: false; status: number; message: string };

/** The part of the SDK interpret() uses; tests pass a stand-in. */
export type ClaudeClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "parse"> } };

/**
 * Each attempt may take 20 s and a failed one is tried once more, but the
 * whole call stops at 28 s, inside the route's 30 s maxDuration. The editor
 * gives up at 25 s and lets the built-in reader answer.
 */
const ATTEMPT_MS = 20_000;
const DEADLINE_MS = 28_000;
const TOO_SLOW = "Claude took too long to answer.";
/** Setup problems name the key to fix outside production; the editor quietly uses its built-in reader either way. */
const setupHint = (hint: string) => (process.env.NODE_ENV === "production" ? "The AI isn't available right now." : hint);

const goals = ROOM_GOALS.map((g) => `- ${g}: ${ROOM_GOAL_LABEL[g]}${SUPPORTED_ROOM_GOALS.has(g) ? "" : " (recorded, but the planner can't do this yet)"}`).join("\n");
const preferences = PREFERENCE_IDS.map((p) => `- ${p}: ${PREFERENCE_LABEL[p]}`).join("\n");

/** Kept byte-for-byte stable so it caches; everything that varies goes in the user turn. */
const SYSTEM = `You are the design assistant in a floor-plan editor for homes of one or two storeys. You read what the user writes and turn it into structured changes that the editor's own planners carry out. You never describe geometry or coordinates; the planners decide where walls, doors and furniture go.

There are two kinds of change.

1. Room changes, for an existing room in the plan. Use the room's id exactly as given in the plan summary. Goals:
${goals}

2. Brief changes, for what the house as a whole needs (a new layout is generated from the brief):
- bedrooms, bathrooms: the total wanted, or null to leave unchanged
- spaces (addSpaces / removeSpaces): kitchen, living, dining, office, utility, garage
- preferences (addPreferences / removePreferences):
${preferences}
- roomSizes: living, kitchen or bedrooms as compact, standard or generous
- houseShape: L, T or U for a house of that shape (a courtyard house is a U), rectangle for a simple box, any to let the planner choose, or null to leave unchanged. It shapes houses sized from the rooms; a house the user drew keeps its shape.
- storeys: 2 for a two-storey house with the bedrooms upstairs, 1 for a single-storey house (a bungalow), or null to leave unchanged. A two-storey house can be any shape: in an L, T or U house the floor above covers the main part and the wings stay single-storey. A house of three or more storeys can't be planned yet: put those words in unclear.

How to decide:
- Asking for a room the plan doesn't have (a utility room, an office, another bedroom) is a brief change, because adding a room needs a new layout.
- Asking to change a room that exists (bigger, brighter, an island, storage, an ensuite, garden doors) is a room change for that room.
- When the user doesn't name a room, use the selected room if there is one; otherwise pick the room the words clearly refer to. If you can't tell which room is meant, put the words in unclear rather than guessing.
- Only include what the user asked for. Leave everything else empty or null.
- Anything that neither kind of change can express (colours, budgets, a third storey, specific products) goes in unclear, quoted briefly in the user's words.
- In a house of several floors, each room in the plan summary says which floor it is on.
- When the mode is "instructions", the text is free-form notes from the brief, written before any layout exists: express them only as brief changes, and leave roomChanges empty.

reply: one or two short, friendly sentences saying what you understood and what will happen next. Plain language, no lists, no markdown. Don't promise anything the changes above don't do.`;

let shared: Anthropic | null = null;

export function interpreterAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function userTurn(request: AiRequest): string {
  const { context } = request;
  const selected = context.rooms.find((r) => r.id === context.selectedRoomId);
  const summary = {
    rooms: context.rooms,
    selectedRoom: selected ? { id: selected.id, name: selected.name } : null,
    brief: {
      bedrooms: context.brief.bedrooms,
      bathrooms: context.brief.bathrooms,
      spaces: context.brief.requiredSpaces,
      preferences: context.brief.preferences,
      roomSizes: context.brief.roomSizes ?? {},
      storeys: context.brief.storeys ?? 1,
      houseShape: context.brief.houseShape ?? "rectangle",
    },
  };
  return `Mode: ${request.mode}\n\nPlan summary (JSON):\n${JSON.stringify(summary)}\n\nThe user wrote:\n<user_text>\n${request.text}\n</user_text>`;
}

export async function interpret(request: AiRequest, client?: ClaudeClient): Promise<InterpretResult> {
  if (!client && !interpreterAvailable()) return { ok: false, status: 503, message: setupHint("The AI layer isn't set up: add ANTHROPIC_API_KEY to .env.local.") };
  const claude = client ?? (shared ??= new Anthropic({ timeout: ATTEMPT_MS, maxRetries: 1 }));
  try {
    const response = await claude.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // A refused request is re-run server-side on the model Anthropic recommends for that case.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      // Reading a short request into a fixed schema needs little deliberation; low keeps replies quick.
      output_config: { effort: "low", format: betaZodOutputFormat(aiReplySchema) },
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      messages: [{ role: "user", content: userTurn(request) }],
    }, { signal: AbortSignal.timeout(DEADLINE_MS) });
    if (response.stop_reason === "refusal") {
      return { ok: false, status: 422, message: "That request was declined. Try rephrasing it as a change to a room or to the brief." };
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return { ok: false, status: 502, message: "The AI's answer was incomplete. Try again." };
    }
    return { ok: true, reply: response.parsed_output, model: response.model };
  } catch (error) {
    // Before APIError, which both extend. An abort is the deadline above.
    if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) return { ok: false, status: 504, message: TOO_SLOW };
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, status: 503, message: setupHint("The API key was rejected. Check ANTHROPIC_API_KEY in .env.local.") };
    if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, status: 503, message: "This API key can't use that model." };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, status: 429, message: "The AI is busy (rate limited). Try again in a minute." };
    if (error instanceof Anthropic.BadRequestError) return { ok: false, status: 502, message: `The AI request was rejected: ${error.message}` };
    if (error instanceof Anthropic.APIError) return { ok: false, status: 502, message: `The AI service had a problem (${error.status ?? "no status"}).` };
    throw error;
  }
}
