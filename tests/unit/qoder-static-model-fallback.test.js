// The Qoder CLI shows models (e.g. DeepSeek-Flash / dfmodel_v41) that the
// account's API catalog may not expose yet. The catalog is the source of truth
// for `model_config`, and a miss used to be fatal locally:
//
//   qoder: model_config for "dfmodel_v41" not yet known
//
// The static QODER_MODEL_MAP already knows the key, so a miss should fall back
// to a minimal config and let upstream answer — a real upstream error is far
// more useful than a local refusal.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { QODER_MODEL_MAP } from "../../open-sse/shared/qoder/constants.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");
const qoderExec = read("../open-sse/executors/qoder.js");

describe("qoder — static map fallback", () => {
  it("knows dfmodel_v41", () => {
    expect(QODER_MODEL_MAP.dfmodel_v41).toBe("dfmodel_v41");
  });

  it("falls back to the static map when the catalog misses", () => {
    expect(qoderExec).toContain("QODER_MODEL_MAP[qoderKey]");
    expect(qoderExec).toMatch(/falling back to static map/);
  });

  it("builds a usable config from the static entry", () => {
    // Without max_input_tokens/max_output_tokens the request builder would
    // produce a body upstream rejects for a different reason.
    expect(qoderExec).toMatch(/max_input_tokens: 200_000/);
    expect(qoderExec).toMatch(/max_output_tokens: 65_536/);
  });

  it("still refuses a key nobody knows", () => {
    expect(qoderExec).toMatch(/not yet known/);
  });
});

describe("qoder — catalog parsing", () => {
  const models = read("../open-sse/services/qoderModels.js");

  it("keeps UI-hidden models routable while hiding them from the picker", async () => {
    // enable:false models are hidden in the IDE but chat still accepts them;
    // their rawConfig must stay cached either way. The visible/importable list
    // is gated by the opt-in instead of a hard filter.
    const { includeQoderCatalogEntry, qoderFullCatalogEnabled } = await import("../../open-sse/services/qoderModels.js");
    const hidden = { key: "Qwen4-Max-Preview", enable: false };
    expect(includeQoderCatalogEntry(hidden, false)).toBe(false);
    expect(includeQoderCatalogEntry(hidden, true)).toBe(true);
    expect(typeof qoderFullCatalogEnabled()).toBe("boolean");
    // The cache write must happen before the gate, or chat loses the config.
    const src = read("../open-sse/services/qoderModels.js");
    const cacheAt = src.indexOf("rawConfigs.set(key, entry)");
    const gateAt = src.indexOf("includeQoderCatalogEntry(entry)");
    expect(cacheAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(cacheAt);
  });

  it("reads the same endpoint the CLI uses", () => {
    expect(models).toContain("/algo/api/v2/model/list");
  });
});
