import { describe, expect, it } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";
import { OPENCODE_SESSION_RE } from "../../open-sse/executors/opencode-zen.js";

const credentials = {
  connectionId: "zen-wire-test",
  apiKey: "test-key",
  rawHeaders: {},
};

describe("OpenCode Zen v2 session wire", () => {
  it("keeps paid auth and emits a canonical v2 session", () => {
    const executor = getExecutor("opencode-zen");
    const prepared = executor.prepareRequestCredentials({
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials,
      providerSessionId: "zen-conversation",
      clientTool: "openai",
    });
    const headers = executor.buildHeaders(prepared, true, "https://opencode.ai/zen/v1/chat/completions", "big-pickle");

    expect(prepared._opencodeZenSession).toMatch(OPENCODE_SESSION_RE);
    expect(headers["x-opencode-session"]).toBe(prepared._opencodeZenSession);
    expect(headers.Authorization).toBe("Bearer test-key");
  });
});
