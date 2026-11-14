import { describe, expect, it, vi } from "vitest";

import { resolveSmartChoice } from "../../src/sse/services/systemoneRouter.js";

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

// The resolver is a thin in-process adapter around handleSystemoneCore; these cases cover the
// fail-open edges that must never reach the combo dispatch as an exception.
describe("System One resolver fail-open edges", () => {
  it("skips evaluation for a single-candidate combo", async () => {
    expect(await resolveSmartChoice({ body: { messages: [{ role: "user", content: "hi" }] }, models: ["a/one"], log })).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("skips evaluation when the request carries no prompt text", async () => {
    expect(await resolveSmartChoice({ body: { messages: [] }, models: ["a/one", "b/two"], log })).toBeNull();
  });
});