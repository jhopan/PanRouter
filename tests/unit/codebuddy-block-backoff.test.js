// Port of upstream 9router PR #5024 — "CodeBuddy Intl block backoff".
//
// Upstream added two provider-scoped rules and one request-scoped guard:
//
//   { provider: "codebuddy-intl", text: "request illegal",          backoff: true },
//   { provider: "codebuddy-intl", text: "conversation id missing", backoff: true },
//
//   if (status >= 400 && status < 500
//       && status !== 401 && status !== 402 && status !== 403 && status !== 429) {
//     return { shouldFallback: false, cooldownMs: 0, requestScoped: true };
//   }
//
// Why it matters: without them a 400 caused by the REQUEST itself (context
// overflow, "first message is not system prompt") cooled the account down and
// removed a healthy connection from rotation. With one connection it was worse:
// every later request failed with "all 1 accounts locked" and the real cause
// was hidden from the caller.
//
// Upstream has no 11140 handling at all, so that part is ours: a restricted
// account is BANNED (upstream's own wording: "Submit feedback to appeal this
// restriction"), so it must not be retried every 12 hours either.
import { describe, expect, it } from "vitest";
import { BACKOFF_CONFIG } from "../../open-sse/config/errorConfig.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

describe("upstream #5024 — codebuddy block backoff", () => {
  it.each(["11128:request illegal", "conversation id missing"])(
    "backs off for %s",
    (msg) => {
      expect(checkFallbackError(400, { code: 11128, msg }, 0, "codebuddy-intl")).toEqual({
        shouldFallback: true,
        cooldownMs: BACKOFF_CONFIG.base,
        newBackoffLevel: 1,
      });
    },
  );

  it("increases repeated block cooldowns and respects the existing cap", () => {
    expect([0, 1, 2].map((level) =>
      checkFallbackError(400, "request illegal", level, "codebuddy-intl").cooldownMs,
    )).toEqual([BACKOFF_CONFIG.base, BACKOFF_CONFIG.base * 2, BACKOFF_CONFIG.base * 4]);

    expect(checkFallbackError(400, "request illegal", BACKOFF_CONFIG.maxLevel, "codebuddy-intl"))
      .toEqual({ shouldFallback: true, cooldownMs: BACKOFF_CONFIG.max, newBackoffLevel: BACKOFF_CONFIG.maxLevel });
  });

  it.each(["openai", "codebuddy-cn", null])(
    "keeps the same text request-scoped for provider %s",
    (provider) => {
      // The upstream test asserts toEqual({shouldFallback:false, cooldownMs:0}) but
      // upstream's own implementation returns requestScoped:true, so that
      // assertion cannot hold. The flag is the point: the credential is healthy,
      // the request is not.
      expect(checkFallbackError(400, "request illegal", 0, provider))
        .toMatchObject({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
    },
  );

  it("does not classify every 11128 code as a block", () => {
    expect(checkFallbackError(400, { code: 11128, msg: "first message is not system prompt" }, 0, "codebuddy-intl"))
      .toMatchObject({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
  });
});

describe("ours — 11140 is a ban, not a cooldown", () => {
  it("classifies 11140 as a ban", () => {
    const v = checkFallbackError(403, { code: 11140, msg: "request illegal" }, 0, "codebuddy-intl");
    expect(v.banned).toBe(true);
  });

  it("parks a banned account for weeks, not hours", () => {
    const v = checkFallbackError(403, { code: 11140, msg: "request illegal" }, 0, "codebuddy-intl");
    expect(v.cooldownMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
  });

  it("still falls back to the next account", () => {
    expect(checkFallbackError(403, { code: 11140, msg: "request illegal" }, 0, "codebuddy-intl").shouldFallback).toBe(true);
  });

  it("is detected through the displayMsg text, not only the code", () => {
    const body = {
      code: 11140,
      msg: "request illegal",
      displayMsg: { en: "Your account has been restricted due to unusual activity" },
    };
    expect(checkFallbackError(403, body, 0, "codebuddy-intl").banned).toBe(true);
  });

  it("does not ban other providers on the same wording", () => {
    expect(checkFallbackError(403, { code: 11140, msg: "request illegal" }, 0, "openai").banned).toBeUndefined();
  });
});

describe("wiring", () => {
  const cfg = read("../open-sse/config/errorConfig.js");

  it("has the two upstream provider-scoped rules", () => {
    expect(cfg).toMatch(/provider: "codebuddy-intl",\s*text: "request illegal",\s*backoff: true/);
    expect(cfg).toMatch(/provider: "codebuddy-intl",\s*text: "conversation id missing",\s*backoff: true/);
  });

  it("keeps the request-scoped 4xx guard", () => {
    const af = read("../open-sse/services/accountFallback.js");
    expect(af).toMatch(/requestScoped: true/);
  });
});
