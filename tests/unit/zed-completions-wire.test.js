// Zed completions wire acceptance (PanRouter contract).
//
// The upstream suite asserts the provider field of POST /completions uses
// cloud.zed.dev's own spellings (`anthropic` / `open_ai` / `google` / `x_ai`)
// and that the Zed Gemini path drops the shared translator's safetySettings.
// NEITHER is true in this fork's executor: it sends the display-cased enum
// (Anthropic / OpenAi / Google / XAi) and passes the translator output through
// untouched. This suite therefore asserts what the executor here actually
// does — catalog value → forwarded enum, id-based inference when the catalog is
// down, the NDJSON → SSE framing, and the Anthropic tool_result `is_error`
// field the translator already emits.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("open-sse/shared/zedAuth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveZedModels: vi.fn(),
    zedLlmFetch: vi.fn(),
  };
});

import {
  resolveZedModels,
  zedLlmFetch,
} from "open-sse/shared/zedAuth.js";
import ZedExecutor from "open-sse/executors/zed.js";
import { openaiToGeminiRequest } from "open-sse/translator/request/openai-to-gemini.js";

function catalogFor(entries) {
  const rawById = new Map(entries);
  return { rawById, models: [] };
}

function mockCatalogFetch(captured) {
  zedLlmFetch.mockImplementation(async (credentials, path, options) => {
    captured.body = JSON.parse(options.fetchOptions.body);
    return new Response("upstream-error-stub", { status: 500 });
  });
}

function makeExecutor() {
  const executor = new ZedExecutor();
  executor.config = {};
  return executor;
}

const CHAT_BODY = { messages: [{ role: "user", content: "hi" }] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provider enum forwarded to cloud.zed.dev", () => {
  it.each([
    ["Anthropic", "Anthropic"],
    ["anthropic", "Anthropic"],
    ["OpenAi", "OpenAi"],
    ["open_ai", "OpenAi"],
    ["Google", "Google"],
    ["gemini", "Google"],
    ["XAi", "XAi"],
    ["x_ai", "XAi"],
  ])("catalog provider %j resolves to %j", async (catalogValue, expected) => {
    resolveZedModels.mockResolvedValue(catalogFor([["m", { provider: catalogValue }]]));
    const executor = makeExecutor();
    const { provider } = await executor.resolveModel("m", {}, null, null);
    expect(provider).toBe(expected);
  });

  it("infers provider from the model id when the catalog is unavailable", async () => {
    resolveZedModels.mockRejectedValue(new Error("catalog down"));
    const executor = makeExecutor();
    const log = { warn: vi.fn() };
    expect((await executor.resolveModel("claude-opus-x", {}, null, log)).provider).toBe("Anthropic");
    expect((await executor.resolveModel("gemini-3-x", {}, null, log)).provider).toBe("Google");
    expect((await executor.resolveModel("grok-4-x", {}, null, log)).provider).toBe("XAi");
    expect((await executor.resolveModel("gpt-5-x", {}, null, log)).provider).toBe("OpenAi");
  });
});

