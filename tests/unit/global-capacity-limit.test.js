// A provider-wide capacity limit must not be treated as a per-account problem.
//
// Observed: BazaarLink returned 429 `free_global_rate_limited` — "Free models
// share a limited site-wide capacity and it is currently full — this is not your
// personal quota. Retry after 30 seconds". The router locked Key 4, Key 3, Key 2,
// Key 1 in turn (4s each), then reported "all 12 accounts locked". Every key got
// the same answer because the limit is on the SITE, not the key.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { globalCapacityLimit, isQuotaExhaustedError } from "../../open-sse/config/quotaWindows.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const BAZARLINK = JSON.stringify({
  error: {
    message:
      "Free models share a limited site-wide capacity and it is currently full — this is not your personal quota. Retry after 30 seconds, or add credits to use the paid version (no shared limit). 免費模型為全站共用的有限額度，目前已滿，這不是您個人的額度用完。請於 30 秒後重試，或儲值後改用付費版本（不受共用額度限制）。",
    type: "rate_limit_error",
    code: "free_global_rate_limited",
  },
});

describe("globalCapacityLimit", () => {
  it("detects the BazaarLink site-wide limit", () => {
    expect(globalCapacityLimit(429, BAZARLINK)).toEqual({ globalLimit: true, retryAfterMs: 30000 });
  });

  it("reads the provider's own retry hint", () => {
    const body = JSON.stringify({ code: "free_global_rate_limited", message: "Retry after 12 seconds" });
    expect(globalCapacityLimit(429, body).retryAfterMs).toBe(12000);
  });

  it("falls back to 30s when no hint is given", () => {
    const body = JSON.stringify({ code: "free_global_rate_limited", message: "site-wide capacity full" });
    expect(globalCapacityLimit(429, body).retryAfterMs).toBe(30000);
  });

  it("ignores a plain per-key 429", () => {
    expect(globalCapacityLimit(429, "Rate limited. Please retry later.")).toBeNull();
  });

  it("ignores non-429 statuses", () => {
    expect(globalCapacityLimit(403, BAZARLINK)).toBeNull();
    expect(globalCapacityLimit(500, BAZARLINK)).toBeNull();
  });
});

describe("isQuotaExhaustedError — site-wide is not personal quota", () => {
  it("does not treat the site-wide limit as an exhausted quota", () => {
    // The body literally says "this is not your personal quota", yet contains
    // the word "quota" — without the guard it would park every key until the
    // monthly calendar boundary.
    expect(isQuotaExhaustedError(BAZARLINK)).toBe(false);
  });

  it("still detects a real personal quota refusal", () => {
    expect(isQuotaExhaustedError("daily free limit reached")).toBe(true);
  });
});

describe("chat.js — stops rotating on a global limit", () => {
  const chat = read("../src/sse/handlers/chat.js");

  it("calls globalCapacityLimit", () => {
    expect(chat).toContain("globalCapacityLimit(result.status, result.error)");
  });

  it("returns before markAccountUnavailable", () => {
    const globalIdx = chat.indexOf("const globalLimit = globalCapacityLimit");
    const markIdx = chat.indexOf("markAccountUnavailable(");
    expect(globalIdx).toBeGreaterThan(-1);
    expect(markIdx).toBeGreaterThan(-1);
    expect(globalIdx).toBeLessThan(markIdx);
  });

  it("surfaces 429 with the retry window", () => {
    expect(chat).toMatch(/provider-wide capacity limit/);
    // HTTP_STATUS.TOO_MANY_REQUESTS does not exist in runtimeConfig —
    // the constant is RATE_LIMITED.
    expect(chat).toContain("HTTP_STATUS.RATE_LIMITED");
  });
});
