import { describe, it, expect } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

// Agnes AI: HTTP 400 "max_tokens exceeds the limit of 4096" is the error.
// The fix: add { provider: "agnes", maxOutputCap: 4096 } to STRIP_RULES.

describe("Agnes AI max_tokens cap", () => {
  it("clamps max_tokens > 4096 to 4096", () => {
    const body = { messages: [], max_tokens: 16384 };
    stripUnsupportedParams("agnes", "agnes-3.0-flash", body);
    expect(body.max_tokens).toBe(4096);
  });

  it("clamps max_tokens = 8192 to 4096", () => {
    const body = { messages: [], max_tokens: 8192 };
    stripUnsupportedParams("agnes", "agnes-2.5-flash", body);
    expect(body.max_tokens).toBe(4096);
  });

  it("leaves max_tokens <= 4096 untouched", () => {
    const body = { messages: [], max_tokens: 2048 };
    stripUnsupportedParams("agnes", "agnes-3.0-flash", body);
    expect(body.max_tokens).toBe(2048);
  });

  it("leaves max_tokens = 4096 untouched (exact limit)", () => {
    const body = { messages: [], max_tokens: 4096 };
    stripUnsupportedParams("agnes", "agnes-3.0-flash", body);
    expect(body.max_tokens).toBe(4096);
  });

  it("does not affect other providers", () => {
    const body = { messages: [], max_tokens: 16384 };
    stripUnsupportedParams("openai", "gpt-4o", body);
    expect(body.max_tokens).toBe(16384);
  });

  it("works when max_tokens is absent", () => {
    const body = { messages: [] };
    stripUnsupportedParams("agnes", "agnes-3.0-flash", body);
    expect(body.max_tokens).toBeUndefined();
  });
});
