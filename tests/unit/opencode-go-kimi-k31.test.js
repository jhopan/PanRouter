import { describe, expect, it } from "vitest";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Ported from upstream 5cd4a756. Values from the opencode.ai/go docs: the model
// is served on the chat completions lane with always-on Kimi thinking.
describe("OpenCode Go Kimi K3.1 Pro", () => {
  it("is listed on the chat completions lane", () => {
    const entry = getModelsByProviderId("opencode-go").find((m) => m.id === "kimi-k3.1-pro");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ name: "Kimi K3.1 Pro", supportedFormats: ["openai"] });
  });

  it("reports a 1M window with always-on Kimi thinking", () => {
    expect(getCapabilitiesForModel("opencode-go", "kimi-k3.1-pro")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 131072,
    });
  });

  it("is priced at 2/10 with cache and reasoning rates", () => {
    expect(getPricingForModel("opencode-go", "kimi-k3.1-pro")).toMatchObject({
      input: 2,
      output: 10,
      cached: 0.2,
      reasoning: 10,
    });
  });

  it("leaves Kimi K3 on its own rate", () => {
    expect(getPricingForModel("opencode-go", "kimi-k3").output).not.toBe(10);
  });
});