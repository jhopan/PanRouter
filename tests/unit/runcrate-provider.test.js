// Runcrate — OpenAI chat-completions gateway (api.runcrate.ai), key from runcrate.ai.
// /v1/models on the inference host is public, so a bad key and a good key both get
// 200 there; the billing endpoint is the probe that actually rejects a bad key.
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import runcrate from "../../open-sse/providers/registry/runcrate.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor, getExecutor } from "../../open-sse/executors/index.js";

const CHAT_URL = "https://api.runcrate.ai/v1/chat/completions";
const BILLING_URL = "https://www.runcrate.ai/api/v1/billing/balance";

describe("Runcrate provider", () => {
  it("is registered once as an OpenAI-compatible apikey provider", () => {
    const entry = REGISTRY.find((e) => e.id === "runcrate");
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(REGISTRY.filter((e) => e.id === "runcrate")).toHaveLength(1);
    expect(PROVIDERS.runcrate.format).toBe("openai");
  });

  it("keeps registry ids unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the id, alias and rc alias token", () => {
    expect(runcrate.id).toBe("runcrate");
    expect(runcrate.alias).toBe("runcrate");
    expect(runcrate.uiAlias).toBe("rc");
    expect(runcrate.aliases).toEqual(["rc"]);
  });

  it("pins the chat endpoint and probes billing instead of the public model list", () => {
    expect(PROVIDERS.runcrate.baseUrl).toBe(CHAT_URL);
    expect(PROVIDERS.runcrate.validateUrl).toBe(BILLING_URL);
    // The registry-driven API-key probe keys off transport.auth + validateUrl.
    expect(PROVIDERS.runcrate.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  it("builds the chat URL from the registry, ignoring a saved base URL", () => {
    const creds = { apiKey: "k", providerSpecificData: { baseUrl: "https://evil.example/v1" } };
    expect(getExecutor("runcrate")).toBeInstanceOf(DefaultExecutor);
    expect(new DefaultExecutor("runcrate").buildUrl("test-model", true, 0, creds)).toBe(CHAT_URL);
    expect(new DefaultExecutor("runcrate").buildUrl("test-model", false, 0, creds)).toBe(CHAT_URL);
  });

  it("lists the vendor-prefixed catalogue", () => {
    const models = PROVIDER_MODELS.runcrate;
    expect(models.map((m) => m.id)).toEqual([
      "deepseek-ai/DeepSeek-V4.1-Flash",
      "deepseek-ai/DeepSeek-V4.1-Flash-1017",
      "zai-org/GLM-5.3",
      "zai-org/GLM-5.3-Flash",
      "Qwen/Qwen3.8-Flash",
      "openai/gpt-oss-120b",
    ]);
    expect(models.every((m) => (m.kind || "llm") === "llm")).toBe(true);
  });
});