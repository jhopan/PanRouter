import { describe, it, expect, afterEach } from "vitest";
import { includeQoderCatalogEntry, qoderFullCatalogEnabled } from "../../open-sse/services/qoderModels.js";
import { applyQoderModelNames } from "../../src/shared/utils/providerCustomModels.js";

// Upstream 597ee684 stopped filtering `enable:false` catalog entries (the IDE
// still serves some, e.g. Qwen4-Max-Preview under qmodel_latest) and started
// using the upstream display name for imported models. PanRouter keeps the
// narrow default and only widens the visible/importable list on opt-in, while
// the raw config of every key is cached regardless (chat routing unchanged).
describe("Qoder catalog exposure", () => {
  const original = process.env.QODER_FULL_CATALOG;

  afterEach(() => {
    if (original === undefined) delete process.env.QODER_FULL_CATALOG;
    else process.env.QODER_FULL_CATALOG = original;
  });

  it("hides enable:false entries by default", () => {
    delete process.env.QODER_FULL_CATALOG;
    expect(qoderFullCatalogEnabled()).toBe(false);
    expect(includeQoderCatalogEntry({ key: "qmodel_latest", enable: true })).toBe(true);
    expect(includeQoderCatalogEntry({ key: "Qwen4-Max-Preview", enable: false })).toBe(false);
    // A missing flag is not "disabled".
    expect(includeQoderCatalogEntry({ key: "qfmodel" })).toBe(true);
  });

  it("shows every entry when the opt-in is on", () => {
    process.env.QODER_FULL_CATALOG = "true";
    expect(qoderFullCatalogEnabled()).toBe(true);
    expect(includeQoderCatalogEntry({ key: "Qwen4-Max-Preview", enable: false })).toBe(true);
    expect(includeQoderCatalogEntry({ key: "qfmodel" })).toBe(true);
  });

  it("treats other values as off", () => {
    process.env.QODER_FULL_CATALOG = "1";
    expect(qoderFullCatalogEnabled()).toBe(false);
    process.env.QODER_FULL_CATALOG = "TRUE";
    expect(qoderFullCatalogEnabled()).toBe(true);
  });
});

describe("applyQoderModelNames", () => {
  const customModels = [
    { providerAlias: "qd", id: "qmodel_latest", name: "Qwen4 Max Preview", type: "llm" },
    { providerAlias: "qd", id: "qfmodel", name: "qfmodel", type: "llm" },
    { providerAlias: "qd", id: "embed-x", name: "Embed X", type: "embedding" },
    { providerAlias: "cbai", id: "default-model", name: "Default Model", type: "llm" },
  ];

  it("renames only the Qoder entries the user already imported", () => {
    const out = applyQoderModelNames(
      [
        { id: "qmodel_latest", name: "stale name" },
        { id: "qfmodel", name: "Qwen3.8 Flash (Free)" },
      ],
      customModels,
      "qd",
    );
    expect(out[0].name).toBe("Qwen4 Max Preview");
    // name === id is not a rename, so the registry name survives
    expect(out[1].name).toBe("Qwen3.8 Flash (Free)");
  });

  it("leaves other providers untouched", () => {
    const models = [{ id: "default-model", name: "Default" }];
    expect(applyQoderModelNames(models, customModels, "cbai")).toBe(models);
    expect(applyQoderModelNames(models, customModels, "qdcn")[0].name).toBe("Default");
  });
});
