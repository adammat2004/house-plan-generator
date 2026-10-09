/**
 * In-memory rate limits for the AI routes. The app has no accounts, and every
 * call spends from the project's API keys, so each visitor gets a modest
 * allowance. Per server process: a public deployment with several instances
 * needs shared storage and real authentication instead.
 */
export function createRateLimiter({ windowMs, limit }: { windowMs: number; limit: number }) {
  const recent = new Map<string, number[]>();
  return {
    /** Records a request from the visitor and says whether it is allowed. */
    allow(visitor: string, now = Date.now()): boolean {
      const times = (recent.get(visitor) ?? []).filter((t) => now - t < windowMs);
      if (times.length >= limit) {
        recent.set(visitor, times);
        return false;
      }
      times.push(now);
      recent.set(visitor, times);
      // Forget idle visitors so the map can't grow without bound.
      if (recent.size > 5000) for (const [key, list] of recent) if (!list.some((t) => now - t < windowMs)) recent.delete(key);
      return true;
    },
  };
}

/** Who is asking: the first forwarded address, else "local". */
export const visitorOf = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
