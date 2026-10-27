// MiniMax refuses a request with
//
//   429 {"type":"error","error":{"type":"rate_limit_error",
//        "message":"usage limit reached: insufficient balance (1008)"}}
//
// when the account's M Plan window is exhausted. The plan window's reset is
// KNOWN — the tracker reports `current_interval_remaining_percent`,
// `current_interval_status` and `end_time` — but PanRouter only learned about
// it from the 429, so the account was locked for a flat 300 seconds and then
// tried again, burning a real request each time.
//
// Same shape as the Kiro monthly-cap cache: remember the tracker reading and
// skip the account before the request goes out.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  recordMiniMaxUsage,
  shouldSkipMiniMaxAccount,
  markMiniMaxExhausted,
  resetMiniMaxCapCache,
} from "../../open-sse/services/minimaxCapCache.js";
import { isQuotaExhaustedError, quotaWindowFor, QUOTA_SCOPES } from "../../open-sse/config/quotaWindows.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const MINIMAX_429 = JSON.stringify({
  type: "error",
  error: {
    type: "rate_limit_error",
    message: "usage limit reached: insufficient balance (1008)",
  },
});

describe("minimax — the refusal is a quota refusal", () => {
  it("is classified as an exhausted quota", () => {
    expect(isQuotaExhaustedError(MINIMAX_429)).toBe(true);
  });

  it("declares a session scope so the tracker reset drives the lock", () => {
    expect(quotaWindowFor("minimax-code-global").scope).toBe(QUOTA_SCOPES.SESSION);
    expect(quotaWindowFor("minimax-code").scope).toBe(QUOTA_SCOPES.SESSION);
  });

  it("does not fire on an unrelated 429", () => {
    expect(isQuotaExhaustedError("rate limited, slow down")).toBe(false);
  });
});

describe("minimax — the block is 24 hours", () => {
  it("parks the account for 24h", () => {
    const res = checkFallbackError(429, MINIMAX_429, 0, "minimax-code-global");
    expect(res.cooldownMs).toBe(24 * 60 * 60 * 1000);
    expect(res.shouldFallback).toBe(true);
  });

  it("parks the CN provider for 24h too", () => {
    const res = checkFallbackError(429, MINIMAX_429, 0, "minimax-code");
    expect(res.cooldownMs).toBe(24 * 60 * 60 * 1000);
  });

  it("does not change any other provider", () => {
    const res = checkFallbackError(429, MINIMAX_429, 0, "cline");
    expect(res.cooldownMs).not.toBe(24 * 60 * 60 * 1000);
  });

  it("auth.js does not let the tracker reset overwrite the 24h block", () => {
    // A plan window can report a reset only a couple of hours out; the
    // operator asked for a flat 24h so the account is not re-probed.
    const auth = read("../src/sse/services/auth.js");
    expect(auth).toContain("isMiniMaxPlanExhaustion");
    expect(auth).toMatch(/quotaExhausted && !resetsAtMs && !isMiniMaxPlanExhaustion/);
  });
});

describe("minimaxCapCache — skip the exhausted account", () => {
  beforeEach(() => resetMiniMaxCapCache());

  it("skips an account whose plan window is at 0%", () => {
    const reset = new Date(Date.now() + 3600_000).toISOString();
    recordMiniMaxUsage("conn-a", {
      quotas: {
        "M-series · Allowance": { used: 100, total: 100, remaining: 0, remainingPercentage: 0, resetAt: reset },
      },
    });
    const v = shouldSkipMiniMaxAccount("conn-a");
    expect(v.skip).toBe(true);
    expect(v.until).toBe(new Date(reset).getTime());
  });

  it("does NOT skip an account with quota left", () => {
    recordMiniMaxUsage("conn-b", {
      quotas: {
        "M-series · Allowance": { used: 10, total: 100, remaining: 90, remainingPercentage: 90, resetAt: new Date(Date.now() + 3600_000).toISOString() },
      },
    });
    expect(shouldSkipMiniMaxAccount("conn-b").skip).toBe(false);
  });

  it("skips an account with a zero credit balance", () => {
    recordMiniMaxUsage("conn-c", {
      quotas: { Credits: { used: 0, total: 0, isCreditBalance: true, currency: "credits" } },
    });
    expect(shouldSkipMiniMaxAccount("conn-c").skip).toBe(true);
  });

  it("skips after a 429 even without a tracker reading", () => {
    markMiniMaxExhausted("conn-d");
    expect(shouldSkipMiniMaxAccount("conn-d").skip).toBe(true);
  });

  it("has no opinion about an account it has never seen", () => {
    expect(shouldSkipMiniMaxAccount("conn-unknown").skip).toBe(false);
  });

  it("stops skipping once the window reset", () => {
    markMiniMaxExhausted("conn-e", Date.now() - 1000);
    expect(shouldSkipMiniMaxAccount("conn-e").skip).toBe(false);
  });

  it("ignores a stale HEALTHY reading", () => {
    // A healthy account's entry goes stale after the short TTL so a fresh
    // reading can take over.
    const old = Date.now() - 10 * 60 * 1000;
    recordMiniMaxUsage("conn-f", {
      quotas: { "M": { remaining: 90, remainingPercentage: 90, resetAt: new Date(Date.now() + 3600_000).toISOString() } },
    }, old);
    expect(shouldSkipMiniMaxAccount("conn-f").skip).toBe(false);
  });

  it("keeps an EXHAUSTED account blocked for the full 24h", () => {
    // The operator asked for a flat 24-hour block: a plan window can report a
    // reset only a couple of hours out, and every retry is a real request.
    const old = Date.now() - 10 * 60 * 60 * 1000; // 10 hours ago
    recordMiniMaxUsage("conn-g", {
      quotas: { "M": { remaining: 0, remainingPercentage: 0, resetAt: new Date(Date.now() + 3600_000).toISOString() } },
    }, old);
    expect(shouldSkipMiniMaxAccount("conn-g").skip).toBe(true);
  });

  it("a fresh reading releases an exhausted account", () => {
    // When the plan refills the tracker says so, and the account becomes
    // eligible again without waiting for the 24h block to expire.
    recordMiniMaxUsage("conn-h", {
      quotas: { "M": { remaining: 0, remainingPercentage: 0, resetAt: new Date(Date.now() + 3600_000).toISOString() } },
    });
    expect(shouldSkipMiniMaxAccount("conn-h").skip).toBe(true);
    recordMiniMaxUsage("conn-h", {
      quotas: { "M": { remaining: 80, remainingPercentage: 80, resetAt: new Date(Date.now() + 3600_000).toISOString() } },
    });
    expect(shouldSkipMiniMaxAccount("conn-h").skip).toBe(false);
  });
});

describe("wiring", () => {
  const auth = read("../src/sse/services/auth.js");
  const usageSvc = read("../open-sse/services/usage.js");

  it("auth.js skips an exhausted MiniMax account", () => {
    expect(auth).toContain("shouldSkipMiniMaxAccount(c.id)");
  });

  it("auth.js marks the account exhausted on the 429", () => {
    expect(auth).toContain("markMiniMaxExhausted(connectionId");
  });

  it("the usage service feeds the cache from the tracker reading", () => {
    expect(usageSvc).toContain("recordMiniMaxUsage(connection.id, result)");
  });

  it("both MiniMax Code providers are covered", () => {
    expect(auth).toMatch(/minimax-code-global/);
    expect(auth).toMatch(/minimax-code/);
  });
});
