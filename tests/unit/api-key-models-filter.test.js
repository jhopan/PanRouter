import { describe, expect, it } from "vitest";
import { filterModelsByKeyLimits } from "../../src/lib/apiKeyLimits.js";

const list = [
  { id: "oc/big-pickle", root: "big-pickle" },
  { id: "codex/gpt-5.6-terra", root: "gpt-5.6-terra" },
  { id: "claude/claude-opus-5" },
];

describe("filterModelsByKeyLimits", () => {
  it("returns the full list when the key has no limits blob", () => {
    expect(filterModelsByKeyLimits(list, null)).toBe(list);
    expect(filterModelsByKeyLimits(list, undefined)).toBe(list);
  });

  it("returns the full list when models is null or empty", () => {
    expect(filterModelsByKeyLimits(list, { models: null })).toBe(list);
    expect(filterModelsByKeyLimits(list, { models: [] })).toBe(list);
  });

  it("keeps only models present in the allowlist", () => {
    const out = filterModelsByKeyLimits(list, { models: ["oc/big-pickle"] });
    expect(out.map((m) => m.id)).toEqual(["oc/big-pickle"]);
  });

  it("matches the allowlist entry without the provider prefix", () => {
    const out = filterModelsByKeyLimits(list, { models: ["gpt-5.6-terra"] });
    expect(out.map((m) => m.id)).toEqual(["codex/gpt-5.6-terra"]);
  });

  it("matches on root when the allowlist names the upstream id", () => {
    const out = filterModelsByKeyLimits(list, { models: ["big-pickle"] });
    expect(out.map((m) => m.id)).toEqual(["oc/big-pickle"]);
  });

  it("drops entries without an id", () => {
    const out = filterModelsByKeyLimits([{ root: "x" }, ...list], { models: ["claude/claude-opus-5"] });
    expect(out.map((m) => m.id)).toEqual(["claude/claude-opus-5"]);
  });

  it("returns an empty list when nothing is allowed", () => {
    expect(filterModelsByKeyLimits(list, { models: ["nothing/here"] })).toEqual([]);
  });

  it("never throws on malformed input", () => {
    expect(() => filterModelsByKeyLimits(null, { models: ["x"] })).not.toThrow();
    expect(filterModelsByKeyLimits(list, {})).toBe(list);
  });
});
