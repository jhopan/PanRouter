// Ollama Local System One — the local host also serves the Clef decision models
// on the native /v1/systemone lane, so the combo smart router can fall back to
// a model that runs on the same machine.

import { describe, it, expect } from "vitest";

import { AI_PROVIDERS, getProvidersByKind } from "../../src/shared/constants/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import ollamaLocal from "../../open-sse/providers/registry/ollama-local.js";

describe("Ollama Local System One (Clef)", () => {
  it("keeps the llm/embedding/tts lanes and adds systemone", () => {
    const kinds = AI_PROVIDERS["ollama-local"].serviceKinds;
    expect(kinds).toContain("llm");
    expect(kinds).toContain("embedding");
    expect(kinds).toContain("tts");
    expect(kinds).toContain("systemone");
  });

  it("appears in getProvidersByKind('systemone')", () => {
    const found = getProvidersByKind("systemone").find((p) => p.id === "ollama-local");
    expect(found).toBeDefined();
  });

  it("pins the local /v1/systemone lane", () => {
    const cfg = PROVIDER_MEDIA["ollama-local"].systemoneConfig;
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1/systemone");
    expect(cfg.path).toBe("/v1/systemone");
  });

  it("lists clef and clef-flash as systemone models", () => {
    const kinds = Object.fromEntries(PROVIDER_MODELS["ollama-local"].map((m) => [m.id, m.kind]));
    expect(kinds.clef).toBe("systemone");
    expect(kinds["clef-flash"]).toBe("systemone");
    expect(ollamaLocal.models.find((m) => m.id === "clef").name).toBe("Clef");
  });
});
