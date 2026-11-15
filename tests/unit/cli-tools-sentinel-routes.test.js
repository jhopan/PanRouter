/**
 * CLI settings routes must never write the legacy "sk_9router" placeholder.
 *
 * #4399 fix: opencode, deepseek-tui and grok-build now resolve the key through
 * resolveCliApiKey() — caller key first, then the first active dashboard key,
 * else an empty value — exactly like copilot/crush/forge already did.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMock = vi.hoisted(() => ({
  store: null,
  readFile: vi.fn(async () => {
    if (fsMock.store === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return fsMock.store;
  }),
  writeFile: vi.fn(async (_p, content) => { fsMock.store = content; }),
  mkdir: vi.fn(async () => {}),
  access: vi.fn(async () => {}),
}));

vi.mock("fs/promises", () => ({ default: fsMock, ...fsMock }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) =>
      new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const db = vi.hoisted(() => ({ keys: [] }));
vi.mock("@/lib/db", () => ({ getApiKeys: vi.fn(async () => db.keys) }));

const { POST: opencodePost } = await import("../../src/app/api/cli-tools/opencode-settings/route.js");
const { POST: deepseekPost } = await import("../../src/app/api/cli-tools/deepseek-tui-settings/route.js");
const { POST: grokPost } = await import("../../src/app/api/cli-tools/grok-build-settings/route.js");

const ACTIVE_KEY = "sk-db-active";
const BASE_URL = "http://localhost:20128";
const MODEL = "cc/claude-sonnet-5-5";

const applyOpencode = (apiKey) =>
  opencodePost({ json: async () => ({ baseUrl: BASE_URL, apiKey, models: [MODEL] }) });
const applyDeepseek = (apiKey) =>
  deepseekPost({ json: async () => ({ baseUrl: BASE_URL, apiKey, model: MODEL }) });
const applyGrok = (apiKey) =>
  grokPost({ json: async () => ({ baseUrl: BASE_URL, apiKey, model: MODEL }) });

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.store = null;
  db.keys = [{ key: ACTIVE_KEY, isActive: true }];
});

describe("CLI settings routes resolve the API key instead of writing sk_9router", () => {
  it("opencode writes the first active dashboard key when the caller sends none", async () => {
    await applyOpencode("");
    expect(JSON.parse(fsMock.store).provider["9router"].options.apiKey).toBe(ACTIVE_KEY);
  });

  it("deepseek-tui writes the first active dashboard key when the caller sends none", async () => {
    await applyDeepseek(undefined);
    expect(fsMock.store).toContain(`api_key = "${ACTIVE_KEY}"`);
  });

  it("grok-build writes the first active dashboard key when the caller sends none", async () => {
    await applyGrok("");
    expect(fsMock.store).toContain(`api_key = "${ACTIVE_KEY}"`);
  });

  it("keeps an explicit caller key on every route", async () => {
    const callerKey = "sk-caller-key";
    await applyOpencode(callerKey);
    expect(JSON.parse(fsMock.store).provider["9router"].options.apiKey).toBe(callerKey);

    await applyDeepseek(callerKey);
    expect(fsMock.store).toContain(`api_key = "${callerKey}"`);

    await applyGrok(callerKey);
    expect(fsMock.store).toContain(`api_key = "${callerKey}"`);
  });

  it("treats the legacy sk_9router caller value as absent", async () => {
    await applyOpencode("sk_9router");
    expect(JSON.parse(fsMock.store).provider["9router"].options.apiKey).toBe(ACTIVE_KEY);

    await applyDeepseek("sk_9router");
    expect(fsMock.store).toContain(`api_key = "${ACTIVE_KEY}"`);

    await applyGrok("sk_9router");
    expect(fsMock.store).toContain(`api_key = "${ACTIVE_KEY}"`);
    expect(fsMock.store).not.toContain("sk_9router");
  });

  it("writes no placeholder when the dashboard has no active key", async () => {
    db.keys = [{ key: "sk-inactive", isActive: false }];

    await applyOpencode("");
    const opencodeConfig = JSON.parse(fsMock.store);
    expect(opencodeConfig.provider["9router"].options.apiKey).toBe("");
    expect(JSON.stringify(opencodeConfig)).not.toContain("sk_9router");

    await applyDeepseek("");
    expect(fsMock.store).toContain('api_key = ""');
    expect(fsMock.store).not.toContain("sk_9router");

    fsMock.store = null;
    await applyGrok("");
    expect(fsMock.store).not.toContain("api_key");
    expect(fsMock.store).not.toContain("sk_9router");
    expect(fsMock.store).not.toContain("sk_PanRouter");
  });
});