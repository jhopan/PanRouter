// SenseNova China vs international site split.
//
// Keys are per-site: token.sensenova.cn answers an international key with
// 401 {"error":{"code":16,"message":"Forbidden"}}, while token.sensenova.ai
// accepts it. China accounts stay on `sensenova`; international accounts use
// `sensenova-intl`. Each entry owns a fixed host — no user-supplied base URL.
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import sensenova from "../../open-sse/providers/registry/sensenova.js";
import sensenovaIntl from "../../open-sse/providers/registry/sensenova-intl.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { DefaultExecutor, getExecutor } from "../../open-sse/executors/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const CN = "sensenova";
const INTL = "sensenova-intl";
const CN_HOST = "token.sensenova.cn";
const INTL_HOST = "token.sensenova.ai";

const host = (url) => new URL(url).host;

describe("SenseNova site split", () => {
  it("registers both sites as OpenAI-compatible apikey providers with unique ids", () => {
    for (const id of [CN, INTL]) {
      const entry = REGISTRY.find((e) => e.id === id);
      expect(entry, id).toBeDefined();
      expect(entry.category).toBe("apikey");
      expect(PROVIDERS[id].format).toBe("openai");
      // Registry-driven API-key probe needs both halves declared.
      expect(PROVIDERS[id].validateUrl).toBeTruthy();
      expect(PROVIDERS[id].auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
    }
    expect(REGISTRY.filter((e) => e.id === CN)).toHaveLength(1);
    expect(REGISTRY.filter((e) => e.id === INTL)).toHaveLength(1);
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps China on token.sensenova.cn for chat, validation and images", () => {
    expect(PROVIDERS[CN].baseUrl).toBe(`https://${CN_HOST}/v1/chat/completions`);
    expect(PROVIDERS[CN].validateUrl).toBe(`https://${CN_HOST}/v1/models`);
    expect(PROVIDER_MEDIA[CN].imageConfig.baseUrl).toBe(`https://${CN_HOST}/v1/images/generations`);
  });

  it("routes the international site to token.sensenova.ai for chat, validation and images", () => {
    expect(PROVIDERS[INTL].baseUrl).toBe(`https://${INTL_HOST}/v1/chat/completions`);
    expect(PROVIDERS[INTL].validateUrl).toBe(`https://${INTL_HOST}/v1/models`);
    expect(PROVIDER_MEDIA[INTL].imageConfig.baseUrl).toBe(`https://${INTL_HOST}/v1/images/generations`);
  });

  it("builds the chat URL from the registry host, ignoring providerSpecificData.baseUrl", () => {
    const creds = { apiKey: "k", providerSpecificData: { baseUrl: "https://evil.example/v1" } };
    expect(getExecutor(INTL)).toBeInstanceOf(DefaultExecutor);
    expect(host(getExecutor(INTL).buildUrl("sensenova-6.8-flash", true, 0, creds))).toBe(INTL_HOST);
    expect(host(getExecutor(CN).buildUrl("sensenova-6.8-flash", true, 0, creds))).toBe(CN_HOST);
  });

  it("points each image adapter at its own site", () => {
    expect(host(getImageAdapter(INTL).buildUrl("sensenova-u1.5-lite", { apiKey: "k" }))).toBe(INTL_HOST);
    expect(host(getImageAdapter(CN).buildUrl("sensenova-u1.5-lite", { apiKey: "k" }))).toBe(CN_HOST);
  });

  it("forwards the declared image body fields (output_format, watermark, prompt_extend)", () => {
    const body = getImageAdapter(CN).buildBody("sensenova-u1.5-lite", {
      prompt: "a cat",
      n: 2,
      size: "1024x1024",
      output_format: "webp",
      watermark: false,
      prompt_extend: true,
      unrelated: "dropped",
    });
    expect(body).toEqual({
      model: "sensenova-u1.5-lite",
      prompt: "a cat",
      n: 2,
      size: "1024x1024",
      output_format: "webp",
      watermark: false,
      prompt_extend: true,
    });
  });

  it("lists the China catalog, with 6.8 Flash / GLM-5.3 and the image models", () => {
    const models = PROVIDER_MODELS[CN];
    const chat = models.filter((m) => (m.kind || "llm") === "llm").map((m) => m.id);
    const image = models.filter((m) => m.kind === "image").map((m) => m.id);
    expect(chat).toEqual([
      "sensenova-6.8-flash",
      "sensenova-6.8-flash-lite",
      "deepseek-flash",
      "deepseek-v4-flash",
      "glm-5.3",
      "glm-5.2",
      "kimi-k3",
    ]);
    expect(image).toEqual(["sensenova-u1.5-lite", "sensenova-u1.5-fast"]);
    const lite = models.find((m) => m.id === "sensenova-u1.5-lite");
    expect(lite.capabilities).toEqual(["text2img", "edit"]);
    expect(lite.params).toEqual([
      "n",
      "size",
      "output_format",
      "response_format",
      "watermark",
      "prompt_extend",
    ]);
  });

  it("lists the international catalog, including 6.7 Flash Lite and U1 Fast", () => {
    const models = PROVIDER_MODELS[INTL];
    const chat = models.filter((m) => (m.kind || "llm") === "llm").map((m) => m.id);
    const image = models.filter((m) => m.kind === "image").map((m) => m.id);
    expect(chat).toEqual(["sensenova-6.8-flash", "sensenova-6.8-flash-lite", "sensenova-6.7-flash-lite"]);
    expect(image).toEqual(["sensenova-u1.5-lite", "sensenova-u1-fast"]);
  });

  it("declares the effort thinking options both sites select on", () => {
    for (const entry of [sensenova, sensenovaIntl]) {
      expect(entry.thinkingConfig.defaultMode).toBe("high");
      expect(entry.thinkingConfig.options).toContain("max");
    }
  });
});

describe("SenseNova capabilities", () => {
  it("pins the China Flash Lite window at 1M context / 131072 output", () => {
    const caps = getCapabilitiesForModel(CN, "sensenova-6.8-flash-lite");
    expect(caps).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 1000000,
      maxOutput: 131072,
      tools: true,
    });
  });

  it("scopes the smaller international window to the intl provider only", () => {
    for (const model of ["sensenova-6.8-flash", "sensenova-6.8-flash-lite", "sensenova-6.7-flash-lite"]) {
      expect(getCapabilitiesForModel(INTL, model), model).toMatchObject({
        vision: true,
        reasoning: true,
        thinkingFormat: "openai",
        contextWindow: 262144,
        maxOutput: 65536,
      });
    }
    // The same id stays on the 1M row in the China catalog.
    expect(getCapabilitiesForModel(CN, "sensenova-6.8-flash-lite").contextWindow).toBe(1000000);
  });
});