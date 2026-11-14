import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_IDE_VERSION,
  ANTIGRAVITY_IDE_USER_AGENT,
} from "../../open-sse/providers/shared.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";

// Ported from upstream f172c3c4.
//
// The cloudcode-pa gateway reads the client identity out of the user agent. Our
// old string was `antigravity/ide/2.19.1`; the shipping client is the Antigravity
// *Hub* desktop build. Upstream's commit ties the shape change to 404s on newer
// model tiers — note that on an account without entitlement the tier still 404s
// (ours reports `gemini-4-argon-disabled`), so this test guards the identity
// itself, not a promise that every tier resolves.
describe("Antigravity client identity", () => {
  it("names the Hub client, not the IDE one", () => {
    expect(ANTIGRAVITY_IDE_USER_AGENT).toMatch(/^antigravity\/hub\//);
    expect(ANTIGRAVITY_IDE_USER_AGENT).not.toContain("antigravity/ide/");
  });

  it("tracks a real Hub build, not a stale one", () => {
    expect(ANTIGRAVITY_IDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    // The UA version is the *Hub* app's version, not the IDE's: the old 2.19.1
    // matched the Hub installed on 2026-10-01, and upstream's 2.24.0 sits on the
    // same line. 2.32.1 is the Hub build current as of 2026-11-14.
    const [maj, min] = ANTIGRAVITY_IDE_VERSION.split(".").map(Number);
    expect(maj > 2 || (maj === 2 && min >= 32)).toBe(true);
  });

  it("keeps the darwin/arm64 platform profile deliberately", () => {
    // Static on purpose: the provider mimics the macOS Hub client regardless of
    // the host the router runs on. Upstream documents the same choice.
    expect(ANTIGRAVITY_IDE_USER_AGENT).toMatch(/darwin\/arm64$/);
  });

  it("carries the same version in the UA and the client-version header", () => {
    expect(ANTIGRAVITY_IDE_USER_AGENT).toContain(ANTIGRAVITY_IDE_VERSION);
  });

  it("advertises all three Gemini 4 Argon tiers", () => {
    const ids = (antigravity.models || []).map((m) => m.id);
    for (const tier of ["gemini-4-argon-high", "gemini-4-argon-medium", "gemini-4-argon-low"]) {
      expect(ids).toContain(tier);
    }
  });

  it("maps each Argon tier to its own upstreamModelId", () => {
    const byId = new Map((antigravity.models || []).map((m) => [m.id, m]));
    expect(byId.get("gemini-4-argon-high").upstreamModelId).toBe("gemini-4-argon-high(high)");
    expect(byId.get("gemini-4-argon-medium").upstreamModelId).toBe("gemini-4-argon-medium(medium)");
    expect(byId.get("gemini-4-argon-low").upstreamModelId).toBe("gemini-4-argon-low(low)");
  });
});
