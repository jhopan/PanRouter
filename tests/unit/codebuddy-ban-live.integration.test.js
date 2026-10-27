// Live check: does a CodeBuddy 403 "request illegal" really produce a 30-day
// ACCOUNT ban in the database?
//
// It creates a scratch connection named with a fixed marker, calls
// markAccountUnavailable with the provider's ban verdict, and asserts the
// record. The scratch connection is always deleted afterwards.
import { describe, it, expect, afterAll } from "vitest";
import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import { getProviderConnections, createProviderConnection, deleteProviderConnection } from "../../src/lib/localDb.js";

const MARKER = "__vitest_cb_ban__";

async function makeConn() {
  return createProviderConnection({
    provider: "codebuddy-intl",
    authType: "apikey",
    name: MARKER,
    apiKey: "sk-test-not-a-real-key",
    isActive: true,
  });
}

async function readConn(id) {
  const all = await getProviderConnections({ provider: "codebuddy-intl" });
  return all.find((c) => c.id === id);
}

afterAll(async () => {
  const all = await getProviderConnections({ provider: "codebuddy-intl" });
  for (const c of all.filter((x) => x.name === MARKER)) await deleteProviderConnection(c.id);
});

describe("codebuddy-intl — a provider ban verdict bans the account", () => {
  it("writes bannedUntil ~30 days out and an account-level lock", async () => {
    const conn = await makeConn();
    try {
      const res = await markAccountUnavailable(
        conn.id,
        403,
        "request illegal",
        "codebuddy-intl",
        "deepseek-v4.1-flash",
        null,
        true, // providerBanned — the executor's verdict
      );
      expect(res.shouldFallback).toBe(true);

      const after = await readConn(conn.id);

      // 30 days, not 120 seconds.
      expect(after.bannedUntil).toBeTruthy();
      const bannedMs = new Date(after.bannedUntil).getTime() - Date.now();
      expect(bannedMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      expect(bannedMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);

      // Account-level lock, not modelLock_<model>.
      expect(after.modelLock___all).toBeTruthy();
      expect(after.modelLock_deepseek_v4_1_flash).toBeFalsy();
      expect(after["modelLock_deepseek-v4.1-flash"]).toBeFalsy();

      // The account is off.
      expect(after.testStatus).toBe("unavailable");
      expect(after.errorCode).toBe(403);
    } finally {
      await deleteProviderConnection(conn.id);
    }
  });

  it("without the ban verdict the same error only gets the short generic lock", async () => {
    // This is the regression: the verdict was computed but never forwarded, so
    // the account ended up on a 120s per-model lock.
    const conn = await makeConn();
    try {
      await markAccountUnavailable(
        conn.id,
        403,
        "request illegal",
        "codebuddy-intl",
        "deepseek-v4.1-flash",
        null,
        false, // no provider verdict
      );
      const after = await readConn(conn.id);
      expect(after.bannedUntil).toBeFalsy();
      expect(after["modelLock_deepseek-v4.1-flash"]).toBeTruthy();
    } finally {
      await deleteProviderConnection(conn.id);
    }
  });
});
