import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// Ported from upstream 32c5f30a. OpenCode serves the GLM-5.3 weights under this
// free id from its OWN inference service, which validates the body strictly: the
// zai `thinking` object is answered
//   400 [unknown_parameter] invalid request body: json: unknown field "thinking"
// while reasoning_effort is accepted.
describe("OpenCode free GLM-5.3 thinking format", () => {
  it("uses the openai thinking format, not the zai object", () => {
    for (const provider of ["opencode", "opencode-zen"]) {
      const caps = getCapabilitiesForModel(provider, "glm-5.3-flash-free");
      expect(caps.thinkingFormat).toBe("openai");
    }
  });

  it("keeps reasoning on and the 1M window", () => {
    const caps = getCapabilitiesForModel("opencode", "glm-5.3-flash-free");
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(128000);
  });

  it("lets the caller disable thinking", () => {
    const caps = getCapabilitiesForModel("opencode", "glm-5.3-flash-free");
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("still describes the multimodal inputs it accepts", () => {
    const caps = getCapabilitiesForModel("opencode", "glm-5.3-flash-free");
    expect(caps.vision).toBe(true);
    expect(caps.videoInput).toBe(true);
    expect(caps.pdf).toBe(true);
  });
});
