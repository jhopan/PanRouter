// Ollama Local TTS — Gradium Phonon voices served by Ollama's own
// /v1/audio/speech endpoint, so the machine that already runs the LLM lane can
// synthesise locally with no key and no cloud round-trip.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { buildTtsProviderModels, getTtsVoicesForModel } from "../../open-sse/config/ttsModels.js";
import { AI_PROVIDERS, getProvidersByKind } from "../../src/shared/constants/providers.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import ollamaLocal from "../../open-sse/providers/registry/ollama-local.js";
import { TTS_PROVIDER_CONFIG } from "../../src/shared/constants/ttsProviders.js";

const originalFetch = global.fetch;

const PHONON_IDS = [
  "phonon:latest",
  "phonon",
  "phonon:multilingual",
  "phonon:40m-multilingual",
  "phonon:en",
  "phonon:31m-en",
  "phonon:40m-en",
  "phonon:de",
  "phonon:40m-de",
  "phonon:es",
  "phonon:40m-es",
  "phonon:fr",
  "phonon:40m-fr",
  "phonon:pt",
  "phonon:40m-pt",
];

function mockOllamaAudioResponse() {
  global.fetch.mockResolvedValueOnce(
    new Response(
      Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, ...new Array(100).fill(0)]),
      { status: 200, headers: { "Content-Type": "audio/wav" } }
    )
  );
}

describe("Ollama Local Phonon registry entry", () => {
  it("stays the single llm/embedding/tts entry for the local host", () => {
    expect(REGISTRY.filter((e) => e.id === "ollama-local")).toHaveLength(1);
    expect(ollamaLocal.id).toBe("ollama-local");
    expect(ollamaLocal.alias).toBe("ollama-local");
    expect(ollamaLocal.serviceKinds).toEqual(["llm", "systemone", "embedding", "tts"]);
  });

  it("declares the local speech endpoint and its auth", () => {
    const tts = PROVIDER_MEDIA["ollama-local"].ttsConfig;
    expect(tts.baseUrl).toBe("http://localhost:11434/v1/audio/speech");
    expect(tts.path).toBe("/v1/audio/speech");
    expect(tts.defaultModel).toBe("phonon");
    expect(tts.authType).toBe("apikey");
    expect(tts.format).toBe("openai");
  });

  it("lists the Phonon checkpoints as tts models with the voice/format params", () => {
    const models = PROVIDER_MODELS["ollama-local"].filter((m) => m.kind === "tts");
    expect(models.map((m) => m.id)).toEqual(PHONON_IDS);
    expect(models.every((m) => m.params.join(",") === "voice,response_format")).toBe(true);
  });
});

