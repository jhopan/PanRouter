import { describe, expect, it } from "vitest";
import { formatEligibilityLog } from "../../open-sse/services/usage/google.js";

describe("Antigravity eligibility console log", () => {
  it("prints the complete validation URL in a copyable JSON block", () => {
    const url = "https://accounts.google.com/signin/continue?plt=one-time-token&flowName=GlifWebSignIn";

    expect(formatEligibilityLog({
      reasonCode: "VALIDATION_REQUIRED",
      validationUrl: url,
    })).toBe(JSON.stringify({
      eligibility: {
        eligible: false,
        reasonCode: "VALIDATION_REQUIRED",
        validationUrl: url,
      },
    }, null, 2));
  });
});
