import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// PROVIDER_MODELS is keyed by registry alias, not by provider id — CodeBuddy CN
// is registered as `cbcn` (see open-sse/providers/registry/codebuddy-cn.js).
const ids = () => (PROVIDER_MODELS["cbcn"] || []).map((model) => model.id);

describe("CodeBuddy CN 2026-09-30 catalog", () => {
  it("exposes Kimi K2.8 and removes retired K2.6/K2.7 and GLM vision entries", () => {
    expect(ids()).toContain("kimi-k2.8-preview");
    expect(ids()).not.toEqual(expect.arrayContaining(["kimi-k2.6", "kimi-k2.7", "glm-5v-turbo"]));
  });

  it("uses published K2.8 capability and DeepSeek reasoning levels", () => {
    expect(getCapabilitiesForModel("codebuddy-cn", "kimi-k2.8-preview")).toMatchObject({
      contextWindow: 300000,
      maxOutput: 131072,
    });
    expect(getThinkingLevels("codebuddy-cn", "deepseek-v4.1-flash")).toEqual(["low", "high", "max"]);
  });
});
