// Which DeepSeek model is actually FREE on Qoder?
//
// The Qoder IDE advertises DeepSeek-Flash as free, and the spec sheet says
// DeepSeek-V4.1-Flash-1017 — but that is the IDE tier. Through the OAuth API a
// free account gets:
//
//   dfmodel      → 200 OK (verified: DONE 1931ms, IN 31 / OUT 91)
//   dfmodel_v41  → 403 code 112 {"pricingUrl":"https://qoder.com/pricing"}
//
// So `dfmodel` is the free one and `dfmodel_v41` needs credits. The registry
// must say so, otherwise the UI promises a free model that answers with a
// payment prompt.
import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { QODER_MODEL_MAP } from "../../open-sse/shared/qoder/constants.js";

const ids = (key) => (PROVIDER_MODELS[key] || []).map((m) => m.id);
const entry = (key, id) => (PROVIDER_MODELS[key] || []).find((m) => m.id === id);

describe("Qoder — dfmodel is the free DeepSeek", () => {
  it("is exposed on both regions", () => {
    expect(ids("qd")).toContain("dfmodel");
    expect(ids("qdcn")).toContain("dfmodel");
  });

  it("is labelled free", () => {
    expect(entry("qd", "dfmodel")?.name).toMatch(/deepseek/i);
    expect(entry("qd", "dfmodel")?.name).toMatch(/free/i);
    expect(entry("qdcn", "dfmodel")?.name).toMatch(/free/i);
  });

  it("keeps its 1M context window", () => {
    expect(getCapabilitiesForModel("qoder", "dfmodel")).toMatchObject({
      contextWindow: 1000000,
      reasoning: true,
      thinkingFormat: "deepseek",
    });
  });

  it("is in the model map", () => {
    expect(QODER_MODEL_MAP.dfmodel).toBe("dfmodel");
  });
});

describe("Qoder — dfmodel_v41 is NOT free", () => {
  it("is still listed, so a paid account can use it", () => {
    expect(ids("qd")).toContain("dfmodel_v41");
    expect(ids("qdcn")).toContain("dfmodel_v41");
  });

  it("is not labelled free", () => {
    const intl = entry("qd", "dfmodel_v41");
    const cn = entry("qdcn", "dfmodel_v41");
    expect(intl?.name).not.toMatch(/free/i);
    expect(cn?.name).not.toMatch(/free/i);
  });

  it("is labelled paid", () => {
    expect(entry("qd", "dfmodel_v41")?.name).toMatch(/paid/i);
    expect(entry("qdcn", "dfmodel_v41")?.name).toMatch(/paid/i);
  });

  it("keeps the 200K context it advertises", () => {
    expect(getCapabilitiesForModel("qoder", "dfmodel_v41").contextWindow).toBe(200000);
  });

  it("is in the model map", () => {
    expect(QODER_MODEL_MAP.dfmodel_v41).toBe("dfmodel_v41");
  });
});
