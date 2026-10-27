// A banned account must not be selected again — and it must be visible.
//
// CodeBuddy 11140 ("Your account has been restricted due to unusual activity")
// is a provider BAN, not a cooldown. The lock alone (`modelLock___all`) keeps
// the account out of rotation for 30 days, but:
//   - it is invisible in the dashboard (the account still looks active)
//   - "Test connection" still sends a request to it
//   - there is no way to tell a ban apart from a normal limit
//
// So a `bannedUntil` timestamp is written on the connection, the account is
// filtered out of the candidate list, and the dashboard shows why.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

describe("banned connection marker", () => {
  const auth = read("../src/sse/services/auth.js");

  it("records bannedUntil and the reason on the connection", () => {
    expect(auth).toMatch(/bannedUntil/);
    // The reason is written through banFields(); the field name itself lives
    // in the helper module.
    expect(auth).toMatch(/banFields\(/);
  });

  it("skips a banned connection when picking an account", () => {
    // The check must sit inside the candidate filter, next to isModelLockActive.
    expect(auth).toMatch(/isBannedConnection/);
  });

  it("does not treat an expired ban as a ban", () => {
    const mod = read("../open-sse/services/bannedAccounts.js");
    expect(mod).toMatch(/bannedUntil/);
    expect(mod).toMatch(/Date\.now\(\)/);
  });
});

describe("bannedAccounts helper", () => {
  it("exports the helpers the auth path needs", async () => {
    const mod = await import("../../open-sse/services/bannedAccounts.js");
    expect(typeof mod.isBannedConnection).toBe("function");
    expect(typeof mod.banFields).toBe("function");
    expect(typeof mod.clearBanFields).toBe("function");
  });

  it("treats a future bannedUntil as banned", async () => {
    const mod = await import("../../open-sse/services/bannedAccounts.js");
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(mod.isBannedConnection({ bannedUntil: future })).toBe(true);
  });

  it("treats a past bannedUntil as not banned", async () => {
    const mod = await import("../../open-sse/services/bannedAccounts.js");
    const past = new Date(Date.now() - 1000).toISOString();
    expect(mod.isBannedConnection({ bannedUntil: past })).toBe(false);
  });

  it("treats a connection without bannedUntil as not banned", async () => {
    const mod = await import("../../open-sse/services/bannedAccounts.js");
    expect(mod.isBannedConnection({})).toBe(false);
    expect(mod.isBannedConnection(null)).toBe(false);
  });
});
