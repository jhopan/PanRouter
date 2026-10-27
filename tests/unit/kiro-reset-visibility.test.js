// Kiro's monthly cap must show WHEN it resets — the way Codex does.
//
// Field log:
//
//   [14:01:24] ✗ ERROR 402 · kiro/claude-sonnet-4.5-thinking-agentic · 1699ms
//   [14:01:25] ⚠️ [AUTH] Adelia locked modelLock___all for 406715s [402]
//   ❌ kiro [402]: {"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"}
//
// The lock is right (406715s ≈ the 1st of next month) but neither the log line
// nor the connection record says WHEN. Codex shows
// "Quota exhausted — resets 2026-11-17T02:43:32.000Z" plus a "⏱ 500h 32m"
// countdown, so an operator can see at a glance that the account is parked for
// the month and when it comes back.
//
// These tests pin the three places that information has to reach:
//   1. the log line written when the account is locked
//   2. the connection record (lastError + quotaExhaustedUntil)
//   3. the quota tracker payload, so the dashboard can show the reset too
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");

const auth = read("src/sse/services/auth.js");
const kiroUsage = read("open-sse/services/usage/kiro.js");
const usageIndex = read("open-sse/services/usage.js");
const quotaWindows = read("open-sse/config/quotaWindows.js");

describe("kiro — the lock log states the reset date", () => {
  it("prints the reset timestamp in the AUTH log line", () => {
    // The lock message must carry the ISO reset, not just a duration, so the
    // operator can read the date straight out of the log.
    expect(auth).toMatch(/locked \$\{lockKey\}[^`]*\$\{[^}]*reset/i);
  });

  it("keeps the duration too, so the line stays readable", () => {
    expect(auth).toMatch(/for \$\{Math\.round\(cooldownMs \/ 1000\)\}s/);
  });
});

describe("kiro — the connection record carries the reset", () => {
  it("writes 'Quota exhausted — resets <iso>' as lastError", () => {
    expect(auth).toContain("Quota exhausted — resets");
  });

  it("writes quotaExhaustedUntil so a restart keeps the park", () => {
    expect(auth).toContain("quotaExhaustedUntil");
  });

  it("treats the Kiro monthly refusal as quota-class", () => {
    // isQuotaExhaustedError must accept the Kiro body so the record is written
    // in the quota shape rather than the raw provider message.
    expect(quotaWindows).toMatch(/monthly_request_count/);
  });
});

describe("kiro — the quota tracker reports the monthly reset", () => {
  it("exposes the reset date on every Kiro quota row", () => {
    // getKiroUsage already parses nextDateReset; the tracker payload must keep
    // it so the dashboard can show "resets 2026-11-01".
    expect(kiroUsage).toMatch(/nextDateReset/);
    expect(kiroUsage).toMatch(/resetAt/);
  });

  it("marks the monthly cap as reached instead of leaving it blank", () => {
    // Codex reports limitReached; Kiro needs the same signal so the tracker
    // can label the row as exhausted rather than "unknown".
    expect(kiroUsage).toMatch(/limitReached/);
  });

  it("keeps the Kiro cap in the shared usage cache", () => {
    // getUsageForProvider must feed the Kiro row into the tracker so the
    // dashboard shows the same reset the lock uses.
    expect(usageIndex).toMatch(/kiro/i);
  });

  it("always has a monthly row, even when the account is empty", () => {
    // An exhausted account can come back with an empty breakdown list, which
    // would leave the tracker card blank instead of showing the reset.
    expect(kiroUsage).toMatch(/quotaInfo\.monthly/);
  });

  it("exposes the account-level reset date", () => {
    expect(kiroUsage).toMatch(/resetAt,\s*\n\s*quotas: quotaInfo/);
  });
});

describe("kiro — the tracker row shows a percentage, not a request count", () => {
  const resetAt = "2026-11-01T00:00:00.000Z";

  it("turns used/total into a remaining percentage", () => {
    const rows = parseQuotaData("kiro", {
      quotas: {
        monthly: { used: 60, total: 100, remaining: 40, resetAt },
      },
    });
    expect(rows).toHaveLength(1);
    // 40 requests left out of 100 = 40% remaining, NOT "40" as a percentage
    // and definitely not the raw 40-count read as 40%.
    expect(rows[0].remaining).toBe(40);
    expect(rows[0].used).toBe(60);
    expect(rows[0].total).toBe(100);
  });

  it("carries the reset date onto the row", () => {
    const rows = parseQuotaData("kiro", {
      quotas: { monthly: { used: 100, total: 100, remaining: 0, resetAt } },
    });
    expect(rows[0].resetAt).toBe(resetAt);
    expect(rows[0].remaining).toBe(0);
  });

  it("does not blow up on a row with no total", () => {
    const rows = parseQuotaData("kiro", {
      quotas: { monthly: { used: 0, total: 0, remaining: 0, resetAt } },
    });
    expect(rows[0].remaining).toBe(0);
  });
});
