import { describe, it, expect } from "vitest";
import { isQuotaExhaustedError, quotaWindowFor, calendarResetMs, QUOTA_SCOPES } from "../../open-sse/services/quotaWindow.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

// Real Agnes AI 429 body (2026-11-06):
// "You have used up today's text quota and are now limited to 1 request every
// 3 minutes. Try again after 10:29:15. (request id: ...)"
const AGNES_429 = JSON.stringify({
  error: {
    message: "You have used up today's text quota and are now limited to 1 request every 3 minutes. Try again after 10:29:15. (request id: 20261106102716887397250vS7PBaUI)",
    type: "AgnesAI_error",
    param: "",
    code: "rate_limit_exceeded",
  },
});

const AGNES_BODY = `[429]: ${AGNES_429}`;

describe("Agnes AI daily quota", () => {
  it("classifies as quota exhaustion, not a burst rate limit", () => {
    // Before this fix the signal 'used up today' was not in QUOTA_EXHAUSTED_SIGNALS,
    // so Agnes 429 came back as a 2-second backoff and was retried immediately.
    expect(isQuotaExhaustedError(AGNES_BODY)).toBe(true);
  });

  it("checkFallbackError parks the account, not backs off", () => {
    const res = checkFallbackError(429, AGNES_BODY, 0, "agnes");
    expect(res.shouldFallback).toBe(true);
    expect(res.dailyQuota).toBe(true);
    // No escalating backoff — the account is empty until tomorrow, not in a
    // burst window.
    expect(res.newBackoffLevel).toBe(0);
  });

  it("quotaWindowFor(agnes) returns a daily scope resetting at 00:00 UTC", () => {
    const qw = quotaWindowFor("agnes");
    expect(qw.scope).toBe(QUOTA_SCOPES.DAILY);
    expect(qw.resetUtcHour).toBe(0);
  });

  it("calendar fallback lands at the next 00:00 UTC", () => {
    const qw = quotaWindowFor("agnes");
    const resetAt = new Date(calendarResetMs(qw.scope, qw, Date.now()));
    expect(resetAt.getUTCHours()).toBe(0);
    expect(resetAt.getUTCMinutes()).toBe(0);
    expect(resetAt.getUTCSeconds()).toBe(0);
    // Reset is in the future.
    expect(resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("lock duration reaches the next UTC midnight", () => {
    const res = checkFallbackError(429, AGNES_BODY, 0, "agnes");
    const unlockAt = new Date(Date.now() + res.cooldownMs);
    // Should be close to next 00:00 UTC (within 24h and not trivially short).
    expect(res.cooldownMs).toBeGreaterThan(60 * 1000);          // > 1 minute
    expect(res.cooldownMs).toBeLessThanOrEqual(24 * 3600 * 1000); // <= 24h
    expect(unlockAt.getUTCHours()).toBe(0);
    expect(unlockAt.getUTCMinutes()).toBe(0);
  });

  it("does not classify a plain burst 429 from Agnes as quota exhaustion", () => {
    // Agnes also returns 429 for per-minute rate limits (20 RPM). Those should
    // not park the account for a whole day.
    const burst = '[429]: {"error":{"message":"Rate limit exceeded. Too many requests.","code":"rate_limit_exceeded"}}';
    expect(isQuotaExhaustedError(burst)).toBe(false);
  });
});
