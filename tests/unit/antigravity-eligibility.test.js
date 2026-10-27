// Antigravity account eligibility (VALIDATION_REQUIRED).
//
// Live MITM capture of the official CLI 1.4.8 (2026-10-27, account
// ayuantini63) proved two things:
//
//   1. The gate is announced in `ineligibleTiers` of the loadCodeAssist
//      response (HTTP 200) and in `error.details[].reason` of the
//      retrieveUserQuotaSummary 403.
//   2. The official CLI STOPS there — generateAssistantResponse was never
//      sent. PanRouter ignored `ineligibleTiers` entirely, so a flagged
//      account kept serving traffic.
//
// The fix parses the verdict, caches it per connection, and skips the account
// BEFORE the request goes out.
import { describe, expect, it, beforeEach } from "vitest";
import {
  parseAntigravityEligibility,
  parseAntigravityQuotaEligibility,
} from "../../open-sse/services/usage/google.js";
import { makeKv } from "../../src/lib/db/helpers/kvStore.js";
import {
  shouldSkipAntigravityAccount,
  recordAntigravityEligibility,
  getAntigravityIneligibility,
  clearAntigravityIneligible,
  getAntigravityIneligibleCache,
} from "../../open-sse/services/antigravityCapCache.js";

// Verbatim loadCodeAssist body from the capture (trimmed to the fields that matter).
const LOAD_CODE_ASSIST_INELIGIBLE = {
  allowedTiers: [{ id: "standard-tier", name: "Antigravity", isDefault: true }],
  ineligibleTiers: [
    {
      reasonCode: "VALIDATION_REQUIRED",
      reasonMessage: "Your current account is not eligible for Antigravity. Verify your account to continue.",
      tierId: "free-tier",
      tierName: "Antigravity",
      validationErrorMessage: "Verify your account to continue.",
      validationUrlLinkText: "Verify your account",
      validationUrl: "https://accounts.google.com/v3/signin/continue?plt=AKgnsbvTD4FFF&authuser",
      validationLearnMoreLinkText: "Learn more",
      validationLearnMoreUrl: "https://support.google.com/accounts?p=al_alert",
    },
  ],
};

const LOAD_CODE_ASSIST_OK = {
  allowedTiers: [{ id: "standard-tier", name: "Antigravity", isDefault: true }],
  ineligibleTiers: [],
};

const QUOTA_403 = {
  error: {
    code: 403,
    message: "Verify your account to continue.",
    status: "PERMISSION_DENIED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "VALIDATION_REQUIRED",
        domain: "cloudcode-pa.googleapis.com",
        metadata: {
          validation_url: "https://accounts.google.com/v3/signin/continue?plt=AKgnsbtskJPrTr0E&authuser",
          validation_learn_more_link_text: "Learn more",
          validation_learn_more_url: "https://support.google.com/accounts?p=al_alert",
          validation_error_message: "Verify your account to continue.",
          validation_url_link_text: "Verify your account",
        },
      },
      {
        "@type": "type.googleapis.com/google.rpc.Help",
        links: [
          { description: "Verify your account", url: "https://accounts.google.com/v3/signin/continue?plt=AKgnsbtskJPrTr0E&authuser" },
          { description: "Learn more", url: "https://support.google.com/accounts?p=al_alert" },
        ],
      },
    ],
  },
};

describe("parseAntigravityEligibility — loadCodeAssist", () => {
  it("reads the VALIDATION_REQUIRED verdict", () => {
    const e = parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE);
    expect(e.eligible).toBe(false);
    expect(e.reasonCode).toBe("VALIDATION_REQUIRED");
  });

  it("carries the validation URL so the operator can act on it", () => {
    const e = parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE);
    expect(e.validationUrl).toContain("accounts.google.com");
    expect(e.validationUrl).toContain("authuser");
  });

  it("keeps the tier id and the human message", () => {
    const e = parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE);
    expect(e.tierId).toBe("free-tier");
    expect(e.reasonMessage).toContain("not eligible for Antigravity");
  });

  it("reports a healthy account as eligible", () => {
    const e = parseAntigravityEligibility(LOAD_CODE_ASSIST_OK);
    expect(e.eligible).toBe(true);
    expect(e.reasonCode).toBeNull();
  });

  it("returns null when the payload says nothing about eligibility", () => {
    expect(parseAntigravityEligibility({})).toBeNull();
    expect(parseAntigravityEligibility(null)).toBeNull();
  });
});

