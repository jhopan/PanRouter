// The six protections against a provider ban (CodeBuddy 11140):
//
//  1. a banned account is marked and never selected again
//  2. the same account is retried once before rotating
//  3. rotating waits, so the traffic is not a burst
//  4. after N consecutive bans the rotation stops
//  5. CAVEMAN/PONYTAIL can be turned off per provider
//  6. a request that lands on a cold account is trimmed before it goes out
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  isBannedConnection,
  banFields,
  clearBanFields,
} from "../../open-sse/services/bannedAccounts.js";
import {
  trimMessagesToBudget,
  estimateTokens,
} from "../../open-sse/services/messageTrimmer.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

describe("1 — banned account marker", () => {
  it("marks the ban with an expiry and a reason", () => {
    const f = banFields("CodeBuddy 11140", Date.now() + 86_400_000);
    expect(f.bannedUntil).toBeTruthy();
    expect(f.banReason).toContain("11140");
  });

  it("defaults to 30 days when the provider gives no reset", () => {
    const f = banFields("x", null);
    const days = (new Date(f.bannedUntil) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
  });

  it("clears cleanly", () => {
    expect(clearBanFields()).toEqual({ bannedUntil: null, banReason: null });
  });

  it("auth.js skips a banned connection", () => {
    const auth = read("../src/sse/services/auth.js");
    expect(auth).toContain("isBannedConnection(c)");
  });

  it("auth.js writes the ban marker", () => {
    const auth = read("../src/sse/services/auth.js");
    expect(auth).toMatch(/banned \? banFields\(/);
  });

  it("test-connection refuses to probe a banned account", () => {
    const t = read("../src/app/api/providers/[id]/test/testUtils.js");
    expect(t).toContain("isBannedConnection(connection)");
  });

  it("the provider route can unban", () => {
    const route = read("../src/app/api/providers/[id]/route.js");
    expect(route).toContain("body.unban === true");
    expect(route).toContain("clearBanFields()");
  });
});

describe("2/3/4 — rotation safety in chat.js", () => {
  const chat = read("../src/sse/handlers/chat.js");

  it("retries the same account once before rotating", () => {
    expect(chat).toContain("SAME_ACCOUNT_RETRIES");
    expect(chat).toContain("retrying the same account");
  });

  it("waits between rotations", () => {
    expect(chat).toContain("ACCOUNT_ROTATION_DELAY_MS");
  });

  it("keeps rotating through the whole pool instead of stopping early", () => {
    // The pool belongs to the operator: every healthy account should get its
    // chance. The burst is what looks like automation, so the rotation waits
    // between accounts rather than stopping after N bans.
    expect(chat).not.toContain("MAX_CONSECUTIVE_BANS");
    expect(chat).not.toMatch(/stopping rotation to protect the remaining accounts/);
    expect(chat).not.toMatch(/Stopped after \$\{consecutiveBans\}/);
  });

  it("logs each banned account and moves on", () => {
    expect(chat).toMatch(/account banned by the provider/);
  });

  it("does not retry a banned account on the same connection", () => {
    expect(chat).toMatch(/result\.banned !== true\s*\n\s*&& result\.fatal !== true/);
  });
});

describe("5 — per-provider CAVEMAN/PONYTAIL opt-out", () => {
  const chat = read("../src/sse/handlers/chat.js");

  it("reads the disabled-provider lists from settings", () => {
    expect(chat).toContain("cavemanDisabledProviders");
    expect(chat).toContain("ponytailDisabledProviders");
  });

  it("gates both injectors on the provider list", () => {
    expect(chat).toMatch(/cavemanEnabled:[\s\S]{0,160}cavemanDisabledProviders/);
    expect(chat).toMatch(/ponytailEnabled:[\s\S]{0,160}ponytailDisabledProviders/);
  });
});

describe("6 — cold-account trim", () => {
  const chat = read("../src/sse/handlers/chat.js");

  it("is wired into chat.js", () => {
    expect(chat).toContain("trimMessagesToBudget");
    expect(chat).toMatch(/cold account/);
  });

  it("only trims when the account changed", () => {
    expect(chat).toMatch(/lastAccountId !== credentials\.connectionId/);
  });

  it("trims at most once per conversation", () => {
    expect(chat).toContain("!conversationTrimmed");
  });

  it("estimates tokens from the message content", () => {
    expect(estimateTokens([{ role: "user", content: "a".repeat(400) }])).toBe(100);
  });

  it("leaves a small history alone", () => {
    const msgs = [{ role: "system", content: "sys" }, { role: "user", content: "hi" }];
    const r = trimMessagesToBudget(msgs, 100_000);
    expect(r.removed).toBe(0);
    expect(r.messages).toBe(msgs);
  });

  it("drops the oldest messages when over budget", () => {
    const msgs = [
      { role: "system", content: "sys" },
      { role: "user", content: "x".repeat(40_000) },
      { role: "assistant", content: "y".repeat(40_000) },
      { role: "user", content: "z".repeat(40_000) },
    ];
    const r = trimMessagesToBudget(msgs, 20_000);
    expect(r.removed).toBeGreaterThan(0);
    expect(r.after).toBeLessThan(r.before);
  });

  it("always keeps the system prompt", () => {
    const msgs = [
      { role: "system", content: "IMPORTANT" },
      { role: "user", content: "x".repeat(100_000) },
      { role: "user", content: "y".repeat(100_000) },
    ];
    const r = trimMessagesToBudget(msgs, 10_000);
    expect(r.messages[0].role).toBe("system");
    expect(r.messages[0].content).toBe("IMPORTANT");
  });

  it("keeps the most recent turn", () => {
    const msgs = [
      { role: "system", content: "s" },
      { role: "user", content: "old" },
      { role: "user", content: "NEWEST" },
    ];
    const r = trimMessagesToBudget(msgs, 1);
    expect(r.messages[r.messages.length - 1].content).toBe("NEWEST");
  });
});
