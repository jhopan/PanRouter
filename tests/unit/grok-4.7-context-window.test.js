import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import grokCli from "../../open-sse/providers/registry/grok-cli.js";
import xai from "../../open-sse/providers/registry/xai.js";

// Ported from upstream b0655314. grok-4.7 had no pattern row, so it fell through
// to the `*grok-4*` catch-all and advertised a 256k window. A combo reports its
// smallest member, so any combo containing grok-4.7 showed 256k and
// stripHistoryForContext() trimmed history at 80% of that.
describe("Grok 4.7 context window", () => {
  it("advertises the real 500k window, not the 256k catch-all", () => {
    const caps = getCapabilitiesForModel("xai", "grok-4.7");
    expect(caps.contextWindow).toBe(500000);
  });

  it("keeps the Grok feature envelope", () => {
    const caps = getCapabilitiesForModel("xai", "grok-4.7");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.search).toBe(true);
    expect(caps.thinkingFormat).toBe("openai");
  });

  it("applies to variant ids too", () => {
    for (const id of ["grok-4.7-high", "grok-4.7-thinking", "grok-4.7-low"]) {
      expect(getCapabilitiesForModel("xai", id).contextWindow).toBe(500000);
    }
  });

  it("is listed in both Grok registries", () => {
    const ids = (registry) => (registry.models || []).map((m) => m.id);
    expect(ids(xai)).toContain("grok-4.7");
    expect(ids(grokCli)).toContain("grok-4.7");
  });
});
