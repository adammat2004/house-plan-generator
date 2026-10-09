import { connection } from "next/server";
import { MAX_IMAGE_BYTES, renderRequestSchema } from "@/domain/design/renderRequest";
import { IMAGE_MODEL, imageRendererAvailable, renderPhoto } from "@/server/imageRenderer";
import { createRateLimiter, visitorOf } from "@/server/rateLimit";

/**
 * Photo renders: GET says whether Gemini is set up; POST takes a 3D render
 * of a room with structured facts about it and returns a realistic photo.
 * Each image is a paid call, so visitors get a small allowance, and an
 * optional GEMINI_DAILY_LIMIT caps the whole server per day.
 */

export const maxDuration = 60;

const limiter = createRateLimiter({ windowMs: 10 * 60 * 1000, limit: 20 });
const daily = { day: "", count: 0 };
const MAX_BODY = 2_000_000;

export async function GET() {
  await connection();
  return Response.json({ available: imageRendererAvailable(), model: IMAGE_MODEL });
}

const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return error("That image is too large.", 413);
  if (!limiter.allow(visitorOf(request))) return error("Too many photo renders. Try again in a few minutes.", 429);
  const cap = Number(process.env.GEMINI_DAILY_LIMIT ?? 0);
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) Object.assign(daily, { day: today, count: 0 });
  if (cap > 0 && daily.count >= cap) return error("Today's photo renders have all been used. Try again tomorrow.", 429);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return error("That image is too large.", 413);
    body = JSON.parse(text);
  } catch {
    return error("Send JSON.", 400);
  }
  const parsed = renderRequestSchema.safeParse(body);
  if (!parsed.success) return error("That request isn't in the expected shape.", 400);
  const bytes = Buffer.from(parsed.data.image, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) return error("That image is too large.", 413);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return error("Send the render as a JPEG.", 400);

  daily.count++;
  const result = await renderPhoto(parsed.data);
  if (!result.ok) return error(result.message, result.status);
  return Response.json({ image: result.image, mimeType: result.mimeType, model: result.model });
}
