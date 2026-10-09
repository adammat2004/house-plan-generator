import { afterEach, describe, expect, it, vi } from "vitest";
import { createDailyCap, createRateLimiter, visitorOf } from "@/server/rateLimit";

const request = (headers: Record<string, string>) => new Request("http://x/api/design/interpret", { method: "POST", headers });

describe("the per-visitor rate limit", () => {
  it("allows a number of requests per window, then frees them as the window slides", () => {
    const limiter = createRateLimiter({ windowMs: 1000, limit: 2 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 400)).toBe(true);
    expect(limiter.allow("a", 900)).toBe(false);
    // Another visitor has their own allowance.
    expect(limiter.allow("b", 900)).toBe(true);
    // The first request has left the window; the refused one never counted.
    expect(limiter.allow("a", 1000)).toBe(true);
    expect(limiter.allow("a", 1100)).toBe(false);
    expect(limiter.allow("a", 1400)).toBe(true);
  });

  it("forgets idle visitors once it remembers many", () => {
    const limiter = createRateLimiter({ windowMs: 1000, limit: 1 });
    for (let i = 0; i < 5000; i++) limiter.allow(`old-${i}`, 0);
    expect(limiter.size).toBe(5000);
    limiter.allow("new", 5000);
    expect(limiter.size).toBe(1);
    expect(limiter.allow("new", 5001)).toBe(false);
  });
});

describe("who is asking", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes the address the nearest trusted proxy appended", () => {
    const forwarded = request({ "x-forwarded-for": "6.6.6.6, 1.1.1.1, 2.2.2.2", "x-real-ip": "9.9.9.9" });
    expect(visitorOf(forwarded, 1)).toBe("2.2.2.2");
    expect(visitorOf(forwarded, 2)).toBe("1.1.1.1");
    // No proxies trusted: x-forwarded-for is ignored.
    expect(visitorOf(forwarded, 0)).toBe("9.9.9.9");
    expect(visitorOf(request({ "x-forwarded-for": "1.1.1.1" }), 0)).toBe("local");
    // More proxies than entries: the leftmost; no header at all: x-real-ip, else local.
    expect(visitorOf(request({ "x-forwarded-for": "1.1.1.1" }), 2)).toBe("1.1.1.1");
    expect(visitorOf(request({ "x-real-ip": "9.9.9.9" }), 1)).toBe("9.9.9.9");
    expect(visitorOf(request({}), 1)).toBe("local");
  });

  it("can't be changed by addresses a client writes at the left", () => {
    const real = visitorOf(request({ "x-forwarded-for": "1.1.1.1" }), 1);
    for (const fake of ["10.0.0.1", "10.0.0.2, 10.0.0.3", "not an address"]) {
      expect(visitorOf(request({ "x-forwarded-for": `${fake}, 1.1.1.1` }), 1)).toBe(real);
      expect(visitorOf(request({ "x-forwarded-for": `${fake}, 1.1.1.1, 2.2.2.2` }), 2)).toBe(real);
    }
  });

  it("reads the number of proxies from TRUSTED_PROXY_HOPS, one by default", () => {
    const forwarded = request({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "9.9.9.9" });
    expect(visitorOf(forwarded)).toBe("2.2.2.2");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(visitorOf(forwarded)).toBe("1.1.1.1");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    expect(visitorOf(forwarded)).toBe("9.9.9.9");
  });
});

describe("the daily cap", () => {
  const day = (d: number, hour = 12) => new Date(Date.UTC(2026, 9, d, hour));

  it("counts only what's recorded, and starts again each day", () => {
    const cap = createDailyCap(2);
    expect(cap.full(day(9))).toBe(false);
    // Checking alone (a call that then fails) uses nothing.
    expect(cap.full(day(9))).toBe(false);
    cap.record(day(9));
    expect(cap.full(day(9))).toBe(false);
    cap.record(day(9, 23));
    expect(cap.full(day(9, 23))).toBe(true);
    expect(cap.full(day(10, 0))).toBe(false);
  });

  it("reads its limit on every check, and 0 means no cap", () => {
    let limit = 0;
    const cap = createDailyCap(() => limit);
    for (let i = 0; i < 50; i++) cap.record(day(9));
    expect(cap.full(day(9))).toBe(false);
    limit = 50;
    expect(cap.full(day(9))).toBe(true);
  });
});
