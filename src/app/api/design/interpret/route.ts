import { connection } from "next/server";
import { aiRequestSchema } from "@/domain/design/aiInterpretation";
import { interpret, interpreterAvailable } from "@/server/designInterpreter";
import { createDailyCap, createRateLimiter, visitorOf } from "@/server/rateLimit";

/**
 * The AI Designer's link to Claude. GET says whether it's set up; POST reads
 * a request or the brief's notes into structured changes. Each visitor gets
 * a modest number of requests, since the app has no accounts and every call
 * spends from the project's API key, and an optional CLAUDE_DAILY_LIMIT caps
 * the whole server per day.
 */

/** Claude's call stops at 28 s, so the route answers before this. */
export const maxDuration = 30;

const limiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 30 });
const daily = createDailyCap(() => Number(process.env.CLAUDE_DAILY_LIMIT ?? 0));

export async function GET() {
  await connection();
  return Response.json({ available: interpreterAvailable() });
}

export async function POST(request: Request) {
  if (!limiter.allow(visitorOf(request))) return Response.json({ error: "Too many AI requests. Try again in a few minutes." }, { status: 429 });
  if (daily.full()) return Response.json({ error: "Today's AI requests have all been used. Try again tomorrow." }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = aiRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "That request isn't in the expected shape." }, { status: 400 });
  const result = await interpret(parsed.data);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  daily.record();
  return Response.json({ reply: result.reply, model: result.model });
}
