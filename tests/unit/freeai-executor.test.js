import { describe, expect, it } from "vitest";
import { FreeAIExecutor } from "../../open-sse/executors/freeai.js";

const executor = new FreeAIExecutor();

describe("FreeAIExecutor URL routing", () => {
  it("routes chat/code models to native /v1/chat/", () => {
    for (const model of ["qwen7b", "qwen3-8b", "deepseek-r1", "deepseek-r1-7b", "mistral", "qwen-coder", "qwen3-coder"]) {
      expect(executor.buildUrl(model, true, 0, null)).toBe("https://api.free.ai/v1/chat/");
    }
  });

  it("routes vision models to OpenAI-compat /v1/chat/completions", () => {
    for (const model of ["qwen-vl", "qwen25-vl", "moondream2"]) {
      expect(executor.buildUrl(model, true, 0, null)).toBe("https://api.free.ai/v1/chat/completions");
    }
  });

  it("honours credential-level runtimeTransport override", () => {
    const creds = { runtimeTransport: { baseUrl: "https://relay.example.test/custom" } };
    expect(executor.buildUrl("qwen-vl", true, 0, creds)).toBe("https://relay.example.test/custom");
  });
});