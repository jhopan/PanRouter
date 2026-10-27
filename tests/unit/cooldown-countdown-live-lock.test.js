// The dashboard must show a countdown for a quota-parked account, the way it
// does for Codex:
//
//   ⏱ 499h 20m   Quota exhausted — resets 2026-11-17T02:43:32.000Z
//
// Bug: ConnectionsCard picked the lock with `sort()[0]` — the EARLIEST one —
// including locks that had already expired. With an expired lock plus a live
// one, the earliest is the expired one, `new Date(until) - Date.now()` goes
// negative, CooldownTimer renders nothing, and the account looks parked with
// no indication of when it frees up.
//
// Kiro parks with an ACCOUNT-level lock (`modelLock___all`) and a
// `quotaExhaustedUntil`, so both have to feed the countdown.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");

const card = read("src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js");
const row = read("src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js");
const helper = read("src/shared/utils/cooldown.js");

describe("connections card — the cooldown countdown comes from the shared helper", () => {
  it("uses the shared resolver instead of an inline sort", () => {
    expect(card).toMatch(/getCooldownUntil/);
  });

  it("renders the countdown next to the error text", () => {
    expect(card).toMatch(/<CooldownTimer\s+until=/);
  });
});

describe("provider detail row — same countdown behaviour", () => {
  it("uses the shared resolver", () => {
    expect(row).toMatch(/getCooldownUntil/);
  });
});

describe("the shared resolver", () => {
  it("ignores locks that already expired", () => {
    expect(helper).toMatch(/ms > now/);
  });

  it("takes the latest candidate, not the earliest", () => {
    expect(helper).toMatch(/Math\.max\(\.\.\.candidates\)/);
  });

  it("falls back to quotaExhaustedUntil for a quota park", () => {
    expect(helper).toMatch(/quotaExhaustedUntil/);
  });

  it("formats the remaining time the way the dashboard shows it", () => {
    expect(helper).toMatch(/formatCooldownRemaining/);
  });
});
