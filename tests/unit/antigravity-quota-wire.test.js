import { describe, it, expect, beforeEach, vi } from "vitest";

// Wire contract for the Antigravity quota path, checked against the shipped Hub
// 2.32.1 capture (2026-11-15): the Hub sends, on every captured call, only
//   user-agent: antigravity/hub/<ver> (aidev_client; os_type=…; arch=…; cl=…)
//   authorization, accept-encoding, and content-type on POST
// and its loadCodeAssist body is exactly {"metadata":{"ideType":"ANTIGRAVITY"}}.
const calls = [];

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("loadCodeAssist")) {
      return { ok: true, status: 200, json: async () => ({ cloudaicompanionProject: "proj-1" }) };
    }
    if (String(url).includes("fetchAvailableModels")) {
      return { ok: true, status: 200, json: async () => ({ models: {} }) };
    }
    if (String(url).includes("retrieveUserQuotaSummary")) {
      return { ok: true, status: 200, json: async () => ({ groups: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }),
}));

const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

describe("Antigravity quota wire shape (Hub 2.32.1 capture)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("sends the Hub loadCodeAssist body with only ideType", async () => {
    await getAntigravityUsage("token", {}, null);
    const call = calls.find((c) => c.url.includes("loadCodeAssist"));
    expect(call).toBeDefined();
    expect(JSON.parse(call.init.body)).toEqual({ metadata: { ideType: "ANTIGRAVITY" } });
  });

  it("sends no X-Client-* headers on fetchAvailableModels", async () => {
    await getAntigravityUsage("token", {}, null);
    const call = calls.find((c) => c.url.includes("fetchAvailableModels"));
    expect(call).toBeDefined();
    expect(Object.keys(call.init.headers).map((h) => h.toLowerCase()).sort()).toEqual([
      "authorization",
      "content-type",
      "user-agent",
    ]);
    expect(call.init.headers["User-Agent"]).toMatch(/^antigravity\/hub\/\d+\.\d+\.\d+ \(aidev_client; /);
  });

  it("keeps the weekly quota summary headers that the capture did not cover", async () => {
    await getAntigravityUsage("token", {}, null);
    const call = calls.find((c) => c.url.includes("retrieveUserQuotaSummary"));
    expect(call).toBeDefined();
    // Documented asymmetry: this endpoint is opened from the Hub UI, so it was
    // not in the startup capture. PanRouter keeps its previous headers here.
    expect(call.init.headers["X-Client-Name"]).toBe("antigravity");
  });
});