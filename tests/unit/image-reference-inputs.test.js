// Reference-image handling for the Gemini-family image adapters.
//
// Edit requests carry the source image ahead of the prompt text in `contents[0].parts`,
// so the model sees the picture before the instruction. Antigravity additionally
// takes explicit aspect ratios, up to ten reference images, and a folded negative
// prompt, and must surface the provider's own status + quota reset time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The antigravity adapter drives its provider through the executor, so stub that
// seam (network is never reached) and keep every other executor untouched.
const execState = vi.hoisted(() => ({ calls: [], response: null }));

vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getExecutor: (id) =>
      id === "antigravity"
        ? {
            execute: async (args) => {
              execState.calls.push(args);
              return { response: execState.response };
            },
          }
        : actual.getExecutor(id),
  };
});

import gemini from "../../open-sse/handlers/imageProviders/gemini.js";
import antigravity from "../../open-sse/handlers/imageProviders/antigravity.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const dataUrl = (payload, mime = "image/png") =>
  `data:${mime};base64,${Buffer.from(payload).toString("base64")}`;
const b64Of = (payload) => Buffer.from(payload).toString("base64");
const BARE_B64 = "a".repeat(120);

const okImageResponse = () =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: "R0VORVJBVEVE" } }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

const parts = () => execState.calls.at(-1).body.contents[0].parts;

describe("Gemini image adapter reference inputs", () => {
  it("puts the reference image before the prompt text", () => {
    const body = gemini.buildBody("gemini-3.1-flash-image", {
      prompt: "make the sky purple",
      image: dataUrl("sky", "image/webp"),
    });

    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/webp", data: b64Of("sky") } },
      { text: "make the sky purple" },
    ]);
    expect(body.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
  });

  it("accepts the first entry of images and bare base64 as PNG", () => {
    const fromArray = gemini.buildBody("m", { prompt: "p", images: [dataUrl("first"), dataUrl("second")] });
    expect(fromArray.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: b64Of("first") } });

    const bare = gemini.buildBody("m", { prompt: "p", image: BARE_B64 });
    expect(bare.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: BARE_B64 } });
  });

  it("ignores a remote URL and short strings it cannot inline", () => {
    for (const image of ["https://example.com/cat.png", "too-short"]) {
      const body = gemini.buildBody("m", { prompt: "text only", image });
      expect(body.contents[0].parts).toEqual([{ text: "text only" }]);
    }
  });
});

