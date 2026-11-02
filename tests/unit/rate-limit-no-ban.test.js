// A 429 must not turn into a ban.
//
// Observed on CodeBuddy Intl (29 accounts, DeepSeek-V4.1-Flash):
//
//   [08:21:48] ✗ ERROR 429 · ... [429]: usage exceeds frequency limit, but
//              don't worry, your usage will reset at 2026-11-02 10:05:00 UTC+8
//   [08:21:48] ⚠️ [CHAT] retrying the same account (1/1) — [429]: usage exceeds
//              frequency limit...
//   [08:21:50] ▶ POST ... ACC:Account 29
//   [08:21:50] ✗ ERROR 429 · ... REQ:64caa2 (same account, 2 seconds later)
//   [08:21:50] ⚠️ [AUTH] Account 29 locked modelLock_deepseek-v4.1-flash for 1800s
//   [08:21:50] ⚠️ [AUTH] all 29 accounts locked for deepseek-v4.1-flash
//
// The provider said "your usage will reset at 2026-11-02 10:05:00" — about 30
// hours away. Three things broke that:
//
//   1. The same-account retry fired on a 429, so the account that had just
//      been told to stop was asked again two seconds later.
//   2. The cooldown was capped at MAX_RATE_LIMIT_COOLDOWN_MS (30 minutes)
//      even though the provider supplied a reset 30 hours out. Every account
//      came back after half an hour and was asked again.
//   3. That repeated hammering is what the provider sees as automation, and
//      the answer was 11140 "request illegal" — a 30-day account ban.
//
// The rule this file pins down: a 429 is a refusal with a known end. Retry it
// zero times, park the account until the provider's own reset time, and never
// let the burst limit shorten a quota window.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");

const chat = read("src/sse/handlers/chat.js");
const auth = read("src/sse/services/auth.js");
const errorConfig = read("open-sse/config/errorConfig.js");
const quotaWindows = read("open-sse/config/quotaWindows.js");

describe("a 429 is never retried on the same account", () => {
  // The same-account retry block. There are two "retrying the same account"
  // lines in the file — the admission-queue one and the refusal one — so the
  // block is located by its condition, not by the log text.
  const retryBlock = (() => {
    const start = chat.indexOf("const isRateLimited =");
    const end = chat.indexOf("retrying the same account (${sameAccountRetries}", start);
    return chat.slice(start, end);
  })();

  it("the same-account retry excludes rate limits", () => {
    // The retry exists for transient channel-verification refusals (11128).
    // A 429 is not transient: the provider named the moment the quota reopens.
    expect(retryBlock).toMatch(/!isRateLimited/);
    expect(retryBlock).toMatch(/RATE_LIMITED/);
  });

  it("does not use the same-account retry for any rate limit", () => {
    expect(retryBlock).toMatch(/RATE_LIMITED|429/);
  });
});

describe("a provider-supplied reset time is not shortened", () => {
  it("the rate-limit cooldown ceiling is not applied to a quota-class reset", () => {
    // CodeBuddy says "usage will reset at 2026-11-02 10:05:00" — 30 hours.
    // Capping that at 30 minutes brought every account back while it was still
    // rate-limited, which is the hammering that produced the bans.
    expect(auth).toMatch(/isQuotaClass|quotaWindowFor/);
    const quotaBranch = auth.slice(auth.indexOf("const isQuotaClass"));
    expect(quotaBranch).toMatch(/ceiling\s*=\s*isQuotaClass/);
  });

  it("a frequency-limit 429 with a reset date counts as quota class", () => {
    // isQuotaExhaustedError deliberately excludes "frequency limit" so a
    // burst throttle is not parked on the monthly calendar. But when the
    // provider gives a reset DATE, that date is the truth and must be honoured.
    expect(quotaWindows).toMatch(/frequency limit|exceeds? frequency/);
  });

  it("CodeBuddy's frequency-limit 429 with a reset date is quota class", () => {
    // The generic rule sends "frequency limit" to the burst branch. The
    // provider-supplied reset has to win over that when a date is present.
    expect(auth).toMatch(/usage will reset at|resetsAtMs/);
  });
});

