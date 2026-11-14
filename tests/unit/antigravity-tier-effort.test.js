import { describe, expect, it } from "vitest";

import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

// Antigravity resolves tiered variants (gemini-3.8-flash → -high/-medium/-low)
// from the client's thinking request only when the registry declares that tier.
describe("Antigravity tier resolution from client reasoning effort", () => {
  it("keeps the base model when no tier is requested", () => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash")).toBe("gemini-3.8-flash-medium(medium)");
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", {})).toBe("gemini-3.8-flash-medium(medium)");
  });

  it.each([
    ["high", "gemini-3.8-flash-high(high)"],
    ["xhigh", "gemini-3.8-flash-high(high)"],
    ["max", "gemini-3.8-flash-high(high)"],
    ["medium", "gemini-3.8-flash-medium(medium)"],
    ["low", "gemini-3.8-flash-low(low)"],
    ["minimal", "gemini-3.8-flash-low(low)"],
  ])("maps reasoning_effort %s to %s", (effort, expected) => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { reasoning_effort: effort })).toBe(expected);
  });

  it("reads the Claude output_config.effort shape", () => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { output_config: { effort: "high" } }))
      .toBe("gemini-3.8-flash-high(high)");
  });

  it.each([
    [2048, "gemini-3.8-flash-low(low)"],
    [4096, "gemini-3.8-flash-low(low)"],
    [4097, "gemini-3.8-flash-medium(medium)"],
    [8192, "gemini-3.8-flash-medium(medium)"],
    [16384, "gemini-3.8-flash-medium(medium)"],
    [16385, "gemini-3.8-flash-high(high)"],
    [24576, "gemini-3.8-flash-high(high)"],
  ])("maps thinking budget_tokens %i to %s", (budget, expected) => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { thinking: { budget_tokens: budget } })).toBe(expected);
  });

  it("ignores a non-positive thinking budget", () => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { thinking: { budget_tokens: 0 } }))
      .toBe("gemini-3.8-flash-medium(medium)");
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { thinking: { type: "enabled" } }))
      .toBe("gemini-3.8-flash-medium(medium)");
  });

  it("lets an explicit (level) suffix win over the client body", () => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash(low)", { reasoning_effort: "high" }))
      .toBe("gemini-3.8-flash-low(low)");
    expect(getModelUpstreamId("ag", "gemini-3.8-flash(high)", { reasoning_effort: "low" }))
      .toBe("gemini-3.8-flash-high(high)");
    expect(getModelUpstreamId("ag", "gemini-3.8-flash(high)", { thinking: { budget_tokens: 1024 } }))
      .toBe("gemini-3.8-flash-high(high)");
  });

  it("resolves suffixed tier requests on the base id", () => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash(medium)")).toBe("gemini-3.8-flash-medium(medium)");
    expect(getModelUpstreamId("ag", "gemini-3.8-flash(xhigh)")).toBe("gemini-3.8-flash-high(xhigh)");
  });

  it("preserves direct tiered model ids", () => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash-high", { reasoning_effort: "low" }))
      .toBe("gemini-3.8-flash-high(high)");
    expect(getModelUpstreamId("ag", "gemini-3.7-flash-low")).toBe("gemini-3.7-flash-tiered(low)");
  });

  it("falls back to the base id when the registry declares no such tier", () => {
    // Unknown level: "gemini-3.8-flash-turbo" is not a declared model.
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { reasoning_effort: "turbo" }))
      .toBe("gemini-3.8-flash-medium(medium)");
    // Declared model without tiered siblings: nothing is synthesised.
    expect(getModelUpstreamId("ag", "claude-sonnet-4-6", { reasoning_effort: "high" }))
      .toBe("claude-sonnet-4-6");
    // Registry-only tiered suffix set: the base id is not declared, the tier is.
    expect(getModelUpstreamId("ag", "gemini-3.1-pro", { reasoning_effort: "low" })).toBe("gemini-3.1-pro-low");
  });

  it("leaves a non-antigravity provider untouched", () => {
    const plain = getModelUpstreamId("cx", "gpt-5.6-sol");
    expect(getModelUpstreamId("cx", "gpt-5.6-sol", { reasoning_effort: "high" })).toBe(plain);
    expect(getModelUpstreamId("cx", "gpt-5.6-sol", { thinking: { budget_tokens: 24576 } })).toBe(plain);
    expect(getModelUpstreamId("gcli", "grok-4.5", { reasoning_effort: "high" })).toBe("grok-4.5");
    expect(getModelUpstreamId("gcli", "grok-4.5(high)")).toBe("grok-4.5(high)");
  });

  it("keeps resolution of a provider that has no tiers identical with and without a body", () => {
    for (const modelId of ["gpt-5.6-sol", "gpt-5.6-luna[1m]", "gpt-image-2.5"]) {
      expect(getModelUpstreamId("cx", modelId, { reasoning_effort: "xhigh" }))
        .toBe(getModelUpstreamId("cx", modelId));
    }
  });
});