describe("parseAntigravityQuotaEligibility — retrieveUserQuotaSummary 403", () => {
  it("reads the reason code from error.details", () => {
    const e = parseAntigravityQuotaEligibility(QUOTA_403);
    expect(e.eligible).toBe(false);
    expect(e.reasonCode).toBe("VALIDATION_REQUIRED");
  });

  it("reads the validation URL from the metadata", () => {
    const e = parseAntigravityQuotaEligibility(QUOTA_403);
    expect(e.validationUrl).toContain("accounts.google.com");
  });

  it("falls back to the Help link when metadata has no url", () => {
    const noMeta = {
      error: {
        code: 403,
        details: [
          { "@type": ".../Help", links: [{ url: "https://accounts.google.com/x" }] },
        ],
      },
    };
    expect(parseAntigravityQuotaEligibility(noMeta).validationUrl).toBe("https://accounts.google.com/x");
  });

  it("returns null for a plain 403 without eligibility details", () => {
    expect(parseAntigravityQuotaEligibility({ error: { code: 403, message: "forbidden" } })).toBeNull();
    expect(parseAntigravityQuotaEligibility(null)).toBeNull();
  });
});

describe("antigravity eligibility cache", () => {
  beforeEach(() => {
    getAntigravityIneligibleCache().clear();
  });

  it("a fresh account is not skipped", () => {
    expect(shouldSkipAntigravityAccount("conn-1")).toBe(false);
  });

  it("a flagged account IS skipped", async () => {
    await recordAntigravityEligibility("conn-1", parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE));
    expect(shouldSkipAntigravityAccount("conn-1")).toBe(true);
  });

  it("the skip is per connection", async () => {
    await recordAntigravityEligibility("conn-1", parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE));
    expect(shouldSkipAntigravityAccount("conn-2")).toBe(false);
  });

  it("exposes the reason and the verification URL", async () => {
    await recordAntigravityEligibility("conn-1", parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE));
    const info = getAntigravityIneligibility("conn-1");
    expect(info.reasonCode).toBe("VALIDATION_REQUIRED");
    expect(info.validationUrl).toContain("accounts.google.com");
  });

  it("a healthy reading clears the flag", async () => {
    await recordAntigravityEligibility("conn-1", parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE));
    expect(shouldSkipAntigravityAccount("conn-1")).toBe(true);
    await recordAntigravityEligibility("conn-1", parseAntigravityEligibility(LOAD_CODE_ASSIST_OK));
    expect(shouldSkipAntigravityAccount("conn-1")).toBe(false);
  });

  it("a failed probe clears the flag too (fail-open)", async () => {
    await recordAntigravityEligibility("conn-1", parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE));
    await recordAntigravityEligibility("conn-1", null);
    expect(shouldSkipAntigravityAccount("conn-1")).toBe(false);
  });

  it("a healthy reading clears a PERSISTED flag even with an empty in-memory cache", async () => {
    // Regression: after a restart the in-memory map is empty while the KV
    // entry is still there. The old code only removed the KV entry when the
    // in-memory cache held the flag, so the persisted flag survived until the
    // TTL expired — the account stayed skipped after the user had verified it.
    const kv = makeKv("antigravity_ineligible");
    await kv.set("conn-2", { flagged: true, flaggedAt: Date.now(), reasonCode: "VALIDATION_REQUIRED" });

    // Fresh module state: nothing in memory.
    getAntigravityIneligibleCache().clear();
    expect(shouldSkipAntigravityAccount("conn-2")).toBe(false);

    // A healthy reading must remove the persisted entry.
    await recordAntigravityEligibility("conn-2", parseAntigravityEligibility(LOAD_CODE_ASSIST_OK));

    const persisted = await kv.get("conn-2");
    expect(persisted).toBeFalsy();
  });

  it("the manual release clears the flag", async () => {
    await recordAntigravityEligibility("conn-1", parseAntigravityEligibility(LOAD_CODE_ASSIST_INELIGIBLE));
    await clearAntigravityIneligible("conn-1");
    expect(shouldSkipAntigravityAccount("conn-1")).toBe(false);
  });
});
