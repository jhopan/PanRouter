import { describe, expect, it, vi } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const PROVIDER = "claude";
const MODEL = "claude-sonnet-5-5";

async function listFor(providerId, modelId) {
  db.getProviderConnections.mockResolvedValue([{
    id: 1,
    provider: providerId,
    isActive: true,
    authType: "oauth",
    providerSpecificData: { enabledModels: [modelId] },
  }]);
  const models = await buildModelsList(["llm"]);
  return models.find((m) => m.id.endsWith(`/${modelId}`));
}

describe("/v1/models thinking_levels", () => {
  it("publishes the same levels the dashboard picker uses", async () => {
    const levels = getThinkingLevels(PROVIDER, MODEL);
    expect(Array.isArray(levels)).toBe(true);

    const entry = await listFor(PROVIDER, MODEL);
    expect(entry).toBeDefined();
    expect(entry.thinking_levels).toEqual(levels);
    expect(entry.thinking_levels.length).toBeGreaterThan(0);
  });

  it("omits the field for models without reasoning levels", async () => {
    const entry = await listFor(PROVIDER, "custom-plain-model");
    expect(entry).toBeDefined();
    expect(getThinkingLevels(PROVIDER, "custom-plain-model")).toBeNull();
    expect(entry).not.toHaveProperty("thinking_levels");
  });

  it("leaves non-LLM kinds untouched", async () => {
    db.getProviderConnections.mockResolvedValue([{
      id: 2,
      provider: "openai",
      isActive: true,
      providerSpecificData: { enabledModels: ["gpt-image-1"] },
    }]);
    const imageModels = await buildModelsList(["image"]);
    for (const entry of imageModels) {
      expect(entry).not.toHaveProperty("thinking_levels");
    }
  });
});