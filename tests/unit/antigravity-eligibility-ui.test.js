// The Antigravity eligibility badge must render in the quota tracker with a
// copyable verification link, so a flagged account is identifiable at a glance
// instead of only in the logs.
//
// Live MITM capture of the official CLI 1.4.8 showed the verdict shape:
//   { eligible: false, reasonCode: "VALIDATION_REQUIRED",
//     validationUrl: "https://accounts.google.com/v3/signin/continue?..." }
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");

const badge = read("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/AntigravityEligibilityBadge.js");
const index = read("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js");
const usageRoute = read("src/app/api/usage/[connectionId]/route.js");

describe("antigravity eligibility badge", () => {
  it("shows a 'Needs verification' badge", () => {
    expect(badge).toMatch(/Needs verification/);
  });

  it("renders nothing for a healthy account", () => {
    // eligible !== false → no badge at all.
    expect(badge).toMatch(/if \(!ineligible \|\| ineligible\.eligible !== false\) return null/);
  });

  it("offers a copy button for the verification link", () => {
    expect(badge).toMatch(/content_copy/);
    expect(badge).toMatch(/onCopy/);
  });

  it("offers a direct link to open the verification page", () => {
    expect(badge).toMatch(/href=\{validationUrl\}/);
    expect(badge).toMatch(/target="_blank"/);
  });

  it("shows the reason code so the flag is identifiable", () => {
    expect(badge).toMatch(/reasonCode/);
  });
});

describe("quota tracker wiring", () => {
  it("imports the badge", () => {
    expect(index).toMatch(/import AntigravityEligibilityBadge/);
  });

  it("reads the verdict from the raw usage payload", () => {
    expect(index).toMatch(/quota\?\.raw\?\.ineligible/);
  });

  it("only shows it for the antigravity provider", () => {
    expect(index).toMatch(/conn\.provider === "antigravity"/);
  });

  it("renders the badge in the connection row", () => {
    expect(index).toMatch(/<AntigravityEligibilityBadge/);
  });
});

describe("usage API", () => {
  it("falls back to the cached verdict when the reading has none", () => {
    expect(usageRoute).toMatch(/getAntigravityIneligibility/);
  });

  it("mirrors the verdict onto lastError so the providers page shows it", () => {
    expect(usageRoute).toMatch(/needs verification/i);
    expect(usageRoute).toMatch(/updateProviderConnection/);
  });

  it("clears the marker once the account is eligible again", () => {
    // The else-branch resets lastError so the badge does not stick forever.
    expect(usageRoute).toMatch(/lastError: null/);
  });
});