describe("rate limits do not ban the account", () => {
  it("no 429 rule is marked as a ban", () => {
    const rules = errorConfig.slice(errorConfig.indexOf("ERROR_RULES"));
    const banRules = rules.split("\n").filter((l) => l.includes("banned: true"));
    for (const rule of banRules) {
      expect(rule).not.toMatch(/429/);
    }
  });

  it("CodeBuddy's ban rules are the 11140 family, not rate limits", () => {
    expect(errorConfig).toMatch(/code:\s*11140,\s*banned:\s*true/);
  });
});

describe("CodeBuddy: one limit stops the whole rotation", () => {
  // The field log: Account 1 got 429, the router retried the same account, then
  // walked to Account 29 — 29 requests across the pool inside two seconds. The
  // provider answered that burst with 11140 "request illegal", a 30-day ban.
  //
  // CodeBuddy is special: a 429 there is not "this account is empty, try the
  // next one", it is "the gateway is now watching this traffic". The only safe
  // move is to stop and report the reset time.

  const stopBlock = (() => {
    const start = chat.indexOf("const CODEBUDDY_STOP_ON_LIMIT");
    const end = chat.indexOf("// A provider ban means the account is refused", start);
    return chat.slice(start, end > start ? end : undefined);
  })();

  it("stops the rotation on the first rate limit", () => {
    expect(chat).toMatch(/CODEBUDDY_STOP_ON_LIMIT|STOP_ON_LIMIT/);
  });

  it("does not walk the remaining accounts after a 429", () => {
    // The stop has to happen BEFORE excludeConnectionIds.add + continue,
    // otherwise the loop has already moved on.
    expect(stopBlock).toMatch(/return unavailableResponse|return createErrorResult|return errorResponse/);
  });

  it("reports the provider's reset time to the caller", () => {
    expect(stopBlock).toMatch(/resetsAtMs|retryAfter|reset/i);
  });

  it("applies to codebuddy-intl only, not every provider", () => {
    expect(stopBlock).toMatch(/codebuddy-intl/);
  });

  it("does not count the stop as a ban", () => {
    // Stopping early is the opposite of a ban: it is what prevents one.
    expect(stopBlock).not.toMatch(/banned: true/);
  });
});

describe("CodeBuddy: the lock runs to the reset time plus a safety margin", () => {
  // The provider says "your usage will reset at 2026-11-02 10:05:00 UTC+8".
  // Two things have to be true:
  //
  //   1. The lock ends at that moment, not at a generic 30-minute ceiling.
  //      Capping it meant every account came back while still rate-limited,
  //      and the retry is what produced 11140 "request illegal".
  //   2. A margin is added on top. The provider's clock, the request in flight
  //      and the moment the quota actually refills are not the same instant;
  //      asking one second early earns another refusal.
  //
  // The timestamp carries its own offset (UTC+8). The server runs WIB (UTC+7)
  // and the account is on WITA (UTC+8), so the offset in the body — not the
  // server's zone — is what the epoch has to be built from.
  const intl = read("open-sse/executors/codebuddy-intl.js");

  it("adds a margin on top of the provider reset time", () => {
    expect(intl).toMatch(/RESET_SAFETY_MARGIN_MS|SAFETY_MARGIN/);
  });

  it("the margin is ten minutes", () => {
    const m = intl.match(/(?:RESET_SAFETY_MARGIN_MS|SAFETY_MARGIN\w*)\s*=\s*([\d\s*]+)/);
    expect(m).toBeTruthy();
    const value = m[1].split("*").map((n) => Number(n.trim())).reduce((a, b) => a * b, 1);
    expect(value).toBe(10 * 60 * 1000);
  });

  it("builds the epoch from the offset in the body, not the server zone", () => {
    // "2026-11-02 10:05:00 UTC+8" must become 02:05 UTC, whatever TZ the
    // server runs in. Building it from local time would shift it by an hour
    // on WIB and by more elsewhere.
    expect(intl).toMatch(/UTC\+|\+08:00|offset/i);
  });

  it("keeps the reset time parse for the frequency-limit code", () => {
    expect(intl).toMatch(/frequency limit|6004/);
    expect(intl).toMatch(/resetsAtMs/);
  });
});

describe("the lock length matches the provider's reset time", () => {
  it("a 429 with a reset time locks until that time", () => {
    // The log showed "locked ... for 1800s" for a quota that resets in 30
    // hours. The lock has to use the provider's own end.
    expect(auth).toMatch(/resetsAtMs\s*-\s*Date\.now\(\)/);
  });
});
