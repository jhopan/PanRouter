import { describe, it, expect } from "vitest";
import { isQuotaExhaustedError, quotaWindowFor, calendarResetMs, QUOTA_SCOPES } from "../../open-sse/services/quotaWindow.js";
import { checkFallbackError, dailyQuotaCooldownMs } from "../../open-sse/services/accountFallback.js";
import { tokenharborResetMs } from "../../src/sse/services/auth.js";

// Real TokenHarbor body (2026-09-26): free-allowance refusal carrying its own
// reset timestamp. Before this, the router treated it as a burst 429 and
// retried the same empty account on the backoff ladder for 7 days.
const TH_429 = '[429]: {"error":{"message":"You\'ve used this period\'s free allowance. Your next rolling 7-day period starts on 2 Oct 2026 at 06:22 UTC. Use the paid model \'deepseek-v4-flash\' to keep going, or subscribe"}}';

describe("tokenharbor free-allowance quota", () => {
  it("classifies as quota exhaustion, not burst rate limit", () => {
    expect(isQuotaExhaustedError(TH_429)).toBe(true);
  });

  it("checkFallbackError parks instead of backing off", () => {
    const res = checkFallbackError(429, TH_429, 0, "tokenharbor");
    expect(res.shouldFallback).toBe(true);
    expect(res.dailyQuota).toBe(true);
    expect(res.newBackoffLevel).toBe(0);
    // weekly cadence: cooldown bounded by the weekly ceiling
    expect(res.cooldownMs).toBeLessThanOrEqual(quotaWindowFor("tokenharbor").maxCooldownMs);
  });

  it("weekly calendar fallback lands on a Monday 00:00 UTC", () => {
    const resetAt = new Date(calendarResetMs(quotaWindowFor("tokenharbor").scope, {}, Date.now()));
    expect(resetAt.getUTCDay()).toBe(1);
    expect(resetAt.getUTCHours()).toBe(0);
  });
});

describe("tokenharborResetMs parser", () => {
  // Built at run time: the fixture must stay in the future or the parser is
  // correctly expected to reject a past reset and the test rots on the calendar.
  const RESET = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const RESET_TEXT = `${RESET.getUTCDate()} ${MONTHS[RESET.getUTCMonth()]} ${RESET.getUTCFullYear()} at ${String(RESET.getUTCHours()).padStart(2, "0")}:${String(RESET.getUTCMinutes()).padStart(2, "0")} UTC`;
  const REAL = `You've used this period's free allowance. Your next rolling 7-day period starts on ${RESET_TEXT}. Use the paid model 'deepseek-v4-flash' to keep going, or subscribe`;

  it("parses the exact reset timestamp out of the 429 body", () => {
    const ms = tokenharborResetMs(429, "[429]: " + JSON.stringify({ error: { message: REAL } }), "tokenharbor");
    expect(ms).toBeGreaterThan(Date.now());
    expect(ms).toBe(Date.UTC(RESET.getUTCFullYear(), RESET.getUTCMonth(), RESET.getUTCDate(), RESET.getUTCHours(), RESET.getUTCMinutes(), 0));
  });

  it("ignores non-tokenharbor, non-429, and message-less bodies", () => {
    const REAL2 = REAL;
    expect(tokenharborResetMs(429, REAL2, "cline")).toBeNull();
    expect(tokenharborResetMs(503, REAL2, "tokenharbor")).toBeNull();
    expect(tokenharborResetMs(429, "free allowance but no date", "tokenharbor")).toBeNull();
  });
});
