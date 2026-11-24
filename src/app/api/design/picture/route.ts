import { pictureRequestSchema } from "@/domain/design/pictureReading";
import { readPicture } from "@/server/pictureReader";
import { createDailyCap, createRateLimiter, visitorOf } from "@/server/rateLimit";

/**
 * Reads a picture someone added (a floor plan, inspiration, or their site
 * plan) into the brief. Each call spends from the project's API key, so
 * visitors get a few at a time and CLAUDE_DAILY_LIMIT caps the server per day.
 */

/** Claude's call stops at 40 s, so the route answers before this. */
export const maxDuration = 45;

const limiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 10 });
const daily = createDailyCap(() => Number(process.env.CLAUDE_DAILY_LIMIT ?? 0));

export async function POST(request: Request) {
  if (!limiter.allow(visitorOf(request))) return Response.json({ error: "Too many pictures at once. Try again in a few minutes." }, { status: 429 });
  if (daily.full()) return Response.json({ error: "Today's AI requests have all been used. Try again tomorrow." }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = pictureRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "That picture isn't in the expected shape, or it's too large." }, { status: 400 });
  const result = await readPicture(parsed.data);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  daily.record();
  return Response.json({ reply: result.reply, model: result.model });
}
