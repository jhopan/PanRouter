// The dashboard countdown must pick the LAST live lock, and must fall back to
// the quota-exhaustion date.
//
// Real records from the database:
//
//   codex          modelLock_gpt-5.6-terra-review = 2026-10-28T17:28:23Z
//                  quotaExhaustedUntil            = 2026-10-28T17:28:23Z
//                  → shows "⏱ 499h 20m  Quota exhausted — resets 2026-10-28..."
//
//   codebuddy-intl modelLock_deepseek-v4.1-flash = 2026-10-26T17:45:35Z  (expired)
//                  modelLock_kimi-k3               = 2026-10-26T17:45:35Z  (expired)
//                  modelLock_default-model        = 2026-10-26T17:45:35Z  (expired)
//                  modelLock_fast-model           = 2026-10-26T17:45:35Z  (expired)
//                  → all expired: NO countdown, and the account is not parked
//
// The old code used `sort()[0]`, i.e. the EARLIEST lock, expired ones
// included. With one expired lock and one live lock the expired one won and
// the countdown vanished.
import { describe, expect, it } from "vitest";
import { getCooldownUntil, formatCooldownRemaining } from "../../src/shared/utils/cooldown.js";

const NOW = Date.parse("2026-10-27T05:00:00.000Z");

describe("getCooldownUntil", () => {
  it("returns the single live lock", () => {
    const conn = { "modelLock_gpt-5.6-terra-review": "2026-10-28T17:28:23.000Z" };
    expect(getCooldownUntil(conn, NOW)).toBe("2026-10-28T17:28:23.000Z");
  });

  it("picks the LAST live lock, not the earliest", () => {
    const conn = {
      modelLock_a: "2026-10-28T17:00:00.000Z",
      modelLock_b: "2026-11-01T00:00:00.000Z",
    };
    expect(getCooldownUntil(conn, NOW)).toBe("2026-11-01T00:00:00.000Z");
  });

  it("ignores locks that already expired", () => {
    const conn = {
      modelLock_expired: "2026-10-26T17:45:35.166Z",
      modelLock_live: "2026-11-01T00:00:00.000Z",
    };
    expect(getCooldownUntil(conn, NOW)).toBe("2026-11-01T00:00:00.000Z");
  });

  it("returns null when every lock has expired", () => {
    const conn = {
      modelLock_deepseek: "2026-10-26T17:45:35.166Z",
      modelLock_kimi: "2026-10-26T17:45:35.166Z",
    };
    expect(getCooldownUntil(conn, NOW)).toBeNull();
  });

  it("uses quotaExhaustedUntil when there is no model lock", () => {
    // A quota park may carry only the quota date — Codex and Kiro do.
    const conn = { quotaExhaustedUntil: "2026-11-01T00:00:00.000Z" };
    expect(getCooldownUntil(conn, NOW)).toBe("2026-11-01T00:00:00.000Z");
  });

  it("takes the later of the lock and the quota date", () => {
    const conn = {
      modelLock_a: "2026-10-28T00:00:00.000Z",
      quotaExhaustedUntil: "2026-11-01T00:00:00.000Z",
    };
    expect(getCooldownUntil(conn, NOW)).toBe("2026-11-01T00:00:00.000Z");
  });

  it("ignores an expired quota date", () => {
    const conn = { quotaExhaustedUntil: "2026-10-01T00:00:00.000Z" };
    expect(getCooldownUntil(conn, NOW)).toBeNull();
  });

  it("handles a null connection", () => {
    expect(getCooldownUntil(null, NOW)).toBeNull();
  });
});

describe("formatCooldownRemaining", () => {
  it("renders hours and minutes for a multi-day wait", () => {
    const until = "2026-11-01T00:00:00.000Z";
    const rem = formatCooldownRemaining(until, NOW);
    expect(rem).toMatch(/^\d+h \d+m$/);
  });

  it("renders minutes and seconds for a short wait", () => {
    const until = new Date(NOW + 5 * 60 * 1000 + 30 * 1000).toISOString();
    expect(formatCooldownRemaining(until, NOW)).toBe("5m 30s");
  });

  it("renders seconds for a very short wait", () => {
    const until = new Date(NOW + 42 * 1000).toISOString();
    expect(formatCooldownRemaining(until, NOW)).toBe("42s");
  });

  it("returns an empty string once the time has passed", () => {
    expect(formatCooldownRemaining("2026-10-01T00:00:00.000Z", NOW)).toBe("");
  });
});