describe("Ollama Local TTS", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to /v1/audio/speech with model, input, voice, and response_format", async () => {
    mockOllamaAudioResponse();

    const result = await handleTtsCore({
      provider: "ollama-local",
      model: "phonon/Zoey",
      input: "Hello from Ollama Phonon",
      credentials: null,
      responseFormat: "json",
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("http://localhost:11434/v1/audio/speech");
    expect(global.fetch.mock.calls[0][1].method).toBe("POST");

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("phonon");
    expect(sent.voice).toBe("Zoey");
    expect(sent.input).toBe("Hello from Ollama Phonon");
    // Ollama upstream only accepts wav/pcm; format is normalized to wav
    expect(sent.response_format).toBe("wav");

    const body = await result.response.json();
    expect(body.format).toBe("wav");
    expect(body.audio).toEqual(expect.any(String));
  });

  it("uses default voice when only model is provided", async () => {
    mockOllamaAudioResponse();

    await handleTtsCore({
      provider: "ollama-local",
      model: "phonon",
      input: "Testing default voice",
      responseFormat: "mp3",
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("phonon");
    expect(sent.voice).toBe("default");
    expect(sent.response_format).toBe("wav");
  });

  it("maps standalone voice name to phonon model when phonon prefix is omitted", async () => {
    mockOllamaAudioResponse();

    await handleTtsCore({
      provider: "ollama-local",
      model: "Zoey",
      input: "Testing standalone voice",
      responseFormat: "wav",
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("phonon:multilingual");
    expect(sent.voice).toBe("Zoey");
    expect(sent.response_format).toBe("wav");
  });

  it("requests raw pcm and labels the reply pcm when the client asks for pcm", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(Buffer.from([...new Array(120).fill(7)]), {
        status: 200,
        headers: { "Content-Type": "audio/pcm" },
      })
    );

    const result = await handleTtsCore({
      provider: "ollama-local",
      model: "phonon:40m-en/default",
      input: "Raw samples please",
      responseFormat: "pcm",
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.response_format).toBe("pcm");
    expect(result.success).toBe(true);
    expect(result.response.headers.get("Content-Type")).toBe("audio/pcm");
  });

  it("resolves custom baseUrl from credentials when configured", async () => {
    mockOllamaAudioResponse();

    await handleTtsCore({
      provider: "ollama-local",
      model: "phonon/Easton",
      input: "Remote Ollama instance",
      credentials: {
        providerSpecificData: {
          baseUrl: "http://192.168.1.100:11434",
        },
        apiKey: "custom-token",
      },
      responseFormat: "wav",
    });

    expect(global.fetch.mock.calls[0][0]).toBe("http://192.168.1.100:11434/v1/audio/speech");
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer custom-token");

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.voice).toBe("Easton");
  });

  it("handles connection failure with informative error message", async () => {
    const error = new Error("fetch failed");
    error.cause = { code: "ECONNREFUSED" };
    global.fetch.mockRejectedValueOnce(error);

    const result = await handleTtsCore({
      provider: "ollama-local",
      model: "phonon",
      input: "Should fail gracefully",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot connect to Ollama at http://localhost:11434");
    expect(result.error).toContain("ollama serve");
  });

  it("exposes Phonon TTS models + preset voices in the TTS catalog", () => {
    const entries = buildTtsProviderModels();
    expect(entries["ollama-local-tts-models"].map((m) => m.id)).toEqual(PHONON_IDS);

    const englishVoices = getTtsVoicesForModel("ollama-local", "phonon:40m-en");
    expect(englishVoices.length).toBe(38);
    expect(englishVoices.map((v) => v.id)).toContain("default");
    expect(englishVoices.map((v) => v.id)).toContain("Zoey");
    expect(englishVoices.map((v) => v.id)).toContain("Easton");
    expect(englishVoices.map((v) => v.id)).toContain("Freya");
    expect(englishVoices.map((v) => v.id)).toContain("Azgorath");

    const deVoices = getTtsVoicesForModel("ollama-local", "phonon:de");
    expect(deVoices.map((v) => v.id)).toEqual(["default"]);
  });

  it("wires ollama-local into media-providers TTS (serviceKind, adapter, UI config)", () => {
    expect(AI_PROVIDERS["ollama-local"].serviceKinds).toContain("tts");
    expect(AI_PROVIDERS["ollama-local"].ttsConfig.baseUrl).toBe("http://localhost:11434/v1/audio/speech");
    expect(getTtsAdapter("ollama-local")).toBeTruthy();

    const ttsProviders = getProvidersByKind("tts");
    const ollamaEntry = ttsProviders.find((p) => p.id === "ollama-local");
    expect(ollamaEntry).toBeTruthy();

    expect(TTS_PROVIDER_CONFIG["ollama-local"].hasModelSelector).toBe(true);
    expect(TTS_PROVIDER_CONFIG["ollama-local"].hasVoiceIdInput).toBe(true);
    expect(TTS_PROVIDER_CONFIG["ollama-local"].defaultVoiceId).toBe("default");
    expect(TTS_PROVIDER_CONFIG["ollama-local"].voicesPerModel).toBe(true);
    expect(TTS_PROVIDER_CONFIG["ollama-local"].defaultFormat).toBe("wav");
    expect(TTS_PROVIDER_CONFIG["ollama-local"].formatOptions).toEqual([
      { value: "wav", label: "WAV (Binary)" },
      { value: "pcm", label: "PCM (Raw)" },
    ]);
  });
});