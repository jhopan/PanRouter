// A CodeBuddy 403 "request illegal" must:
//   1. ban that account for 30 days (not just a short model lock)
//   2. keep rotating through the WHOLE pool — the operator's pool is theirs,
//      every healthy account should get its chance
//   3. wait between rotations so the burst does not look like automation
//
// Field log (2026-10-27, before the fix):
//   [AUTH] Account 1 BANNED by provider until 2026-11-26T23:42:34.509Z
//   [AUTH] Account 2 BANNED by provider until 2026-11-26T23:42:34.711Z
//   [AUTH] Account 3 BANNED by provider until 2026-11-26T23:42:38.921Z
//   [CHAT] 3 accounts refused by the provider — stopping rotation to protect
//          the remaining accounts
//
// The ban worked. The stop-after-3 did not: the request failed even though
// more healthy accounts were available in the pool.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");

const chat = read("src/sse/handlers/chat.js");

describe("codebuddy-intl — banned accounts do not end the rotation", () => {
  it("does not stop after N bans", () => {
    expect(chat).not.toContain("MAX_CONSECUTIVE_BANS");
    expect(chat).not.toMatch(/stopping rotation/);
    expect(chat).not.toMatch(/Stopped after/);
  });

  it("still bans the account", () => {
    expect(chat).toMatch(/result\.banned === true/);
  });

  it("waits 3 seconds between rotations", () => {
    expect(chat).toMatch(/ACCOUNT_ROTATION_DELAY_MS = 3000/);
  });

  it("keeps the counter for the log line", () => {
    // The counter is still useful — it tells the operator how many accounts
    // were refused in this rotation.
    expect(chat).toMatch(/consecutiveBans \+= 1/);
    expect(chat).toMatch(/account banned by the provider/);
  });

  it("excludes the banned account from the next round", () => {
    expect(chat).toMatch(/excludeConnectionIds\.add\(credentials\.connectionId\)/);
  });

  it("does not retry a banned account on the same connection", () => {
    // The same-account retry is skipped when the provider banned the account.
    expect(chat).toMatch(/result\.banned !== true\s*\n\s*&& result\.fatal !== true/);
  });
});
