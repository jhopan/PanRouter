import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import registry from "../../open-sse/providers/registry/opencode-go.js";

const body = () => ({
  model: "claude-haiku-5-5",
  max_tokens: 4096,
  thinking: { type: "enabled", budget_tokens: 8000 },
  messages: [{ role: "user", content: "hi" }],
});

describe("OpenCode Go Claude Haiku 5.5", () => {
  it("routes through native Claude Messages transport", () => {
    expect(registry.models).toContainEqual(expect.objectContaining({
      id: "claude-haiku-5-5",
      targetFormat: "claude",
      supportedFormats: ["claude"],
    }));
  });

  it("uses adaptive thinking only on OpenCode Go", () => {
    expect(getCapabilitiesForModel("opencode-go", "claude-haiku-5-5")).toMatchObject({
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
    });
    expect(getCapabilitiesForModel("claude", "claude-haiku-5-5").thinkingFormat).toBe("claude-budget");

    const out = applyThinking("claude", "claude-haiku-5-5", body(), "opencode-go");
    expect(out.thinking?.type).toBe("adaptive");
    expect(out.thinking).not.toHaveProperty("budget_tokens");
    expect(out.output_config?.effort).toBeTruthy();
  });
});
