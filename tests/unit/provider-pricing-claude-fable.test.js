import { describe, it, expect } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";

// Ported from upstream 10b0afa4 (Fable 5.2) and 12e7930e (retire Fable 5.1).
describe("Claude Fable 5.2", () => {
  it("prices Fable 5.2 at $8/$40 with $0.20 cache reads instead of the claude-* fallback", () => {
    expect(getPricingForModel("claude", "claude-fable-5-2")).toMatchObject({
      input: 8,
      output: 40,
      cached: 0.2,
      cache_creation: 10,
    });
  });

  it("keeps Fable 5 at $10/$50", () => {
    expect(getPricingForModel("claude", "claude-fable-5")).toMatchObject({ input: 10, output: 50 });
  });

  it("is advertised in the claude catalog and permanently adaptive", () => {
    expect(getModelsByProviderId("claude").map((m) => m.id)).toContain("claude-fable-5-2");
    expect(getCapabilitiesForModel("claude", "claude-fable-5-2").thinkingCanDisable).toBe(false);
  });
});

describe("retired Claude Fable 5.1", () => {
  it("is gone from the claude and opencode-zen catalogs", () => {
    for (const provider of ["claude", "opencode-zen"]) {
      const ids = getModelsByProviderId(provider).map((m) => m.id);
      expect(ids).not.toContain("claude-fable-5-1");
    }
  });
});