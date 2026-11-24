import { connection } from "next/server";
import { promptRequestSchema } from "@/domain/brief/fromPrompt";
import { interpretBrief } from "@/server/briefInterpreter";
import { interpreterAvailable } from "@/server/designInterpreter";
import { createDailyCap, createRateLimiter, visitorOf } from "@/server/rateLimit";

/**
 * "Describe your dream home": GET says whether Claude is set up; POST reads
 * a description into a house brief. Limited like the other AI routes.
 */

export const maxDuration = 30;

const limiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 20 });
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
  const parsed = promptRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Describe your home in a sentence or two (up to 1,000 characters)." }, { status: 400 });
  const result = await interpretBrief(parsed.data.text);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  daily.record();
  return Response.json({ brief: result.brief, reply: result.reply, notes: result.notes, model: result.model });
}
