import { describe, expect, it } from "vitest";
import {
  PATTERN_PRICING,
  getPricingForModel,
} from "../../open-sse/providers/pricing.js";

// Gemini 4 bills at its own rate, not the generic `gemini-*` fallback. PATTERN_PRICING
// is scanned in order and the first glob match wins, so the entry has to sit BEFORE
// the generic patterns or it is never reached.
describe("gemini-4 pricing", () => {
  it("declares a gemini-4-* pattern", () => {
    expect(PATTERN_PRICING.some((r) => r.pattern === "gemini-4-*")).toBe(true);
  });

  it("orders gemini-4-* ahead of the generic gemini-* fallback", () => {
    const idx = (p) => PATTERN_PRICING.findIndex((r) => r.pattern === p);
    expect(idx("gemini-4-*")).toBeGreaterThan(-1);
    expect(idx("gemini-4-*")).toBeLessThan(idx("gemini-*"));
  });

  it("bills a gemini-4 model at the gemini-4 rate", () => {
    const p = getPricingForModel("antigravity", "gemini-4-argon-high");
    expect(p).toMatchObject({ input: 2, output: 10, cached: 0.1 });
  });

  it("does not charge gemini-4 rates for gemini-3", () => {
    const p = getPricingForModel("antigravity", "gemini-3.8-flash-high");
    expect(p.output).not.toBe(10);
  });
});
