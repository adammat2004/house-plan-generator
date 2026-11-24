import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ROOM_PICK_SPECS, ROOM_PICKS } from "@/domain/brief/rooms";
import { pictureReplySchema, type PictureReply, type PictureRequest } from "@/domain/design/pictureReading";
import { interpreterAvailable, MODEL, type ClaudeClient } from "./designInterpreter";

/**
 * Server-only: asks Claude to read a picture (a floor plan, inspiration, or
 * a site plan) into the brief's rooms, shape and storeys, in a fixed schema.
 * The planners still do all the geometry.
 */

export type PictureResult = { ok: true; reply: PictureReply; model: string } | { ok: false; status: number; message: string };

const ATTEMPT_MS = 25_000;
const DEADLINE_MS = 40_000;
const setupHint = (hint: string) => (process.env.NODE_ENV === "production" ? "The AI isn't available right now." : hint);

const picks = ROOM_PICKS.map((p) => `- ${p}: ${ROOM_PICK_SPECS[p].label} (${ROOM_PICK_SPECS[p].hint.toLowerCase()}; at most ${ROOM_PICK_SPECS[p].max})`).join("\n");

/** Kept byte-for-byte stable so it caches; the picture and the current rooms go in the user turn. */
const SYSTEM = `You are the design assistant in a home design app for houses of one or two storeys. The user has added a picture. Read it into what the app's brief can hold, and nothing else: the app's own planners lay the house out, so never describe walls, sizes or positions.

The brief lists rooms one by one with these keys:
${picks}

What to do, by the kind of picture:
- floor_plan: count the rooms you can see and give every key a count (0 for none). A bedroom with its own bathroom is the master_bedroom with an ensuite; the largest bedroom is the master. Kitchen, dining and living in one space is open_plan; kitchen with dining but a separate living room is kitchen_dining plus living_room. Say the outline's shape in houseShape (rectangle, L, T or U) and the number of floors you can see in storeys. If the picture is not a floor plan, leave rooms null.
- inspiration: a photo or drawing of a house or interior someone likes. Leave rooms null unless the picture clearly shows the whole house's rooms. Give houseShape and storeys only when the house's form is clear. Put the style and features worth keeping (materials, roof, glazing, the feel of the rooms) in notes, briefly.
- site_plan: a plan of the plot. Leave rooms null. Put what limits the house in notes: the plot's rough size and shape, which way the road and the garden are, where the entrance is, slopes or trees, if you can read them.

Rules:
- A key you can't judge from the picture is null, never a guess. For a floor plan, give all of them.
- storeys is 1 or 2, or null. A third storey or a basement goes in notes.
- notes are short phrases in plain words; at most five.
- reply: one or two short, friendly sentences saying what you see and what the app will change. No lists, no markdown.`;

let shared: Anthropic | null = null;

export async function readPicture(request: PictureRequest, client?: ClaudeClient): Promise<PictureResult> {
  if (!client && !interpreterAvailable()) return { ok: false, status: 503, message: setupHint("Reading pictures needs ANTHROPIC_API_KEY in .env.local.") };
  const claude = client ?? (shared ??= new Anthropic({ timeout: ATTEMPT_MS, maxRetries: 1 }));
  try {
    const response = await claude.beta.messages.parse(
      {
        model: MODEL,
        max_tokens: 16000,
        // A refused request is re-run server-side on the model Anthropic recommends for that case.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        // Counting rooms on a drawing takes some care, but not a long think.
        output_config: { effort: "medium", format: betaZodOutputFormat(pictureReplySchema) },
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: request.mediaType, data: request.image } },
              { type: "text", text: `Kind of picture: ${request.kind}\n\nThe rooms picked now (JSON): ${JSON.stringify(request.rooms)}` },
            ],
          },
        ],
      },
      { signal: AbortSignal.timeout(DEADLINE_MS) },
    );
    if (response.stop_reason === "refusal") return { ok: false, status: 422, message: "That picture was declined. Try another one." };
    if (response.stop_reason === "max_tokens" || !response.parsed_output) return { ok: false, status: 502, message: "The AI's answer was incomplete. Try again." };
    return { ok: true, reply: response.parsed_output, model: response.model };
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) return { ok: false, status: 504, message: "Reading the picture took too long. Try a smaller one." };
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, status: 503, message: setupHint("The API key was rejected. Check ANTHROPIC_API_KEY in .env.local.") };
    if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, status: 503, message: "This API key can't use that model." };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, status: 429, message: "The AI is busy (rate limited). Try again in a minute." };
    if (error instanceof Anthropic.BadRequestError) return { ok: false, status: 502, message: `The picture couldn't be read: ${error.message}` };
    if (error instanceof Anthropic.APIError) return { ok: false, status: 502, message: `The AI service had a problem (${error.status ?? "no status"}).` };
    throw error;
  }
}
