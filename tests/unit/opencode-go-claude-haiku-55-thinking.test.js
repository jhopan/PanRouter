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

  it("uses adaptive thinking on every 5.x lane", () => {
    expect(getCapabilitiesForModel("opencode-go", "claude-haiku-5-5")).toMatchObject({
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
    });
    // The canonical 5.5 entry is adaptive everywhere else too; 4.5 keeps the
    // extended-thinking shape the *claude*haiku* pattern describes.
    expect(getCapabilitiesForModel("claude", "claude-haiku-5-5").thinkingFormat).toBe("claude-adaptive");

    const out = applyThinking("claude", "claude-haiku-5-5", body(), "opencode-go");
    expect(out.thinking?.type).toBe("adaptive");
    expect(out.thinking).not.toHaveProperty("budget_tokens");
    expect(out.output_config?.effort).toBeTruthy();
  });

  it("the 5.x line keeps the adaptive shape on the claude provider", () => {
    // Haiku 5.5 is adaptive-only on the Claude API too (the 4.x ids are the ones
    // that still take the extended-thinking budget shape).
    const out = applyThinking("claude", "claude-haiku-5-5", body(), "claude");

    expect(out.thinking?.type).toBe("adaptive");
    expect(out.thinking).not.toHaveProperty("budget_tokens");
    expect(out.output_config?.effort).toBeTruthy();
  });
});
