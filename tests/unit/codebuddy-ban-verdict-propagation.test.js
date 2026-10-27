// A CodeBuddy 403 "request illegal" must ban the ACCOUNT for 30 days.
//
// Field log (2026-10-27):
//   [403]: request illegal
//   [AUTH] Account 1 locked modelLock_deepseek-v4.1-flash for 120s [403]
//   → 3 accounts locked the same way → "3 accounts refused — stopping rotation"
//
// The verdict was right (the counter for consecutive bans went up, so
// `result.banned` was true) but the account was still locked PER MODEL for
// 120 seconds. The reason: `markAccountUnavailable()` had no `banned`
// parameter, so the executor's verdict never reached auth.js. auth.js then
// ran the generic text rules, which no longer had a "request illegal" entry
// (parseError handles it) — the result was the default 403 cooldown.
//
// Fix: chat.js forwards `result.banned` to markAccountUnavailable, which
// forces the account-level 30-day ban.
import { describe, expect, it, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");

const auth = read("src/sse/services/auth.js");
const chat = read("src/sse/handlers/chat.js");
const executor = read("open-sse/executors/codebuddy-intl.js");
const errorConfig = read("open-sse/config/errorConfig.js");

describe("codebuddy-intl — a 403 'request illegal' bans the account for 30 days", () => {
  it("the executor marks a code-less 'request illegal' as banned", () => {
    expect(executor).toMatch(/request illegal[\s\S]{0,400}banned: true/);
  });

  it("chat.js forwards the banned verdict to markAccountUnavailable", () => {
    // Without this the verdict never reached auth.js.
    expect(chat).toMatch(/result\.banned === true/);
  });

  it("markAccountUnavailable accepts the provider ban verdict", () => {
    expect(auth).toMatch(/providerBanned = false/);
  });

  it("a provider ban forces the 30-day account cooldown", () => {
    expect(auth).toMatch(/if \(providerBanned\)[\s\S]{0,200}BANNED_ACCOUNT_COOLDOWN_MS/);
  });

  it("a provider ban writes an ACCOUNT-level lock, not a model lock", () => {
    // buildModelLockUpdate(null) = modelLock___all.
    expect(auth).toMatch(/\(quotaExhausted \|\| githubResetAtMs \|\| kiroMonthly \|\| banned\) \? null : model/);
  });

  it("a provider ban records bannedUntil so the account is excluded from rotation", () => {
    expect(auth).toMatch(/banned \? banFields\(/);
  });

  it("the ban cooldown is 30 days", () => {
    expect(errorConfig).toMatch(/BANNED_ACCOUNT_COOLDOWN_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  });
});
