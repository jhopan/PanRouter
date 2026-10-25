// Qoder code 112 ("pricingUrl") is a billing refusal — the account must buy
// credits. It carries no "quota" word, so it fell through to the generic
// backoff and the model was locked only 120s, letting the router retry a
// paying-required account every two minutes.
import { describe, expect, it } from "vitest";
import { isQuotaExhaustedError } from "../../open-sse/config/quotaWindows.js";

// Exact shape from the log (three nested stringified JSON envelopes).
const QODER_112 = JSON.stringify({
  error: {
    message: JSON.stringify({
      code: "112",
      message: JSON.stringify({ pricingUrl: "https://qoder.com/pricing?client=qoder" }),
    }),
    code: 403,
  },
});

describe("qoder — 112 billing refusal", () => {
  it("is classified as an exhausted quota", () => {
    expect(isQuotaExhaustedError(QODER_112)).toBe(true);
  });

  it("detects the pricingUrl alone", () => {
    expect(isQuotaExhaustedError('{"pricingUrl":"https://qoder.com/pricing"}')).toBe(true);
  });

  it("detects code 110 (daily count)", () => {
    expect(isQuotaExhaustedError('{"code":"110"}')).toBe(true);
  });
});

describe("qoder — must NOT be misread as quota", () => {
  it("10605 admission queue is a throttle, not billing", () => {
    expect(isQuotaExhaustedError(JSON.stringify({ isQueued: true, code: "10605" }))).toBe(false);
  });

  it("a frequency limit stays a burst throttle", () => {
    expect(isQuotaExhaustedError("usage exceeds frequency limit, will reset at 2026-10-19 15:00:56")).toBe(false);
  });

  it("a site-wide capacity limit is not personal quota", () => {
    expect(isQuotaExhaustedError("free_global_rate_limited site-wide capacity full")).toBe(false);
  });
});

describe("regression — other providers unaffected", () => {
  it("still detects a plain daily limit", () => {
    expect(isQuotaExhaustedError("daily free limit reached")).toBe(true);
  });

  it("does not fire on an unrelated 403", () => {
    expect(isQuotaExhaustedError("request illegal")).toBe(false);
  });
});
