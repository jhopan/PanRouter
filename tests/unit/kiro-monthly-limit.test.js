// Kiro's monthly cap must park the account until it actually resets.
//
// Field log:
//
//   [AUTH] Adelia locked modelLock_claude-sonnet-4.5-thinking-agentic for 120s [402]
//   ❌ kiro [402]: {"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"}
//
// The message contains neither "quota" nor "limit reached" in a form the signal
// list knew, so isQuotaExhaustedError returned false. auth.js then fell through
// to the generic 402 cooldown (120s) and the router retried a monthly-capped
// account every two minutes forever.
//
// Kiro already declares scope MONTHLY + a usage API that reports `nextDateReset`,
// so the fix is to classify the refusal as quota-class and let the existing
// resolver read the real reset time.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { isQuotaExhaustedError, quotaWindowFor, QUOTA_SCOPES } from "../../open-sse/config/quotaWindows.js";

const KIRO_402 = JSON.stringify({
  message: "You have reached the limit.",
  reason: "MONTHLY_REQUEST_COUNT",
});

describe("kiro — monthly request count", () => {
  it("is classified as an exhausted quota", () => {
    expect(isQuotaExhaustedError(KIRO_402)).toBe(true);
  });

  it("detects the reason code alone", () => {
    expect(isQuotaExhaustedError('{"reason":"MONTHLY_REQUEST_COUNT"}')).toBe(true);
  });

  it("detects the bare message", () => {
    expect(isQuotaExhaustedError("You have reached the limit.")).toBe(true);
  });

  it("declares a MONTHLY scope so the calendar fallback is the 1st", () => {
    expect(quotaWindowFor("kiro").scope).toBe(QUOTA_SCOPES.MONTHLY);
  });

  it("allows a cooldown long enough to cover a month", () => {
    // A 30-minute burst ceiling would re-select the account the same day.
    const dayMs = 24 * 60 * 60 * 1000;
    expect(quotaWindowFor("kiro").maxCooldownMs).toBeGreaterThan(27 * dayMs);
  });
});

describe("must NOT swallow other 402s", () => {
  it("a generic payment-required error stays a short cooldown", () => {
    expect(isQuotaExhaustedError("Payment required")).toBe(false);
  });

  it("a spending-limit style 402 without a monthly reason is not monthly", () => {
    expect(isQuotaExhaustedError("spending limit reached")).toBe(false);
  });
});

describe("account-level lock for account-wide caps", () => {
  const auth = fs.readFileSync(path.resolve("../src/sse/services/auth.js"), "utf8");

  it("locks the whole account, not just the model", () => {
    // MONTHLY_REQUEST_COUNT refuses every model on the account; a model-level
    // lock let the router retry the same capped account on the next model.
    expect(auth).toContain("kiroMonthly");
    expect(auth).toMatch(/githubResetAtMs \|\| kiroMonthly\) \? null : model/);
  });

  it("only triggers for kiro with the monthly signature", () => {
    expect(auth).toMatch(/resolveProviderId\(provider\) === "kiro"/);
    expect(auth).toMatch(/monthly_request_count\|you have reached the limit/i);
  });
});
