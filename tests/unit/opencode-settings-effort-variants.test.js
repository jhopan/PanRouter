import { describe, expect, it, vi } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

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

const { POST } = await import("../../src/app/api/cli-tools/opencode-settings/route.js");

const MODEL = "cc/claude-sonnet-5-5";
const post = (body) => POST({ json: async () => body });
const written = () => JSON.parse(fsMock.store).provider["9router"].models;

describe("opencode-settings POST effort variants", () => {
  it("writes variants from the levels PanRouter offers for the model", async () => {
    fsMock.store = null;
    await post({ baseUrl: "http://localhost:20128", models: [MODEL] });
    const levels = getThinkingLevels("claude", "claude-sonnet-5-5");
    expect(levels.length).toBeGreaterThan(0);
    expect(Object.keys(written()[MODEL].variants)).toEqual(levels);
    expect(written()[MODEL].variants.high).toEqual({ reasoningEffort: "high" });
  });

  it("keeps variants the user already customized", async () => {
    const custom = { low: { reasoningEffort: "low" } };
    fsMock.store = JSON.stringify({
      provider: {
        "9router": {
          npm: "@ai-sdk/openai-compatible",
          options: {},
          models: { [MODEL]: { name: "x", variants: custom } },
        },
      },
    });
    await post({ baseUrl: "http://localhost:20128", models: [MODEL] });
    expect(written()[MODEL].variants).toEqual(custom);
  });

  it("writes no variants for a model without reasoning levels", async () => {
    fsMock.store = null;
    await post({ baseUrl: "http://localhost:20128", models: ["cc/custom-plain-model"] });
    expect(written()["cc/custom-plain-model"]).not.toHaveProperty("variants");
  });
});