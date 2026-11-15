import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import IFlowExecutor from "open-sse/executors/iflow.js";
import iflowRegistry from "open-sse/providers/registry/iflow.js";
import { PROVIDERS } from "open-sse/config/providers.js";

const executor = new IFlowExecutor();

const sign = (key, sessionId, timestamp) =>
  crypto.createHmac("sha256", key).update(`iFlow-Cli:${sessionId}:${timestamp}`).digest("hex");

describe("iflow registry wiring", () => {
  it("targets the CLI chat-completions endpoint with the iFlow-Cli user agent", () => {
    expect(PROVIDERS.iflow.baseUrl).toBe("https://apis.iflow.cn/v1/chat/completions");
    expect(PROVIDERS.iflow.headers["User-Agent"]).toBe("iFlow-Cli");
    expect(iflowRegistry.hidden).toBe(true);
  });

  it("keeps the Qwen / Kimi / DeepSeek / GLM catalog served by the executor", () => {
    const ids = iflowRegistry.models.map((m) => m.id);
    for (const id of ["qwen3-coder-plus", "qwen3-max", "kimi-k2", "deepseek-v3.2", "glm-4.7"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("iflow signature", () => {
  it("is HMAC-SHA256 keyed by the API key over userAgent:sessionId:timestamp", () => {
    const signature = executor.createIFlowSignature("iFlow-Cli", "session-abc", 1700000000000, "sk-test");
    expect(signature).toBe(sign("sk-test", "session-abc", 1700000000000));
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns an empty signature when no key is available", () => {
    expect(executor.createIFlowSignature("iFlow-Cli", "session-abc", 1700000000000, "")).toBe("");
  });
});

describe("iflow headers", () => {
  it("signs the exact session id and timestamp it puts on the wire", () => {
    const headers = executor.buildHeaders({ apiKey: "sk-live" });
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe("iFlow-Cli");
    expect(headers["session-id"]).toMatch(/^session-[0-9a-f-]{36}$/);
    expect(headers["x-iflow-timestamp"]).toMatch(/^\d+$/);
    expect(headers["x-iflow-signature"]).toBe(
      sign("sk-live", headers["session-id"], headers["x-iflow-timestamp"])
    );
    expect(headers.Authorization).toBe("Bearer sk-live");
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("signs with the OAuth access token and omits Authorization on non-streaming calls", () => {
    const headers = executor.buildHeaders({ accessToken: "oauth-token" }, false);
    expect(headers["x-iflow-signature"]).toBe(
      sign("oauth-token", headers["session-id"], headers["x-iflow-timestamp"])
    );
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBeUndefined();
  });

  it("mints a fresh session id per request", () => {
    const a = executor.buildHeaders({ apiKey: "sk-live" });
    const b = executor.buildHeaders({ apiKey: "sk-live" });
    expect(a["session-id"]).not.toBe(b["session-id"]);
  });
});

describe("iflow request shaping", () => {
  it("always targets the registry base URL, ignoring a stored per-connection base", () => {
    const base = "https://apis.iflow.cn/v1/chat/completions";
    expect(executor.buildUrl("qwen3-coder-plus", true)).toBe(base);
    expect(
      executor.buildUrl("qwen3-coder-plus", false, 3, { providerSpecificData: { baseUrl: "https://evil.example" } })
    ).toBe(base);
  });

  it("injects stream_options so streaming responses carry usage", () => {
    const body = executor.transformRequest(
      "kimi-k2",
      { model: "kimi-k2", messages: [{ role: "user", content: "hi" }], stream: true },
      true,
      {}
    );
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("leaves non-streaming bodies, explicit stream_options, and message-less bodies alone", () => {
    const plain = executor.transformRequest("kimi-k2", { messages: [{ role: "user", content: "hi" }] }, false, {});
    expect(plain.stream_options).toBeUndefined();

    const explicit = executor.transformRequest(
      "kimi-k2",
      { messages: [{ role: "user", content: "hi" }], stream_options: { include_usage: false } },
      true,
      {}
    );
    expect(explicit.stream_options).toEqual({ include_usage: false });

    const noMessages = executor.transformRequest("kimi-k2", { prompt: "hi" }, true, {});
    expect(noMessages.stream_options).toBeUndefined();
  });
});