describe("Antigravity image adapter reference inputs", () => {
  beforeEach(() => {
    execState.calls = [];
    execState.response = okImageResponse();
  });

  it("sends every reference-image shape before the prompt, in field order", () => {
    const body = {
      prompt: "edit this",
      reference_images: [dataUrl("r0")],
      images: [dataUrl("i0")],
      reference_image: dataUrl("r1"),
      image: dataUrl("i1"),
    };
    return antigravity.executeViaExecutor("gemini-3.1-flash-image", body, { apiKey: "k" }, null).then(() => {
      expect(parts()).toEqual([
        { inlineData: { mimeType: "image/png", data: b64Of("r0") } },
        { inlineData: { mimeType: "image/png", data: b64Of("i0") } },
        { inlineData: { mimeType: "image/png", data: b64Of("r1") } },
        { inlineData: { mimeType: "image/png", data: b64Of("i1") } },
        { text: "edit this" },
      ]);
    });
  });

  it("reads object-shaped image inputs", async () => {
    const rawW = "w".repeat(120);
    const rawX = "x".repeat(120);
    const body = {
      prompt: "p",
      images: [
        { image_url: { url: dataUrl("u") } },
        { url: dataUrl("v") },
        { data: rawW },
        { b64_json: rawX },
      ],
    };
    await antigravity.executeViaExecutor("gemini-3.1-flash-image", body, { apiKey: "k" }, null);

    expect(parts().slice(0, 4)).toEqual([
      { inlineData: { mimeType: "image/png", data: b64Of("u") } },
      { inlineData: { mimeType: "image/png", data: b64Of("v") } },
      { inlineData: { mimeType: "image/png", data: rawW } },
      { inlineData: { mimeType: "image/png", data: rawX } },
    ]);
  });

  it("caps reference images at 10", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => dataUrl(`img${i}`));
    await antigravity.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "p", reference_images: twelve },
      { apiKey: "k" },
      null
    );

    const sent = parts();
    expect(sent).toHaveLength(11); // ten images + the prompt
    expect(sent.slice(0, 10)).toEqual(
      twelve.slice(0, 10).map((url) => ({ inlineData: { mimeType: "image/png", data: url.split(",")[1] } }))
    );
    expect(sent[10]).toEqual({ text: "p" });
  });

  it("prefers an explicit valid aspect_ratio over size", async () => {
    await antigravity.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "p", aspect_ratio: "3:2", size: "1024x1792" },
      { apiKey: "k" },
      null
    );
    expect(execState.calls.at(-1).model).toBe("gemini-3.1-flash-image-3x2");
  });

  it("falls back to size when aspect_ratio is unusable", async () => {
    await antigravity.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "p", aspect_ratio: "very wide", size: "1792x1024" },
      { apiKey: "k" },
      null
    );
    expect(execState.calls.at(-1).model).toBe("gemini-3.1-flash-image-16x9");
  });

  it("leaves the model untouched without a ratio and never doubles the suffix", async () => {
    await antigravity.executeViaExecutor("gemini-3.1-flash-image", { prompt: "p" }, { apiKey: "k" }, null);
    expect(execState.calls.at(-1).model).toBe("gemini-3.1-flash-image");

    execState.response = okImageResponse();
    await antigravity.executeViaExecutor(
      "gemini-3.1-flash-image-16x9",
      { prompt: "p", aspect_ratio: "16:9" },
      { apiKey: "k" },
      null
    );
    expect(execState.calls.at(-1).model).toBe("gemini-3.1-flash-image-16x9");
  });

  it("falls back to an image model when a text model is requested", async () => {
    await antigravity.executeViaExecutor("gpt-4o-mini", { prompt: "p" }, { apiKey: "k" }, null);
    expect(execState.calls.at(-1).model).toBe("gemini-3.1-flash-image");
  });

  it("folds negative_prompt into the prompt text", async () => {
    await antigravity.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "a calm sea", negative_prompt: "boats, rain" },
      { apiKey: "k" },
      null
    );
    expect(parts()).toEqual([{ text: "a calm sea\n\nNegative prompt: boats, rain" }]);
  });

  it("carries the provider status and quota reset time on failure", async () => {
    const resetsAt = new Date(Date.now() + 60_000).toISOString();
    execState.response = new Response(
      JSON.stringify({
        error: {
          code: 429,
          message: "quota exhausted",
          details: [{ metadata: { quotaResetTimeStamp: resetsAt } }],
        },
      }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );

    await expect(
      antigravity.executeViaExecutor("gemini-3.1-flash-image", { prompt: "p" }, { apiKey: "k" }, null)
    ).rejects.toMatchObject({ status: 429, resetsAtMs: Date.parse(resetsAt) });
  });

  it("propagates status + resetsAtMs through the core result for the client", async () => {
    const resetsAt = new Date(Date.now() + 120_000).toISOString();
    execState.response = new Response(
      JSON.stringify({
        error: { message: "quota exhausted", details: [{ metadata: { quotaResetTimeStamp: resetsAt } }] },
      }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "p" },
      modelInfo: { provider: "antigravity", model: "gemini-3.1-flash-image" },
      credentials: { accessToken: "token" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBe(Date.parse(resetsAt));
    expect(result.error).toContain("quota exhausted");
  });

  it("keeps a non-quota failure status without inventing a reset time", async () => {
    execState.response = new Response(JSON.stringify({ error: { message: "upstream exploded" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });

    const result = await handleImageGenerationCore({
      body: { prompt: "p" },
      modelInfo: { provider: "antigravity", model: "gemini-3.1-flash-image" },
      credentials: { accessToken: "token" },
      log: null,
    });

    expect(result.status).toBe(500);
    expect(result.resetsAtMs).toBeUndefined();
  });
});

afterEach(() => {
  execState.calls = [];
  execState.response = null;
});