// HuggingFace Inference Providers router (image + speech).
//
// The legacy `api-inference.huggingface.co` host is gone; images must be addressed
// through the router as `<baseUrl>/<provider>/<providerModelId>`, which only works
// when the Hub model id resolves through `imageConfig.modelMap`. These tests drive
// the real registry + adapter (black box): no implementation internals are copied.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import hf from "../../open-sse/providers/registry/huggingface.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import adapter from "../../open-sse/handlers/imageProviders/huggingface.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

const ROUTER = "https://router.huggingface.co";
const originalFetch = global.fetch;

const dataUrl = (payload) => `data:image/png;base64,${Buffer.from(payload).toString("base64")}`;
// Bare base64 that a client may paste directly (no data: prefix).
const BARE_B64 = Buffer.from("source-image-bytes").toString("base64");

describe("HuggingFace registry: Inference Providers router", () => {
  it("points image traffic at the router and never at the dead inference host", () => {
    expect(PROVIDER_MEDIA.huggingface.imageConfig.baseUrl).toBe(ROUTER);
    expect(JSON.stringify(PROVIDER_MEDIA.huggingface)).not.toContain("api-inference.");
  });

  it("ships the edit-capable catalog as image-to-image entries", () => {
    const imageModels = hf.models.filter((m) => m.kind === "image");
    expect(imageModels.length).toBeGreaterThanOrEqual(23);
    for (const m of imageModels) {
      // Every advertised model must be routable, otherwise the picker returns a 400.
      expect(PROVIDER_MEDIA.huggingface.imageConfig.modelMap[m.id], m.id).toBeDefined();
      if (m.capabilities?.includes("edit")) {
        expect(PROVIDER_MEDIA.huggingface.imageConfig.modelMap[m.id], m.id).toMatchObject({
          task: "image-to-image",
        });
      }
    }
    // And no mapping is advertised that the catalog cannot select.
    const catalog = new Set(imageModels.map((m) => m.id));
    for (const mapped of Object.keys(PROVIDER_MEDIA.huggingface.imageConfig.modelMap)) {
      expect(catalog.has(mapped), mapped).toBe(true);
    }
  });

  it("declares speech-to-text on the hf-inference provider without language params", () => {
    const stt = hf.models.filter((m) => m.kind === "stt");
    expect(stt.map((m) => m.id)).toEqual(["openai/whisper-large-v3", "openai/whisper-large-v3-turbo"]);
    // The router's ASR payload has no language field, so declaring one would be a lie.
    for (const m of stt) expect(m.params).toEqual([]);
    expect(PROVIDER_MEDIA.huggingface.sttConfig).toEqual({
      baseUrl: "https://router.huggingface.co/hf-inference/models",
      authType: "apikey",
      authHeader: "bearer",
      format: "huggingface-asr",
    });
    expect(PROVIDER_MEDIA.huggingface.sttConfig.params).toBeUndefined();
  });
});

describe("HuggingFace image adapter: routing", () => {
  it("resolves a Hub id through modelMap to the provider path", () => {
    expect(adapter.buildUrl("black-forest-labs/FLUX.1-schnell")).toBe(`${ROUTER}/fal-ai/fal-ai/flux/schnell`);
    expect(adapter.buildUrl("black-forest-labs/FLUX.2-dev")).toBe(`${ROUTER}/fal-ai/fal-ai/flux-2/edit`);
    expect(adapter.buildUrl("Qwen/Qwen-Image-Edit-2511")).toBe(`${ROUTER}/fal-ai/fal-ai/qwen-image-edit-plus`);
  });

  it("rejects a model the router has no mapping for instead of building a dead URL", () => {
    expect(() => adapter.buildUrl("some-user/unmapped-model")).toThrow(/no HuggingFace router mapping/);
    expect(() => adapter.buildUrl("openai/whisper-large-v3")).toThrow(/no HuggingFace router mapping/);
  });

  it("ignores inherited object keys (toString/constructor/__proto__)", () => {
    for (const inherited of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(() => adapter.buildUrl(inherited), inherited).toThrow(/no HuggingFace router mapping/);
    }
  });

  it("passes the model id verbatim to a custom endpoint, trimming slashes", () => {
    const creds = { providerSpecificData: { baseUrl: "https://tgi.internal/endpoint///" } };
    expect(adapter.buildUrl("black-forest-labs/FLUX.1-dev", creds)).toBe(
      "https://tgi.internal/endpoint/black-forest-labs/FLUX.1-dev"
    );
  });

  it("rejects traversal/query injection in the model id on a custom endpoint", () => {
    const creds = { providerSpecificData: { baseUrl: "https://tgi.internal" } };
    for (const bad of ["../secret", "a//b", "model?x=1", "model#frag"]) {
      expect(() => adapter.buildUrl(bad, creds), bad).toThrow(/invalid model ID/);
    }
  });
});

