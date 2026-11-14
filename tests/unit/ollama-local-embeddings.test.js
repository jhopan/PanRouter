/**
 * Ollama Local — embeddings wiring + request shape.
 *
 * The chat transport for ollama-local targets Ollama's native /api/chat; the
 * embeddings route is OpenAI-compatible at /v1/embeddings and needs its own
 * adapter plus registry declarations, or the Embedding page never lists the
 * provider and /v1/embeddings has no adapter to build a request with.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Same isolation as embeddingsCore.test.js: executors/index.js pulls uuid (not
// installed here) and tokenRefresh/proxyFetch drag in side effects.
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
  hasSpecializedExecutor: vi.fn(() => false),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
}));

import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { AI_PROVIDERS, getProvidersByKind } from "../../src/shared/constants/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import ollamaLocalRegistry from "../../open-sse/providers/registry/ollama-local.js";

const VALID_EMBEDDING_RESPONSE = {
  object: "list",
  data: [
    {
      object: "embedding",
      index: 0,
      embedding: [0.1, 0.2, 0.3],
    },
  ],
  model: "nomic-embed-text",
  usage: { prompt_tokens: 4, total_tokens: 4 },
};

function makeProviderResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeOptions(overrides = {}) {
  return {
    body: { model: "nomic-embed-text", input: "Hello world" },
    modelInfo: { provider: "ollama-local", model: "nomic-embed-text" },
    credentials: {},
    ...overrides,
  };
}

describe("Ollama Local embeddings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers ollama-local as an embedding provider with its own adapter", () => {
    const provider = AI_PROVIDERS["ollama-local"];
    expect(provider).toBeDefined();
    expect(provider.serviceKinds).toContain("embedding");
    // Chat must keep working — the embedding kind is additive.
    expect(provider.serviceKinds).toContain("llm");

    expect(provider.embeddingConfig).toBeDefined();
    expect(provider.embeddingConfig.baseUrl).toBe("http://localhost:11434/v1/embeddings");
    expect(provider.embeddingConfig.path).toBe("/v1/embeddings");

    const adapter = getEmbeddingAdapter("ollama-local");
    expect(adapter).toBeTruthy();
    expect(typeof adapter.buildUrl).toBe("function");
    expect(typeof adapter.buildHeaders).toBe("function");
    expect(typeof adapter.buildBody).toBe("function");

    const embeddingProviders = getProvidersByKind("embedding");
    expect(embeddingProviders.some((p) => p.id === "ollama-local")).toBe(true);
  });

  it("declares the embedding model families with dimensions", () => {
    const embeddingModels = (PROVIDER_MODELS["ollama-local"] || ollamaLocalRegistry.models).filter(
      (m) => m.kind === "embedding"
    );
    expect(embeddingModels.length).toBeGreaterThanOrEqual(14);
    expect(embeddingModels.every((m) => Number.isInteger(m.dimensions) && m.dimensions > 0)).toBe(true);

    const modelIds = new Set(embeddingModels.map((m) => m.id));
    for (const id of [
      "nomic-embed-text",
      "nomic-embed-text-v2-moe",
      "qwen3-embedding",
      "qwen3-embedding:8b",
      "bge-m3",
      "bge-large",
      "mxbai-embed-large",
      "embeddinggemma",
      "embeddinggemma-2",
      "all-minilm",
      "snowflake-arctic-embed",
      "snowflake-arctic-embed2",
      "granite-embedding",
      "paraphrase-multilingual",
      "laya",
    ]) {
      expect(modelIds.has(id), `missing embedding model ${id}`).toBe(true);
    }

    const byId = new Map(embeddingModels.map((m) => [m.id, m]));
    expect(byId.get("nomic-embed-text").dimensions).toBe(768);
    expect(byId.get("qwen3-embedding:8b").dimensions).toBe(4096);
    expect(byId.get("qwen3-embedding:4b").dimensions).toBe(2560);
    expect(byId.get("all-minilm").dimensions).toBe(384);
  });

  it("posts to http://localhost:11434/v1/embeddings by default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: "Hello world", encoding_format: "float" }),
      })
    );
  });

  it("normalizes custom hosts: trailing slashes, /v1 and /v1/embeddings are not duplicated", () => {
    const adapter = getEmbeddingAdapter("ollama-local");

    expect(adapter.buildUrl("nomic-embed-text", {})).toBe("http://localhost:11434/v1/embeddings");
    expect(adapter.buildUrl("nomic-embed-text", { providerSpecificData: { baseUrl: "http://192.168.1.100:11434" } })).toBe("http://192.168.1.100:11434/v1/embeddings");
    expect(adapter.buildUrl("nomic-embed-text", { providerSpecificData: { baseUrl: "http://192.168.1.100:11434///" } })).toBe("http://192.168.1.100:11434/v1/embeddings");
    expect(adapter.buildUrl("nomic-embed-text", { providerSpecificData: { baseUrl: "http://192.168.1.100:11434/v1" } })).toBe("http://192.168.1.100:11434/v1/embeddings");
    expect(adapter.buildUrl("nomic-embed-text", { providerSpecificData: { baseUrl: "http://192.168.1.100:11434/v1/embeddings" } })).toBe("http://192.168.1.100:11434/v1/embeddings");
  });

  it("sends Content-Type only by default and adds Authorization for an authenticated proxy", () => {
    const adapter = getEmbeddingAdapter("ollama-local");

    expect(adapter.buildHeaders({})).toEqual({ "Content-Type": "application/json" });
    expect(adapter.buildHeaders({ apiKey: "ollama-secret" })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer ollama-secret",
    });
  });

  it("forwards dimensions only when it is a positive number", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      body: { model: "nomic-embed-text", input: "Hello world", dimensions: 512 },
    }));

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init.body).dimensions).toBe(512);

    const adapter = getEmbeddingAdapter("ollama-local");
    const base = { input: "x", encoding_format: "float" };
    expect(adapter.buildBody("m", { ...base, dimensions: null }).dimensions).toBeUndefined();
    expect(adapter.buildBody("m", { ...base, dimensions: 0 }).dimensions).toBeUndefined();
    expect(adapter.buildBody("m", { ...base, dimensions: "abc" }).dimensions).toBeUndefined();
    expect(adapter.buildBody("m", { ...base, dimensions: "256" }).dimensions).toBe(256);
  });

  it("uses the saved host for a real request, not api.openai.com", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      credentials: { providerSpecificData: { baseUrl: "http://192.168.1.100:11434" } },
    }));

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://192.168.1.100:11434/v1/embeddings");
  });
});