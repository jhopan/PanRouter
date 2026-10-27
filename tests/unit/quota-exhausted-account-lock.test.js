// A quota-exhausted account must be locked at the ACCOUNT level (modelLock___all),
// not the model level (modelLock_<model>).
//
// Field evidence:
//   Codex 429 quota → auth.js wrote modelLock_gpt-5.6-terra-review
//   Kiro  402 quota → auth.js wrote modelLock___all (already correct)
//
// The difference: the lockUpdate condition was
//   (githubResetAtMs || kiroMonthly || banned)
// which left out plain quotaExhausted. Codex, Cline, TokenHarbor etc. all
// get a per-model lock, so the router tries other models on the same drained
// account — each burns a real request and returns another 429.
//
// Fix: add `quotaExhausted` to the account-level condition.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const auth = fs.readFileSync(path.resolve("../src/sse/services/auth.js"), "utf8");

describe("auth.js — quota-exhausted account is locked at account level", () => {
  it("includes quotaExhausted in the account-level lock condition", () => {
    // The condition that produces modelLock___all (null model arg) must
    // include `quotaExhausted` so Codex / Cline / TokenHarbor are not locked
    // per-model only.
    expect(auth).toMatch(/\(quotaExhausted\s*\|\|\s*githubResetAtMs/);
  });

  it("still locks kiro and github monthly at account level", () => {
    expect(auth).toMatch(/kiroMonthly/);
    expect(auth).toMatch(/githubResetAtMs/);
  });

  it("still locks banned accounts at account level", () => {
    expect(auth).toMatch(/banned.*\?\s*null\s*:\s*model/);
  });

  it("keeps model-level locking for burst rate-limits", () => {
    // When none of the account-level conditions hold, the model string is
    // passed — that is the burst-rate-limit path (per-model slot).
    expect(auth).toMatch(/\?\s*null\s*:\s*model,?/);
  });
});
