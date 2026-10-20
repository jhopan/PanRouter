// Auto-ping must not fail when the configured model is plan-gated. Free
// accounts answer 11158 ("model X is not allowed for user type
// personal_free_user") for concrete model ids such as gpt-5.6-luna, so the
// ping walks a fallback chain and stops early on credits-exhausted.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { CODEBUDDY_AUTOPING_CONFIG as C } from "../../src/shared/constants/config.js";

const source = fs.readFileSync(
  path.resolve("../src/shared/services/codebuddyAutoPing.js"),
  "utf8",
);

describe("CodeBuddy auto-ping model selection", () => {
  it("uses the tier-agnostic fast-model alias, not a plan-gated id", () => {
    expect(C.pingModel).toBe("fast-model");
    // gpt-5.6-luna is gated per plan — it caused 11158 on personal_free_user.
    expect(C.pingModel).not.toMatch(/gpt-5\.\d/);
  });

  it("declares a fallback chain", () => {
    expect(Array.isArray(C.pingModelFallbacks)).toBe(true);
    expect(C.pingModelFallbacks.length).toBeGreaterThan(0);
  });

  it("walks the candidate list in the ping implementation", () => {
    expect(source).toContain("pingModelFallbacks");
    expect(source).toContain("for (const candidate of candidates)");
  });

  it("retries only on a model-gating rejection", () => {
    // 11158 / 11101 / "not allowed for user type" are the gating signals.
    expect(source).toMatch(/11158/);
    expect(source).toMatch(/not allowed for user type/i);
  });

  it("stops immediately on credits exhausted (429) instead of trying more models", () => {
    expect(source).toMatch(/lastStatus === 429/);
    expect(source).toContain("credits exhausted");
  });
});
