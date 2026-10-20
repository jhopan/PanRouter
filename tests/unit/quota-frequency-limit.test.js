// A per-model FREQUENCY limit must not be classified as quota exhaustion.
//
// CodeBuddy 6004 says: "usage exceeds frequency limit, but don't worry, your
// usage will reset at 2026-10-19 15:00:56". The message contains the word
// "limit", and the generic signal list has entries like "daily limit" — but a
// frequency throttle reopens in minutes and only affects one model. Treating it
// as quota parked the account on the provider's MONTHLY calendar (the 1st of the
// next month, e.g. 2026-10-31T16:59:59Z = 2026-11-01 00:00 WIB) even though the
// account kept serving other models fine.
import { describe, expect, it } from "vitest";
import {
  isQuotaExhaustedError,
  calendarResetMs,
  QUOTA_SCOPES,
  quotaWindowFor,
} from "../../open-sse/config/quotaWindows.js";

describe("isQuotaExhaustedError — frequency limits are NOT quota", () => {
  it("rejects the CodeBuddy 6004 frequency-limit message", () => {
    const msg =
      "usage exceeds frequency limit, but don't worry, your usage will reset at 2026-10-19 15:00:56 (reset after 12m 22s)";
    expect(isQuotaExhaustedError(msg)).toBe(false);
  });

  it("rejects generic rate-limit wording", () => {
    expect(isQuotaExhaustedError("429 Too Many Requests")).toBe(false);
    expect(isQuotaExhaustedError("rate limit exceeded")).toBe(false);
    expect(isQuotaExhaustedError("request rate-limited, retry shortly")).toBe(false);
    expect(isQuotaExhaustedError("请求过于频繁")).toBe(false);
  });

  it("rejects a message that mentions quota AND frequency", () => {
    // Guard ordering: the frequency check must win over the generic signals.
    expect(isQuotaExhaustedError("quota will reset, but you hit a frequency limit")).toBe(false);
  });

  it("still detects real quota refusals", () => {
    expect(isQuotaExhaustedError("Credits exhausted. Please visit ...")).toBe(true);
    expect(isQuotaExhaustedError("daily free limit reached")).toBe(true);
    expect(isQuotaExhaustedError("weekly quota exceeded")).toBe(true);
    expect(isQuotaExhaustedError("quota exhausted")).toBe(true);
    expect(isQuotaExhaustedError("Individual quota reached. Resets in 74h19m34s.")).toBe(true);
  });

  it("returns false for empty input", () => {
    expect(isQuotaExhaustedError("")).toBe(false);
    expect(isQuotaExhaustedError(null)).toBe(false);
    expect(isQuotaExhaustedError(undefined)).toBe(false);
  });
});

describe("calendarResetMs — monthly fallback is the far end", () => {
  it("monthly lands on the 1st of the next month (the date that looked wrong)", () => {
    // 2026-10-20 05:56 UTC -> 2026-11-01T00:00:00Z
    const now = Date.UTC(2026, 9, 20, 5, 56, 0);
    const reset = calendarResetMs(QUOTA_SCOPES.MONTHLY, quotaWindowFor("codebuddy-intl"), now);
    expect(new Date(reset).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    // Which is exactly 2026-10-31T16:59:59Z in WIB terms — the suspicious date.
    expect(new Date(reset - 1).toISOString()).toBe("2026-10-31T23:59:59.999Z");
  });
});
