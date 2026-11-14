import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

const originalFetch = global.fetch;
const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");

const call = () => GET(new Request("http://localhost/api/providers/conn-1/models"), {
  params: Promise.resolve({ id: "conn-1" }),
});

const modelsPayload = {
  data: [
    { id: "claude-fable-5-2", display_name: "Claude Fable 5.2" },
    { id: "claude-opus-5", display_name: "" },
  ],
};

describe("Claude live model list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("lists models over OAuth with Bearer + the oauth beta header", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "claude",
      accessToken: "sk-ant-oat-test",
      refreshToken: "rt",
      providerSpecificData: {},
    });
    global.fetch.mockResolvedValue(new Response(JSON.stringify(modelsPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual([
      { id: "claude-fable-5-2", name: "Claude Fable 5.2" },
      // Empty display_name must not blank the label.
      { id: "claude-opus-5", name: "claude-opus-5" },
    ]);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(init.headers.Authorization).toBe("Bearer sk-ant-oat-test");
    expect(init.headers["Anthropic-Beta"]).toBe("oauth-2025-04-20");
    expect(init.headers["x-api-key"]).toBeUndefined();
  });

  it("keeps x-api-key auth for a plain API-key connection", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "claude",
      apiKey: "sk-ant-api-test",
      providerSpecificData: {},
    });
    global.fetch.mockResolvedValue(new Response(JSON.stringify(modelsPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await call();

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("sk-ant-api-test");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("fails open to the static catalog when upstream rejects the request", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "claude",
      accessToken: "sk-ant-oat-test",
      providerSpecificData: {},
    });
    global.fetch.mockResolvedValue(new Response("{\"error\":\"invalid_request\"}", { status: 400 }));

    const res = await call();
    const body = await res.json();

    // 200 + no models: the dashboard keeps the registry-pinned catalog.
    expect(res.status).toBe(200);
    expect(body.models).toEqual([]);
    expect(body.warning).toContain("400");
  });
});