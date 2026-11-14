import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

// Ported from upstream d07e5bc3. A transport may declare its own thinking shape,
// and that wins over the model's thinkingFormat — which describes the Chat wire.
// OpenCode Go's /responses endpoint rejects Chat-shaped reasoning_effort and
// thinking:{type} with 503 "Endpoint is unavailable"; it wants the nested
// reasoning:{effort,summary}.
describe("transport-declared thinking shape", () => {
  it("nests reasoning on OpenCode Go /responses", () => {
    const body = {};
    applyThinking("openai-responses", "deepseek-v4.1-flash(high)", body, "opencode-go");

    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("leaves providers without a transport override on the Chat shape", () => {
    const body = {};
    applyThinking("openai-responses", "deepseek-v4.1-flash(high)", body, "openrouter");

    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning).toBeUndefined();
  });

  it("never emits Chat-shaped fields on the Responses transport", () => {
    const body = { reasoning_effort: "low", thinking: { type: "enabled" } };
    applyThinking("openai-responses", "deepseek-v4.1-flash(high)", body, "opencode-go");

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
  });
});