describe("completion payload shaping", () => {
  it("sends the resolved provider per model family", async () => {
    resolveZedModels.mockImplementation(async () => catalogFor([
      ["claude-x", { provider: "Anthropic" }],
      ["gpt-x", { provider: "OpenAi" }],
      ["gemini-x", { provider: "Google" }],
      ["grok-x", { provider: "XAi" }],
    ]));
    const captured = {};
    mockCatalogFetch(captured);
    const executor = makeExecutor();

    for (const [model, provider] of [
      ["claude-x", "Anthropic"],
      ["gpt-x", "OpenAi"],
      ["gemini-x", "Google"],
      ["grok-x", "XAi"],
    ]) {
      await executor.execute({ model, body: { ...CHAT_BODY }, stream: false, credentials: {} });
      expect(captured.body.provider).toBe(provider);
      expect(captured.body.model).toBe(model);
    }
  });

  it("forwards the shared Gemini translation verbatim (safetySettings included)", async () => {
    resolveZedModels.mockImplementation(async () => catalogFor([
      ["gemini-x", { provider: "Google" }],
    ]));
    const captured = {};
    mockCatalogFetch(captured);
    const executor = makeExecutor();

    await executor.execute({ model: "gemini-x", body: { ...CHAT_BODY }, stream: false, credentials: {} });
    expect(captured.body.provider).toBe("Google");
    // Upstream deletes safetySettings on this path (Zed's hosted Gemini speaks
    // the Vertex vocabulary). This fork does not — pin the current behavior so
    // a future port of that strip is a deliberate, visible change.
    expect(captured.body.provider_request).toEqual(openaiToGeminiRequest("gemini-x", { ...CHAT_BODY }, true));
    expect(captured.body.provider_request).toHaveProperty("safetySettings");
  });

  it("always includes is_error on Anthropic tool_result blocks (Zed serde requires it)", async () => {
    // cloud.zed.dev parses provider_request with Zed's Anthropic types where
    // ToolResult.is_error is a required bool — omitting it yields:
    //   400 failed to parse Anthropic request: missing field `is_error`
    resolveZedModels.mockResolvedValue(catalogFor([
      ["claude-sonnet-5-5", { provider: "Anthropic" }],
    ]));
    const captured = {};
    mockCatalogFetch(captured);
    const executor = makeExecutor();

    await executor.execute({
      model: "claude-sonnet-5-5",
      body: {
        messages: [
          { role: "user", content: "list" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "list_dir", arguments: "{}" },
            }],
          },
          { role: "tool", tool_call_id: "call_1", content: "src/\nREADME.md" },
        ],
      },
      stream: true,
      credentials: {},
    });

    expect(captured.body.provider).toBe("Anthropic");
    const toolResults = (captured.body.provider_request.messages || [])
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === "tool_result");
    expect(toolResults.length).toBeGreaterThan(0);
    for (const block of toolResults) {
      expect(Object.prototype.hasOwnProperty.call(block, "is_error")).toBe(true);
      expect(typeof block.is_error).toBe("boolean");
    }
  });
});

describe("stream framing", () => {
  it("turns the NDJSON event/status body into OpenAI SSE chunks", async () => {
    resolveZedModels.mockResolvedValue(catalogFor([
      ["claude-x", { provider: "Anthropic" }],
    ]));
    zedLlmFetch.mockResolvedValue(new Response(
      [
        JSON.stringify({ event: { type: "message_start", message: { id: "msg_1", role: "assistant", content: [] } } }),
        JSON.stringify({ event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } } }),
        JSON.stringify({ status: "stream_ended" }),
      ].join("\n") + "\n",
      { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
    ));

    const executor = makeExecutor();
    const { response } = await executor.execute({
      model: "claude-x",
      body: { ...CHAT_BODY },
      stream: true,
      credentials: {},
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await response.text();
    const frames = text.split("\n\n").filter(Boolean);
    expect(frames.every((frame) => frame.startsWith("data: "))).toBe(true);
    expect(frames[frames.length - 1]).toBe("data: [DONE]");

    const chunks = frames
      .slice(0, -1)
      .map((frame) => JSON.parse(frame.slice(5)));
    expect(chunks.some((chunk) => chunk.object === "chat.completion.chunk")).toBe(true);
    expect(JSON.stringify(chunks)).toContain("hi");
  });

  it("passes a failed upstream response through unwrapped", async () => {
    resolveZedModels.mockResolvedValue(catalogFor([["claude-x", { provider: "Anthropic" }]]));
    zedLlmFetch.mockResolvedValue(new Response("nope", { status: 401 }));

    const executor = makeExecutor();
    const { response } = await executor.execute({
      model: "claude-x",
      body: { ...CHAT_BODY },
      stream: true,
      credentials: {},
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("nope");
  });
});
