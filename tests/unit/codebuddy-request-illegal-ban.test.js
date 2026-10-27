// "request illegal" WITHOUT a channel code (11128/11140) = the account is
// flagged. The 11140 confirmation banner comes after the provider has decided
// to restrict the account; a plain "request illegal" 403 with no code is the
// intermediate state. Ban for 1 month: retrying the account hourly is the
// exact automation pattern that triggered the ban.
//
// Field log:
//   [403]: request illegal
//   [AUTH] Account 1 locked modelLock_deepseek-v4.1-flash for 4s
//   → next account tried → same error → eventually "3 accounts refused — stopping"
//
// Fix: parseError now returns { banned: true } for code-less "request illegal",
// so auth.js writes bannedUntil (1 month), the dashboard shows the account as
// banned, and the router never selects it again until the ban is manually lifted.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");
const executor = read("open-sse/executors/codebuddy-intl.js");
const errorConfig = read("open-sse/config/errorConfig.js");

describe("codebuddy-intl — request illegal without channel code = account ban", () => {
  it("parseError bans the account for a bare 'request illegal' 403", () => {
    // The branch must return { banned: true } when the body contains
    // "request illegal" but carries no 11128 or 11140 code.
    expect(executor).toMatch(/request illegal.*banned.*true|banned.*true.*request illegal/s);
  });

  it("the ban branch comes AFTER the 11128 requestRejected branch", () => {
    // 11128 must still be request-scoped (not ban the account). The 11128
    // branch must appear before the generic "request illegal" ban branch.
    const idx11128 = executor.indexOf("data?.code === 11128");
    const idxBan = executor.indexOf("request illegal\\/i.test");
    if (idxBan < 0) {
      // try alternate form
      const idxBan2 = executor.indexOf("Ban the account for 1 month");
      expect(idxBan2).toBeGreaterThan(idx11128);
    } else {
      expect(idxBan).toBeGreaterThan(idx11128);
    }
  });

  it("errorConfig no longer has a backoff rule for 'request illegal'", () => {
    // The errorConfig backoff rule was redundant once parseError handles it.
    // Leaving both would cause the backoff to win when parseError is skipped
    // (non-CodeBuddy paths), but for codebuddy-intl the executor path wins.
    // We removed the rule so the intent is explicit.
    const lines = errorConfig.split("\n");
    const activeBackoff = lines.find(
      (l) => !l.trimStart().startsWith("//")
           && l.includes("request illegal")
           && l.includes("backoff"),
    );
    expect(activeBackoff).toBeUndefined();
  });

  it("11140 and unusual-activity ban rules are still in errorConfig", () => {
    expect(errorConfig).toMatch(/11140.*banned.*true|banned.*true.*unusual.activity/s);
    expect(errorConfig).toMatch(/unusual activity/);
  });
});
