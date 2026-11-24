import { connection } from "next/server";
import { agentRequestSchema } from "@/domain/agent/request";
import { validateDocument } from "@/domain/commands";
import { agentAvailable, agentModel, agentRegistry, anthropicAgentClient } from "@/server/agent";
import { agentStream } from "@/server/agent/stream";
import { createDailyCap, createRateLimiter, visitorOf } from "@/server/rateLimit";

/**
 * The assistant's link to Claude. GET says whether it's set up; POST runs one
 * turn over the plan in the request and streams progress, then the new plan,
 * as newline-delimited JSON. The server keeps nothing between turns. Each
 * turn makes several model calls, so each visitor gets fewer than the
 * one-shot interpreter allows, and CLAUDE_DAILY_LIMIT counts turns too.
 */

/** The loop stops at 50 s (server/agent/loop.ts), inside this. */
export const maxDuration = 60;

const MAX_BODY_BYTES = 3_000_000;
const limiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 20 });
const daily = createDailyCap(() => Number(process.env.CLAUDE_DAILY_LIMIT ?? 0));

export async function GET() {
  await connection();
  return Response.json({ available: agentAvailable(), model: agentAvailable() ? agentModel() : null });
}

export async function POST(request: Request) {
  if (!agentAvailable()) return Response.json({ error: "The assistant isn't set up on this server." }, { status: 503 });
  if (!limiter.allow(visitorOf(request))) return Response.json({ error: "Too many assistant requests. Try again in a few minutes." }, { status: 429 });
  if (daily.full()) return Response.json({ error: "Today's AI requests have all been used. Try again tomorrow." }, { status: 429 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "That plan is too large to send." }, { status: 413 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = agentRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "That request isn't in the expected shape." }, { status: 400 });
  if (validateDocument(parsed.data.document).length) return Response.json({ error: "That plan isn't valid." }, { status: 400 });
  daily.record();
  const stream = agentStream(parsed.data, { client: anthropicAgentClient(), registry: agentRegistry, model: agentModel(), signal: request.signal, idPrefix: `ag${Date.now().toString(36)}` });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
