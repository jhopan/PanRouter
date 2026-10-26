// Kiro's quota tracker already knows the account is capped — so the request
// should never be sent. Waiting for the 402 means every model on that account
// travels upstream, gets refused, and locks something, over and over.
//
// The usage API reports:
//   usageBreakdownList[].currentUsageWithPrecision  (used)
//   usageBreakdownList[].usageLimitWithPrecision    (total)
//   nextDateReset                                   (when it refills)
//
// kiroCapCache remembers that reading and auth.js skips the account before the
// upstream call. Same pattern as the Antigravity bucket cache.
import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  recordKiroUsage,
  shouldSkipKiroAccount,
  markKiroCapped,
  clearKiroCap,
  resetKiroCapCache,
  getKiroCapCache,
} from "../../open-sse/services/kiroCapCache.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");
const DAY = 24 * 60 * 60 * 1000;

const usage = (used, total, resetAt) => ({
  quotas: { requests: { used, total, remaining: total - used, resetAt } },
});

describe("kiroCapCache — skip before the request goes out", () => {
  beforeEach(() => resetKiroCapCache());

  it("skips an account the usage API reports as exhausted", () => {
    const reset = new Date(Date.now() + 5 * DAY).toISOString();
    recordKiroUsage("conn-a", usage(100, 100, reset));
    const verdict = shouldSkipKiroAccount("conn-a");
    expect(verdict.skip).toBe(true);
    expect(verdict.reason).toMatch(/monthly cap/i);
  });

  it("does NOT skip an account that still has quota", () => {
    recordKiroUsage("conn-b", usage(10, 100, new Date(Date.now() + 5 * DAY).toISOString()));
    expect(shouldSkipKiroAccount("conn-b").skip).toBe(false);
  });

  it("skips after a 402 even without a usage reading", () => {
    markKiroCapped("conn-c", Date.now() + 5 * DAY);
    expect(shouldSkipKiroAccount("conn-c").skip).toBe(true);
  });

  it("falls back to the 1st of next month when no reset is known", () => {
    const now = Date.now();
    markKiroCapped("conn-d", null, now);
    const entry = getKiroCapCache().get("conn-d");
    const d = new Date(entry.cappedUntil);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getTime()).toBeGreaterThan(now);
  });

  it("has no opinion about an account it has never seen", () => {
    expect(shouldSkipKiroAccount("conn-unknown").skip).toBe(false);
  });

  it("stops skipping once the reset time has passed", () => {
    markKiroCapped("conn-e", Date.now() - 1000);
    expect(shouldSkipKiroAccount("conn-e").skip).toBe(false);
  });

  it("ignores a stale reading", () => {
    // 5-minute TTL: an old reading must not block the account forever.
    const old = Date.now() - 10 * 60 * 1000;
    recordKiroUsage("conn-f", usage(100, 100, new Date(Date.now() + 5 * DAY).toISOString()), old);
    expect(shouldSkipKiroAccount("conn-f").skip).toBe(false);
  });

  it("clears one connection on demand", () => {
    markKiroCapped("conn-g", Date.now() + 5 * DAY);
    clearKiroCap("conn-g");
    expect(shouldSkipKiroAccount("conn-g").skip).toBe(false);
  });
});

describe("wiring", () => {
  const auth = read("../src/sse/services/auth.js");
  const usageSvc = read("../open-sse/services/usage.js");

  it("auth.js consults the cache while filtering accounts", () => {
    expect(auth).toContain("shouldSkipKiroAccount(c.id)");
  });

  it("auth.js records the cap when a 402 arrives", () => {
    expect(auth).toContain("markKiroCapped(connectionId");
  });

  it("the usage service feeds the cache from the tracker reading", () => {
    expect(usageSvc).toContain("recordKiroUsage(connection.id, result)");
  });

  it("the cache check runs inside the account filter", () => {
    // Must sit next to isModelLockActive: that filter decides which accounts are
    // eligible, so a capped account never reaches the upstream call.
    const filterStart = auth.indexOf("const availableConnections = connections.filter");
    const cacheIdx = auth.indexOf("shouldSkipKiroAccount(c.id)");
    const lockIdx = auth.indexOf("isModelLockActive(c, model)", filterStart);
    expect(filterStart).toBeGreaterThan(-1);
    expect(cacheIdx).toBeGreaterThan(filterStart);
    expect(cacheIdx).toBeGreaterThan(lockIdx);
  });
});
