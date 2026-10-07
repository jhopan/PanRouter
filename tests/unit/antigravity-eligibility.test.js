import { describe, expect, it } from "vitest";
import { parseEligibility, eligibilityFromUsage } from "../../open-sse/services/usage/google.js";

const ELIGIBLE_PAYLOAD = {
  currentTier: { id: "free-tier", name: "Antigravity" },
  allowedTiers: [],
  cloudaicompanionProject: { id: "proj-1" },
};

const INELIGIBLE_PAYLOAD = {
  allowedTiers: [],
  ineligibleTiers: [
    {
      tierId: "free-tier",
      tierName: "Antigravity",
      reasonCode: "VALIDATION_REQUIRED",
      reasonMessage: "Your current account is not eligible for Antigravity. Verify your account to continue.",
      validationUrl: "https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&plt=AKgnsbs1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNPQRSTUVWXYZ&flowName=GlifWebSignIn&authuser",
      validationLearnMoreUrl: "https://support.google.com/accounts?p=al_alert",
    },
  ],
};

describe("parseEligibility", () => {
  it("marks eligible when ineligibleTiers is absent", () => {
    expect(parseEligibility(ELIGIBLE_PAYLOAD)).toEqual({ eligible: true });
  });

  it("marks ineligible with full reason + complete validationUrl", () => {
    const info = parseEligibility(INELIGIBLE_PAYLOAD);
    expect(info.eligible).toBe(false);
    expect(info.reasonCode).toBe("VALIDATION_REQUIRED");
    expect(info.reasonMessage).toContain("Verify your account");
    expect(info.validationUrl).toContain("accounts.google.com/signin/continue");
    // FULL URL — must not be truncated
    expect(info.validationUrl).toContain("flowName=GlifWebSignIn&authuser");
    expect(info.validationUrl.length).toBeGreaterThan(200);
  });

  it("fails open (eligible) on junk payloads", () => {
    expect(parseEligibility(null)).toEqual({ eligible: true });
    expect(parseEligibility(undefined)).toEqual({ eligible: true });
    expect(parseEligibility({})).toEqual({ eligible: true });
    expect(parseEligibility({ ineligibleTiers: [] })).toEqual({ eligible: true });
  });
});

describe("eligibilityFromUsage", () => {
  it("reads from a fetched usage object without extra network", () => {
    const usage = { subscriptionInfo: INELIGIBLE_PAYLOAD, quotas: {} };
    expect(eligibilityFromUsage(usage).eligible).toBe(false);
    const usage2 = { subscriptionInfo: ELIGIBLE_PAYLOAD };
    expect(eligibilityFromUsage(usage2).eligible).toBe(true);
    expect(eligibilityFromUsage({}).eligible).toBe(true);
  });
});