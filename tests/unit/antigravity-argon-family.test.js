import { describe, expect, it } from "vitest";
import { antigravityArgonBucket, antigravityFamilyKey } from "@/sse/services/antigravityQuota.js";

// PanRouter's family mapping stays the baseline; the Argon bucket is additive
// (upstream 8a833631) and only overrides when the account actually reports it.
describe("Antigravity Argon bucket (additive)", () => {
  it("leaves PanRouter's family mapping untouched", () => {
    expect(antigravityFamilyKey("gemini-3.8-flash-high")).toBe("gemini_weekly");
    expect(antigravityFamilyKey("gemini-4-argon-high")).toBe("gemini_weekly");
    expect(antigravityFamilyKey("claude-sonnet-4-6")).toBe("claude_gpt_weekly");
    expect(antigravityFamilyKey("unknown-model")).toBeNull();
  });

  it("returns the Argon bucket only for Argon models that report one", () => {
    const quotas = {
      gemini_argon_weekly: { remainingPercentage: 0, resetAt: "2026-11-20T00:00:00Z" },
      gemini_weekly: { remainingPercentage: 0.9, resetAt: "2026-11-18T00:00:00Z" },
    };
    for (const model of ["gemini-4-argon", "gemini-4-argon-high", "gemini-4-argon-medium", "gemini-4-argon-low"]) {
      expect(antigravityArgonBucket(quotas, model)?.remainingPercentage).toBe(0);
    }
    expect(antigravityArgonBucket(quotas, "gemini-3.8-flash-high")).toBeNull();
  });

  it("falls back to null when the account reports no Argon bucket", () => {
    const quotas = { gemini_weekly: { remainingPercentage: 0.4 } };
    expect(antigravityArgonBucket(quotas, "gemini-4-argon-high")).toBeNull();
    expect(antigravityArgonBucket(null, "gemini-4-argon")).toBeNull();
    expect(antigravityArgonBucket({}, null)).toBeNull();
  });

  it("keeps an exhausted Argon bucket visible next to healthy plain-Gemini quota", () => {
    const quotas = {
      gemini_argon_weekly: { remainingPercentage: 0, resetAt: "2026-11-20T00:00:00Z" },
      gemini_weekly: { remainingPercentage: 1, resetAt: null },
    };
    expect(antigravityArgonBucket(quotas, "gemini-4-argon")?.remainingPercentage).toBe(0);
    expect(quotas.gemini_weekly.remainingPercentage).toBe(1);
  });
});