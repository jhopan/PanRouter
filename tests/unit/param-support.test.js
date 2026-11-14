import { describe, it, expect } from "vitest";

import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams", () => {
  it("flattens Cloudflare AI OpenAI content-part arrays", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
            { type: "text", text: "world" },
          ],
        },
      ],
    };

    expect(() => stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct", body)).not.toThrow();
    expect(body.messages[0].content).toBe("hello world");
  });

  it("still drops unsupported GitHub model params", () => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("github", "gpt-5.4", body);

    expect(body).toEqual({ top_p: 1 });
  });

  it("clamps VolcEngine Ark GLM max token fields to the model output ceiling", () => {
    const body = {
      max_tokens: 131072,
      max_completion_tokens: 131072,
      max_output_tokens: 131072,
    };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body).toEqual({
      max_tokens: 128000,
      max_completion_tokens: 128000,
      max_output_tokens: 128000,
    });
  });

  it("keeps VolcEngine Ark GLM max tokens when already under the ceiling", () => {
    const body = { max_tokens: 64000 };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body.max_tokens).toBe(64000);
  });

  it("drops response_format only for OpenCode Go DeepSeek models", () => {
    const response_format = { type: "json_schema", json_schema: { name: "result", schema: { type: "object" } } };
    const deepseek = { messages: [], response_format };
    const glm = { messages: [], response_format };
    const otherProvider = { messages: [], response_format };

    stripUnsupportedParams("opencode-go", "deepseek-v4.1-flash", deepseek);
    stripUnsupportedParams("opencode-go", "glm-5.3-flash", glm);
    stripUnsupportedParams("openrouter", "deepseek/deepseek-v3.2", otherProvider);

    expect(deepseek.response_format).toBeUndefined();
    expect(glm.response_format).toBe(response_format);
    expect(otherProvider.response_format).toBe(response_format);
  });

  // Current OpenAI models (gpt-5.x / gpt-6.x) reject `max_tokens`:
  //   400 "Unsupported parameter: 'max_tokens' is not supported with this model.
  //        Use 'max_completion_tokens' instead."
  // Clients still send max_tokens, so it has to be renamed, not dropped.
  describe("renames max_tokens for the openai provider", () => {
    it("moves the value to max_completion_tokens", () => {
      const body = { messages: [], max_tokens: 4096 };
      stripUnsupportedParams("openai", "gpt-5.6-luna", body);

      expect(body.max_tokens).toBeUndefined();
      expect(body.max_completion_tokens).toBe(4096);
    });

    it("does not clobber an explicit max_completion_tokens", () => {
      const body = { messages: [], max_tokens: 100, max_completion_tokens: 900 };
      stripUnsupportedParams("openai", "gpt-5.6-luna", body);

      expect(body.max_completion_tokens).toBe(900);
      expect(body.max_tokens).toBeUndefined();
    });

    it("leaves other providers alone", () => {
      const body = { messages: [], max_tokens: 512 };
      stripUnsupportedParams("anthropic", "claude-sonnet-4-6", body);

      expect(body.max_tokens).toBe(512);
      expect(body.max_completion_tokens).toBeUndefined();
    });
  });
});
