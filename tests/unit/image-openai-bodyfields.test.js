// OpenAI-compatible image adapter: which fields reach the provider's wire body.
//
// Providers without an `imageConfig.bodyFields` whitelist (openai, minimax,
// openrouter, recraft, vercel-ai-gateway) now forward the client's `output_format`;
// providers with a whitelist (xAI) still drop everything the provider rejects, and
// SenseNova keeps the four extra fields it declares. Assertions run through
// JSON.stringify because that is exactly what imageGenerationCore puts on the wire.
import { describe, expect, it } from "vitest";

import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";

const wire = (provider, model, body) => JSON.parse(JSON.stringify(getImageAdapter(provider).buildBody(model, body)));

describe("image adapter bodyFields contract", () => {
  it("forwards output_format for providers without a whitelist", () => {
    expect(
      wire("openai", "gpt-image-1", {
        prompt: "p",
        size: "1024x1024",
        output_format: "webp",
        background: "transparent",
      })
    ).toEqual({ model: "gpt-image-1", prompt: "p", n: 1, size: "1024x1024", output_format: "webp" });
  });

  it("keeps the wire body unchanged when output_format is absent", () => {
    expect(wire("openai", "gpt-image-1", { prompt: "p" })).toEqual({
      model: "gpt-image-1",
      prompt: "p",
      n: 1,
      size: "1024x1024",
    });
  });

  it("still drops fields a whitelist provider does not accept (xAI)", () => {
    expect(
      wire("xai", "grok-2-image-1212", {
        prompt: "p",
        n: 2,
        size: "1024x1024",
        response_format: "b64_json",
        output_format: "jpeg",
        watermark: true,
      })
    ).toEqual({ model: "grok-2-image-1212", prompt: "p", n: 2, response_format: "b64_json" });
  });

  it("sends every declared SenseNova field and nothing else", () => {
    expect(
      wire("sensenova", "sensenova-u1.5-lite", {
        prompt: "a cat",
        n: 2,
        size: "1024x1024",
        output_format: "webp",
        watermark: false,
        prompt_extend: true,
        unrelated: "dropped",
      })
    ).toEqual({
      model: "sensenova-u1.5-lite",
      prompt: "a cat",
      n: 2,
      size: "1024x1024",
      output_format: "webp",
      watermark: false,
      prompt_extend: true,
    });
  });
});