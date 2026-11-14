import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";

// Ported from upstream 0f7f6e72, a3bdaf6d and 60a1b365.
describe("GLM-5.2/5.3 context window", () => {
  // The window is not cosmetic: stripHistoryForContext() trims conversation
  // history at 80% of it, so a 200k pin silently discarded history that a 1M
  // model could still hold.
  for (const model of ["glm-5.3", "glm-5.2", "zai-org/GLM-5.3"]) {
    it(`${model} advertises 1M`, () => {
      expect(getCapabilitiesForModel("zai", model).contextWindow).toBe(1000000);
    });
  }

  it("leaves the older GLM-5 catch-all at 200k", () => {
    expect(getCapabilitiesForModel("zai", "glm-5").contextWindow).toBe(200000);
  });
});

describe("Command Code model catalog", () => {
  const ids = () => getModelsByProviderId("commandcode").map((m) => m.id);

  it("carries the added models with their upstream wire ids verbatim", () => {
    const list = ids();
    // Capitalisation matters: it must match GET api.commandcode.ai/provider/v1/models
    expect(list).toContain("moonshotai/Kimi-K3.1-Pro");
    expect(list).toContain("google/gemini-4-carbon");
    expect(list).toContain("claude-fable-5-2");
  });

  it("keeps the models it already had", () => {
    const list = ids();
    expect(list).toContain("deepseek/deepseek-v4-pro");
    expect(list).toContain("zai-org/GLM-5.1");
    expect(list).toContain("MiniMaxAI/MiniMax-M2.7");
  });
});