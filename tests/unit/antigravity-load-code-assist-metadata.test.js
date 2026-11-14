import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getProjectIdForConnection, invalidateProjectId } from "../../open-sse/services/projectId.js";

// Wire contract taken from the shipped Hub 2.32.1 (captured 2026-11-15 by
// launching Antigravity.exe with CLOUD_CODE_URL pointed at a local listener):
//   loadCodeAssist -> {"metadata":{"ideType":"ANTIGRAVITY"}}
//   onboardUser    -> {"tierId":"free-tier","metadata":{"ideType":"ANTIGRAVITY"}}
// with only user-agent + authorization + content-type on the wire.
describe("Antigravity loadCodeAssist / onboardUser wire bodies", () => {
  const calls = [];
  const realFetch = globalThis.fetch;

  const jsonResponse = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });

  beforeEach(() => {
    calls.length = 0;
    process.env.ONBOARD_RETRY_DELAY_MS = "1";
    process.env.ONBOARD_MAX_ATTEMPTS = "1";
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("loadCodeAssist")) {
        return jsonResponse({
          allowedTiers: [{ id: "free-tier", isDefault: true }],
          currentTier: { id: "free-tier" },
        });
      }
      return jsonResponse({ done: true, response: { cloudaicompanionProject: "proj-onboarded" } });
    });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    invalidateProjectId("conn-ag-metadata");
    invalidateProjectId("conn-ag-project");
    invalidateProjectId("conn-gcli");
    delete process.env.ONBOARD_RETRY_DELAY_MS;
    delete process.env.ONBOARD_MAX_ATTEMPTS;
  });

  it("sends only {ideType} for Antigravity and no Gemini-CLI headers", async () => {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("loadCodeAssist")) return jsonResponse({ cloudaicompanionProject: "proj-direct" });
      return jsonResponse({ done: true });
    });

    await getProjectIdForConnection("conn-ag-project", "token", "antigravity");

    const call = calls.find((c) => c.url.includes("loadCodeAssist"));
    expect(call).toBeDefined();
    expect(JSON.parse(call.init.body)).toEqual({ metadata: { ideType: "ANTIGRAVITY" } });
    expect(call.init.headers["User-Agent"]).toMatch(/^antigravity\/hub\//);
    expect(call.init.headers["X-Goog-Api-Client"]).toBeUndefined();
    expect(call.init.headers["Client-Metadata"]).toBeUndefined();
  });

  it("keeps {ideType} only on the onboardUser fallback", async () => {
    const projectId = await getProjectIdForConnection("conn-ag-metadata", "token", "antigravity");
    expect(projectId).toBe("proj-onboarded");

    const onboard = calls.find((c) => c.url.includes("onboardUser"));
    expect(onboard).toBeDefined();
    expect(JSON.parse(onboard.init.body)).toEqual({
      tierId: "free-tier",
      metadata: { ideType: "ANTIGRAVITY" },
    });
  });

  it("leaves the Gemini CLI metadata untouched", async () => {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ cloudaicompanionProject: "proj-gcli" });
    });

    await getProjectIdForConnection("conn-gcli", "token", "gemini-cli");

    const call = calls.find((c) => c.url.includes("loadCodeAssist"));
    const body = JSON.parse(call.init.body);
    expect(body.metadata.ideType).toBeDefined();
    expect(body.metadata.pluginType).toBeDefined();
    expect(body.metadata.platform).toBeDefined();
  });
});