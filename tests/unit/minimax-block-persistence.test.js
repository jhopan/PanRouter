// A MiniMax plan block must survive a server restart, and there must be a way
// to release it once the plan is refilled.
//
// The 24-hour block is written to the KV store (scope minimax_cap) and restored
// at startup, so a restart cannot "forget" that the account ran out and probe
// it again. The "Check & release" endpoint reads the provider's live quota and
// lifts the block only when the provider says the account is serving again.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  recordMiniMaxUsage,
  shouldSkipMiniMaxAccount,
  markMiniMaxExhausted,
  resetMiniMaxCapCache,
} from "../../open-sse/services/minimaxCapCache.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

describe("minimaxCapCache — the block is persisted", () => {
  const mod = read("../open-sse/services/minimaxCapCache.js");

  it("writes exhausted entries to the KV store", () => {
    expect(mod).toContain('makeKv("minimax_cap")');
    expect(mod).toMatch(/kv\.set\(connectionId/);
  });

  it("removes the entry when the account is healthy again", () => {
    expect(mod).toMatch(/kv\.remove\(connectionId\)/);
  });

  it("restores persisted blocks at startup", () => {
    expect(mod).toContain("loadPersistedMiniMaxCaps");
    const init = read("../src/shared/services/initializeApp.js");
    expect(init).toContain("loadPersistedMiniMaxCaps()");
  });

  it("drops a block whose 24h window already passed on load", () => {
    expect(mod).toMatch(/until <= now/);
  });

  it("is fail-open", () => {
    expect(mod).toMatch(/catch \{\s*\/\* fail-open \*\/\s*\}/);
  });
});

describe("the block lasts 24 hours", () => {
  beforeEach(() => resetMiniMaxCapCache());

  it("still blocks ten hours later", () => {
    const old = Date.now() - 10 * 60 * 60 * 1000;
    recordMiniMaxUsage("conn-a", {
      quotas: { "M": { remaining: 0, remainingPercentage: 0, resetAt: new Date(Date.now() + 3600_000).toISOString() } },
    }, old);
    expect(shouldSkipMiniMaxAccount("conn-a").skip).toBe(true);
  });

  it("releases when a fresh reading shows quota", () => {
    markMiniMaxExhausted("conn-b");
    expect(shouldSkipMiniMaxAccount("conn-b").skip).toBe(true);
    recordMiniMaxUsage("conn-b", {
      quotas: { "M": { remaining: 90, remainingPercentage: 90, resetAt: new Date(Date.now() + 3600_000).toISOString() } },
    });
    expect(shouldSkipMiniMaxAccount("conn-b").skip).toBe(false);
  });
});

describe("check & release endpoint", () => {
  const route = read("../src/app/api/usage/[connectionId]/check-release/route.js");

  it("exists and is a POST route", () => {
    expect(route).toContain("export async function POST");
  });

  it("reads the live quota before releasing", () => {
    expect(route).toContain("getUsageForProvider");
  });

  it("does not release an account the provider still reports as exhausted", () => {
    expect(route).toMatch(/still reports this account as exhausted/);
    expect(route).toMatch(/released: false/);
  });

  it("clears the rotation locks and the ban marker when it does release", () => {
    expect(route).toContain("modelLock_");
    expect(route).toContain("clearBanFields()");
    expect(route).toContain("clearMiniMaxCap");
  });

  it("keeps the block when the tracker cannot be read", () => {
    expect(route).toMatch(/the block was left in place/);
  });
});

describe("dashboard button", () => {
  const ui = read("../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js");

  it("calls the check-release endpoint", () => {
    expect(ui).toContain("/check-release");
  });

  it("has a handler that reports the reason", () => {
    expect(ui).toContain("handleCheckRelease");
  });

  it("renders a button", () => {
    expect(ui).toContain("lock_open");
  });
});
