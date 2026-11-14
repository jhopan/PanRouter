/**
 * Sonus (`smodel`) / Cantus (`cmodel`) routing.
 *
 * Qoder's per-account catalog omits this frontier pair even for accounts that
 * can use it. The chat endpoint does not validate `model_config.key` against
 * the catalog, so the executor supplies a static block instead of refusing the
 * request. Verified live on upstream: both keys are accepted and stream a
 * completion, and queue/status echoes modelKey=smodel / modelKey=cmodel back.
 */

import { describe, it, expect } from "vitest";
import {
  QODER_MODEL_MAP,
  QODER_STATIC_MODEL_CONFIGS,
  getQoderStaticModelConfig,
} from "../../open-sse/shared/qoder/constants.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { routableQoderModels } from "../../open-sse/services/qoderModels.js";
import qoderRegistry from "../../open-sse/providers/registry/qoder.js";

describe("Qoder static model configs", () => {
  it("defines both frontier keys", () => {
    expect(Object.keys(QODER_STATIC_MODEL_CONFIGS).sort()).toEqual(["cmodel", "smodel"]);
  });

  it("maps the canonical keys into QODER_MODEL_MAP", () => {
    expect(QODER_MODEL_MAP.smodel).toBe("smodel");
    expect(QODER_MODEL_MAP.cmodel).toBe("cmodel");
  });

  it("returns a usable model_config block", () => {
    const cfg = getQoderStaticModelConfig("smodel");
    expect(cfg).toMatchObject({
      key: "smodel",
      display_name: "Sonus",
      format: "openai",
      source: "system",
      is_vl: true,
      is_reasoning: true,
    });
    expect(cfg.max_input_tokens).toBeGreaterThan(0);
  });

  it("returns a fresh copy so callers can mutate it", () => {
    const a = getQoderStaticModelConfig("cmodel");
    a.key = "mutated";
    expect(getQoderStaticModelConfig("cmodel").key).toBe("cmodel");
  });

  it("returns null for a key with no static block", () => {
    // Genuinely unknown keys must still fail loudly rather than get a
    // fabricated config that upstream would silently ignore.
    expect(getQoderStaticModelConfig("dmodel")).toBeNull();
    expect(getQoderStaticModelConfig("not-a-model")).toBeNull();
  });
});

describe("Qoder capabilities", () => {
  it("marks the frontier pair vision + reasoning", () => {
    for (const key of ["smodel", "cmodel"]) {
      const caps = getCapabilitiesForModel("qoder", key);
      expect(caps.vision).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.contextWindow).toBeGreaterThan(0);
    }
  });

  it("gives opaque concrete ids a real window instead of the heuristic default", () => {
    // `dmodel` / `kmodel` / `qmodel_38max` / `gmodel` match no pattern, so
    // without the provider table they fall through to the generic 200K default.
    // Vision follows the upstream is_vl flag: DeepSeek-Pro/GLM-5.3 are text-only.
    for (const key of ["dmodel", "kmodel", "qmodel_38max", "gmodel"]) {
      const caps = getCapabilitiesForModel("qoder", key);
      expect(caps.contextWindow).toBeGreaterThanOrEqual(200000);
      expect(caps.reasoning).toBe(true);
    }
    expect(getCapabilitiesForModel("qoder", "kmodel").vision).toBe(true);
    expect(getCapabilitiesForModel("qoder", "qmodel_38max").vision).toBe(true);
  });

  it("shares the table with qoder-cn", () => {
    expect(getCapabilitiesForModel("qoder-cn", "dmodel")).toEqual(
      getCapabilitiesForModel("qoder", "dmodel"),
    );
    expect(getCapabilitiesForModel("qoder-cn", "smodel")).toEqual(
      getCapabilitiesForModel("qoder", "smodel"),
    );
  });
});

describe("Qoder registry", () => {
  it("advertises Sonus and Cantus", () => {
    const ids = (qoderRegistry.models || []).map((m) => m.id);
    expect(ids).toContain("smodel");
    expect(ids).toContain("cmodel");
  });

  it("uses the display names from the Qoder picker", () => {
    const byId = Object.fromEntries((qoderRegistry.models || []).map((m) => [m.id, m.name]));
    expect(byId.smodel).toBe("Sonus");
    expect(byId.cmodel).toBe("Cantus");
  });
});

describe("routableQoderModels — static fallback keys", () => {
  it("keeps Sonus/Cantus routable even when the live catalog omits them", () => {
    const out = routableQoderModels({ models: [{ id: "auto", name: "Auto" }], rawConfigs: new Map() });
    const ids = out.map((m) => m.id);
    expect(ids).toContain("smodel");
    expect(ids).toContain("cmodel");
    expect(ids).toContain("auto");
    expect(out.find((m) => m.id === "smodel").name).toBe("Sonus");
  });

  it("lets a live catalog entry win over the static block", () => {
    const out = routableQoderModels({
      models: [{ id: "smodel", name: "Sonus (live)" }],
      rawConfigs: new Map(),
    });
    const smodel = out.filter((m) => m.id === "smodel");
    expect(smodel).toHaveLength(1);
    expect(smodel[0].name).toBe("Sonus (live)");
  });
});
