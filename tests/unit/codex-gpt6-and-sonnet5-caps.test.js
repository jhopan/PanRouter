import { describe, expect, it } from "vitest";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Ported from upstream 92c7bdd5 (GPT-6 Sol/Luna caps + official pricing),
// ccd0677d (Sonnet 5.x must resolve to adaptive thinking) and acb3c080
// (GPT-6.1 Terra catalog entry).

describe("Codex GPT-6 capabilities and pricing", () => {
  it("lists gpt-6.1-terra as a Lite model with its 500k Codex window", () => {
    const entry = getModelsByProviderId("codex").find((item) => item.id === "gpt-6.1-terra");
    expect(entry?.responsesLite).toBe(true);
    expect(entry?.thinkingLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(getCapabilitiesForModel("codex", "gpt-6.1-terra")).toMatchObject({
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 500000,
      maxOutput: 128000,
    });
    expect(getPricingForModel("codex", "gpt-6.1-terra")).toMatchObject({ input: 1, cached: 0.05, cache_creation: 1.25, output: 5 });
  });

  it("resolves Sol and Luna with the shared 272k window", () => {
    for (const model of ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra"]) {
      expect(getCapabilitiesForModel("codex", model)).toMatchObject({
        reasoning: true,
        contextWindow: 272000,
        maxOutput: 128000,
      });
    }
  });

  it("bills GPT-6 at the official OpenAI Standard rates", () => {
    expect(getPricingForModel("codex", "gpt-6-astra")).toMatchObject({ input: 10, output: 50, cached: 1 });
    expect(getPricingForModel("codex", "gpt-6-sol")).toMatchObject({ input: 2, output: 10, cached: 0.2 });
    expect(getPricingForModel("codex", "gpt-6-luna")).toMatchObject({ input: 0.1, output: 0.5, cached: 0.01 });
  });
});

describe("Claude Sonnet 5.x thinking shape", () => {
  // Without a dedicated pattern these fell to the generic `*claude*sonnet*`
  // budget entry: thinking.type "enabled", which makes the translator forge
  // signed thinking placeholders on every tool_use turn.
  for (const model of ["claude-sonnet-5-5", "claude-sonnet-5.5", "anthropic/claude-sonnet-5-5"]) {
    it(`${model} uses adaptive thinking on a 1M window`, () => {
      expect(getCapabilitiesForModel("claude", model)).toMatchObject({
        thinkingFormat: "claude-adaptive",
        contextWindow: 1000000,
        reasoning: true,
      });
    });
  }

  it("leaves older Sonnet 4.x behaviour alone", () => {
    expect(getCapabilitiesForModel("claude", "claude-sonnet-4-5").thinkingFormat).not.toBe("claude-adaptive");
  });
});
