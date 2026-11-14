import { describe, it, expect } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import nvidiaConfig from "../../open-sse/providers/registry/nvidia.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("NVIDIA NIM parameter hardening", () => {
  it("transport quirks declare dropClientMetadata and timeoutMs", () => {
    expect(nvidiaConfig.transport.quirks?.dropClientMetadata).toBe(true);
    expect(nvidiaConfig.transport.timeoutMs).toBe(90000);
  });

  it("models list includes meta/llama-3.3-70b-instruct and active models", () => {
    const has = (id) => nvidiaConfig.models.some((m) => m.id === id);
    expect(has("meta/llama-3.3-70b-instruct")).toBe(true);
    expect(has("nvidia/nemotron-3.5-lightning-30b-a3b")).toBe(true);
    expect(has("nvidia/nemotron-3.5-bolt-e4b")).toBe(true);
    expect(has("poolside/laguna-xs-2.1")).toBe(true);
  });

  it("stripUnsupportedParams strips client_metadata, prompt_cache_key, service_tier, and extra fields", () => {
    const payload = {
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi", reasoning: "thinking text" },
      ],
      client_metadata: { source: "claude-code" },
      prompt_cache_key: "cache-123",
      service_tier: "default",
      anthropic_beta: ["tools-2024"],
      thinking_budget: 1024,
      user_id: "user-456",
      custom_field: "test",
      temperature: 0.7,
    };

    stripUnsupportedParams("nvidia", "meta/llama-3.3-70b-instruct", payload);

    expect(payload.client_metadata).toBeUndefined();
    expect(payload.prompt_cache_key).toBeUndefined();
    expect(payload.service_tier).toBeUndefined();
    expect(payload.anthropic_beta).toBeUndefined();
    expect(payload.thinking_budget).toBeUndefined();
    expect(payload.user_id).toBeUndefined();
    expect(payload.custom_field).toBeUndefined();
    expect(payload.temperature).toBe(0.7);

    // reasoning field was renamed to reasoning_content
    expect(payload.messages[1].reasoning).toBeUndefined();
    expect(payload.messages[1].reasoning_content).toBe("thinking text");
  });

  it("DefaultExecutor.transformRequest strips unsupported params for nvidia", () => {
    const executor = new DefaultExecutor("nvidia");
    const body = {
      model: "meta/llama-3.3-70b-instruct",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello", reasoning: "secret thought" },
      ],
      client_metadata: { source: "claude-code" },
      prompt_cache_key: "cache-key-1",
      service_tier: "auto",
    };

    const transformed = executor.transformRequest("meta/llama-3.3-70b-instruct", body, false, {});

    expect("client_metadata" in transformed).toBe(false);
    expect("prompt_cache_key" in transformed).toBe(false);
    expect("service_tier" in transformed).toBe(false);
    expect("reasoning" in transformed.messages[1]).toBe(false);
    expect(transformed.messages[1].reasoning_content).toBe("secret thought");
  });

  it("triggers modelScoped cooldown on 400 degraded for nvidia", () => {
    const result = checkFallbackError(400, "DEGRADED function cannot be invoked", 0, "nvidia");
    expect(result.shouldFallback).toBe(true);
    expect(result.modelScoped).toBe(true);
    expect(result.cooldownMs).toBe(15 * 60 * 1000);
  });

  it("model capabilities distinguish tools support", () => {
    const llamaCaps = getCapabilitiesForModel("nvidia", "meta/llama-3.3-70b-instruct");
    const minimaxCaps = getCapabilitiesForModel("nvidia", "minimaxai/minimax-m3");

    expect(llamaCaps.tools).toBe(true);
    expect(minimaxCaps.tools).toBe(false);
  });
});