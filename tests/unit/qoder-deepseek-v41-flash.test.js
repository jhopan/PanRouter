// DeepSeek-V4.1-Flash-1017 is currently free on Qoder. It is exposed as
// `dfmodel_v41` (following the existing `dfmodel` = DeepSeek-V4-Flash naming)
// with the 200K context the Qoder UI advertises.
import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { QODER_MODEL_MAP } from "../../open-sse/shared/qoder/constants.js";

const ids = (key) => (PROVIDER_MODELS[key] || []).map((m) => m.id);

describe("Qoder DeepSeek-V4.1-Flash (free)", () => {
  it("is exposed on the intl Qoder provider", () => {
    // alias "qd" is the PROVIDER_MODELS key for provider id "qoder"
    expect(ids("qd")).toContain("dfmodel_v41");
  });

  it("is exposed on the CN Qoder provider", () => {
    expect(ids("qdcn")).toContain("dfmodel_v41");
  });

  it("is labelled as the free DeepSeek flash model", () => {
    const entry = (PROVIDER_MODELS["qd"] || []).find((m) => m.id === "dfmodel_v41");
    expect(entry?.name).toMatch(/deepseek/i);
    expect(entry?.name).toMatch(/free/i);
  });

  it("publishes the advertised 200K context window", () => {
    expect(getCapabilitiesForModel("qoder", "dfmodel_v41")).toMatchObject({
      contextWindow: 200000,
      reasoning: true,
      thinkingFormat: "deepseek",
    });
  });

  it("is registered in the qoder model map", () => {
    expect(QODER_MODEL_MAP.dfmodel_v41).toBe("dfmodel_v41");
  });

  it("keeps the older DeepSeek-V4-Flash entry intact", () => {
    expect(ids("qdcn")).toContain("dfmodel");
    expect(getCapabilitiesForModel("qoder", "dfmodel").contextWindow).toBe(1000000);
  });
});
