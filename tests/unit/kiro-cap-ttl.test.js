// A Kiro account whose monthly cap is still in effect must be skipped for the
// WHOLE cap window — not just for the 5-minute cache TTL.
//
// Field log (2026-10-27):
//   [402]: {"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"}
//   [AUTH] Adelia locked modelLock___all for 376727s until 2026-11-01T00:00:00.848Z
//
// The lock was right (1 Nov), but the account was still being sent requests.
//
// Cause: shouldSkipKiroAccount() bailed out on a 5-minute TTL:
//
//   if (now - entry.checkedAt > CACHE_TTL_MS) return { skip: false };
//
// `checkedAt` is set to the moment the 402 arrived, so five minutes later the
// entry was considered stale and the account looked healthy again — even
// though cappedUntil was still 4+ days away.
//
// The TTL exists to expire a STALE probe. A cap that is still in effect is not
// stale: it is authoritative until cappedUntil passes.
import { describe, expect, it, beforeEach } from "vitest";
import {
  shouldSkipKiroAccount,
  markKiroCapped,
  getKiroCapCache,
  recordKiroUsage,
} from "../../open-sse/services/kiroCapCache.js";

const MINUTE = 60 * 1000;

describe("kiro cap cache — a live cap outlives the probe TTL", () => {
  beforeEach(() => {
    getKiroCapCache().clear();
  });

  it("skips a freshly capped account", () => {
    markKiroCapped("conn-1");
    expect(shouldSkipKiroAccount("conn-1").skip).toBe(true);
  });

  it("STILL skips after the 5-minute probe TTL has passed", () => {
    // The regression: the account has 4+ days of cap left, but the entry was
    // 6 minutes old.
    const sixMinutesAgo = Date.now() - 6 * MINUTE;
    markKiroCapped("conn-1", null, sixMinutesAgo);
    expect(shouldSkipKiroAccount("conn-1").skip).toBe(true);
  });

  it("STILL skips a week later while the cap is in effect", () => {
    const weekAgo = Date.now() - 7 * 24 * 60 * MINUTE;
    markKiroCapped("conn-1", null, weekAgo);
    expect(shouldSkipKiroAccount("conn-1").skip).toBe(true);
  });

  it("stops skipping once the cap window has passed", () => {
    // The cap ended — the account becomes eligible again.
    const past = Date.now() - MINUTE;
    markKiroCapped("conn-1", past);
    expect(shouldSkipKiroAccount("conn-1").skip).toBe(false);
  });

  it("reports the reset time so the caller can show it", () => {
    const until = Date.now() + 4 * 24 * 60 * MINUTE;
    markKiroCapped("conn-1", until);
    const verdict = shouldSkipKiroAccount("conn-1");
    expect(verdict.skip).toBe(true);
    expect(verdict.until).toBeGreaterThan(Date.now());
  });

  it("a healthy usage reading clears the cap", () => {
    markKiroCapped("conn-1");
    expect(shouldSkipKiroAccount("conn-1").skip).toBe(true);
    // A reading that shows quota again means the account is usable.
    recordKiroUsage("conn-1", { quotas: { agentic_request: { used: 1, total: 100, remaining: 99, resetAt: null } } });
    expect(shouldSkipKiroAccount("conn-1").skip).toBe(false);
  });
});