describe("HuggingFace image adapter: payload", () => {
  it("sends text-to-image as { inputs: prompt }", async () => {
    await expect(adapter.buildBody("black-forest-labs/FLUX.1-schnell", { prompt: "a tree" })).resolves.toEqual({
      inputs: "a tree",
    });
  });

  it("sends image-to-image as raw base64 under inputs with the prompt under parameters", async () => {
    const body = await adapter.buildBody("black-forest-labs/FLUX.2-dev", {
      prompt: "make it red",
      image: dataUrl("png-bytes"),
    });
    expect(body).toEqual({
      inputs: Buffer.from("png-bytes").toString("base64"),
      parameters: { prompt: "make it red" },
    });
  });

  it("accepts a bare base64 string or the first entry of images", async () => {
    await expect(adapter.buildBody("Qwen/Qwen-Image-Edit", { prompt: "p", image: BARE_B64 })).resolves.toEqual({
      inputs: BARE_B64,
      parameters: { prompt: "p" },
    });
    await expect(
      adapter.buildBody("Qwen/Qwen-Image-Edit", { prompt: "p", images: [dataUrl("first"), dataUrl("second")] })
    ).resolves.toEqual({
      inputs: Buffer.from("first").toString("base64"),
      parameters: { prompt: "p" },
    });
  });

  it("downloads a remote source image before sending it", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } })
    );

    const body = await adapter.buildBody("black-forest-labs/FLUX.1-Kontext-dev", {
      prompt: "edit",
      image: "https://example.com/source.png",
    });

    expect(global.fetch).toHaveBeenCalledWith("https://example.com/source.png");
    expect(body).toEqual({
      inputs: Buffer.from(new Uint8Array([1, 2, 3])).toString("base64"),
      parameters: { prompt: "edit" },
    });
  });

  it("refuses an edit model when no source image is supplied", async () => {
    await expect(adapter.buildBody("black-forest-labs/FLUX.2-dev", { prompt: "no image" })).rejects.toThrow(
      /requires a source image/
    );
  });
});

describe("HuggingFace speech-to-text routes through the router", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "hello world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs the Hub model id to the hf-inference router path with the bearer key", async () => {
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "clip.wav");

    const result = await handleSttCore({
      provider: "huggingface",
      model: "openai/whisper-large-v3-turbo",
      formData,
      credentials: { apiKey: "hf-key" },
      sttConfig: PROVIDER_MEDIA.huggingface.sttConfig,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer hf-key", "Content-Type": "audio/wav" }),
      })
    );
    expect(await result.response.json()).toEqual({ text: "hello world" });
  });
});

describe("HuggingFace image generation end to end", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs a text-to-image request to the mapped router URL", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "Content-Type": "image/png" } })
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A tree" },
      modelInfo: { provider: "huggingface", model: "black-forest-labs/FLUX.1-schnell" },
      credentials: { apiKey: "hf-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      `${ROUTER}/fal-ai/fal-ai/flux/schnell`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer hf-key" }),
        body: JSON.stringify({ inputs: "A tree" }),
      })
    );
    const payload = await result.response.json();
    expect(payload.data[0].b64_json).toBe(Buffer.from(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).toString("base64"));
  });

  it("POSTs an image-to-image request with the source image in inputs", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array([9, 9]), { status: 200, headers: { "Content-Type": "image/png" } })
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "add a hat", image: dataUrl("dog") },
      modelInfo: { provider: "huggingface", model: "black-forest-labs/FLUX.1-Kontext-dev" },
      credentials: { apiKey: "hf-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      `${ROUTER}/fal-ai/fal-ai/flux-kontext/dev`,
      expect.objectContaining({
        body: JSON.stringify({ inputs: Buffer.from("dog").toString("base64"), parameters: { prompt: "add a hat" } }),
      })
    );
  });

  it("reports an unmapped model as a bad request, never as a silent success", async () => {
    const result = await handleImageGenerationCore({
      body: { prompt: "A tree" },
      modelInfo: { provider: "huggingface", model: "unmapped/model" },
      credentials: { apiKey: "hf-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/no HuggingFace router mapping/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});