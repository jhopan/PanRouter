/**
 * suggested-models filters — the `openai` pass-through type used by the
 * dahl/perplexity-agent/tokenrouter/venice/vercel-ai-gateway registries and the
 * MiniMax Code (mcode) live catalog both used to 400 as unknown filter types.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) =>
      new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import { GET } from "../../src/app/api/providers/suggested-models/route.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai pass-through filter", () => {
  it("normalizes an OpenAI /v1/models catalogue in provider order", () => {
    const rows = FILTERS["openai"]([
      { id: "zai-org/GLM-5.3-Flash", object: "model" },
      { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", context_length: 200000 },
    ]);

    expect(rows).toEqual([
      { id: "zai-org/GLM-5.3-Flash", name: "zai-org/GLM-5.3-Flash", contextLength: undefined },
      { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", contextLength: 200000 },
    ]);
  });

  it("drops entries without a usable id and tolerates non-array input", () => {
    expect(FILTERS["openai"]([{ name: "no id" }, null, { id: "  " }])).toEqual([]);
    expect(FILTERS["openai"](undefined)).toEqual([]);
  });
});

describe("minimax-code live catalog filter", () => {
  it("parses the mavis catalog shape, biggest context first", () => {
    const rows = FILTERS["minimax-code"]([
      {
        providers: [
          {
            providerId: "minimax",
            config: {
              models: {
                "MiniMax-M3.1-Flash-Preview": { name: "M3.1 Flash", limit: { context: 512000 } },
                "MiniMax-M3": { name: "MiniMax M3", limit: { context: 512000 } },
                bad: null,
              },
            },
          },
        ],
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("MiniMax-M3.1-Flash-Preview");
    expect(rows[0].contextLength).toBe(512000);
    expect(rows.map((r) => r.id)).toContain("MiniMax-M3");
  });

  it("returns [] for a malformed payload", () => {
    expect(FILTERS["minimax-code"]([{ providers: [] }])).toEqual([]);
    expect(FILTERS["minimax-code"]([])).toEqual([]);
  });
});

describe("suggested-models route", () => {
  const request = (type, url) =>
    GET(new Request(`http://localhost/api/providers/suggested-models?url=${encodeURIComponent(url)}&type=${type}`));

  it("serves the openai type instead of 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ object: "list", data: [{ id: "m1", name: "M1", context_length: 131072 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })));

    const res = await request("openai", "https://api.venice.ai/api/v1/models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: "m1", name: "M1", contextLength: 131072 }] });
  });

  it("wraps an object-shaped catalog so minimax-code can read it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        providers: [{ providerId: "minimax", config: { models: { "MiniMax-M3": { name: "MiniMax M3", limit: { context: 512000 } } } } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const res = await request("minimax-code", "https://agent.minimax.io/mavis/api/v1/models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: "MiniMax-M3", name: "MiniMax M3", contextLength: 512000 }] });
  });

  it("still rejects an unknown type", async () => {
    const res = await request("nope", "https://example.com/models");
    expect(res.status).toBe(400);
  });
});
