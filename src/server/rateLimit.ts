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
    /** How many visitors are remembered. */
    get size() {
      return recent.size;
    },
  };
}

/**
 * A cap on a route's paid calls per day (UTC), for the whole server process.
 * Only calls that succeeded count, so failures don't use up the day; calls
 * already running when the cap is reached still finish. A limit of 0 (or
 * none) means no cap. The limit is read on every check, so it can come from
 * the environment.
 *
 * Per process: each instance of a deployment keeps its own count, so this is
 * a brake, not a ceiling. The real ceiling is the spend limit set with the
 * provider (an Anthropic workspace limit, a Google Cloud budget or quota).
 */
export function createDailyCap(limit: number | (() => number)) {
  let day = "";
  let count = 0;
  const roll = (now: Date) => {
    const today = now.toISOString().slice(0, 10);
    if (today !== day) [day, count] = [today, 0];
  };
  return {
    /** Whether today's calls have all been used. */
    full(now = new Date()): boolean {
      roll(now);
      const max = typeof limit === "function" ? limit() : limit;
      return max > 0 && count >= max;
    },
    /** Counts one successful call. */
    record(now = new Date()): void {
      roll(now);
      count++;
    },
  };
}

/**
 * Who is asking. Each proxy in front of the app appends the address it was
 * reached from to x-forwarded-for, so only the right-hand end of the list can
 * be trusted: a client can write anything at the left. With `hops` trusted
 * proxies (TRUSTED_PROXY_HOPS, default 1 when unset or empty: a single load
 * balancer or platform edge), the visitor is the address `hops` entries from
 * the right. With 0, x-forwarded-for is ignored and x-real-ip is used, for a
 * proxy that sets that header instead. Neither header means "local".
 *
 * Without any proxy the visitor can't be told apart reliably: Next.js only
 * fills in x-forwarded-for when the client didn't send one.
 */
export function visitorOf(request: Request, hops = Number(process.env.TRUSTED_PROXY_HOPS || 1)): string {
  const realIp = request.headers.get("x-real-ip")?.trim() || "local";
  const trusted = Math.floor(hops);
  if (!(trusted >= 1)) return realIp;
  const forwarded = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  // Fewer entries than proxies means an outer one was skipped; the leftmost is the best guess.
  return forwarded[Math.max(0, forwarded.length - trusted)] ?? realIp;
}
