/**
 * Unit tests for open-sse/utils/claudeCliVersion.js
 *
 * The Claude Code CLI version is a wire fingerprint: Anthropic rejects requests
 * below its minimum CLI version for new models. The helper must therefore be
 * fail-open — a failed npm lookup keeps the bundled floor instead of throwing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fresh module state per test: the helper caches the resolved version and the
// next-check timestamp at module scope.
async function load() {
  vi.resetModules();
  return import("../../open-sse/utils/claudeCliVersion.js");
}

beforeEach(() => {
  delete process.env.CLAUDE_CLI_VERSION;
});

afterEach(() => {
  delete process.env.CLAUDE_CLI_VERSION;
  vi.unstubAllGlobals();
});

describe("getClaudeCliVersion", () => {
  it("returns the bundled floor before any lookup", async () => {
    const { getClaudeCliVersion } = await load();
    expect(getClaudeCliVersion()).toBe("2.1.322");
  });

  it("honours the CLAUDE_CLI_VERSION pin", async () => {
    process.env.CLAUDE_CLI_VERSION = "9.9.9";
    const { getClaudeCliVersion } = await load();
    expect(getClaudeCliVersion()).toBe("9.9.9");
  });

  it("ignores a malformed pin", async () => {
    process.env.CLAUDE_CLI_VERSION = "latest";
    const { getClaudeCliVersion } = await load();
    expect(getClaudeCliVersion()).toBe("2.1.322");
  });
});

describe("ensureClaudeCliVersion (fail-open)", () => {
  it("adopts a newer published version", async () => {
    const { ensureClaudeCliVersion, getClaudeCliVersion } = await load();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "9.9.9" }),
    });

    await expect(ensureClaudeCliVersion(fetchImpl)).resolves.toBe("9.9.9");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getClaudeCliVersion()).toBe("9.9.9");
  });

  it("keeps the floor when the fetch throws", async () => {
    const { ensureClaudeCliVersion, getClaudeCliVersion } = await load();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ENOTFOUND registry.npmjs.org"));

    await expect(ensureClaudeCliVersion(fetchImpl)).resolves.toBe("2.1.322");
    expect(getClaudeCliVersion()).toBe("2.1.322");
  });

  it("keeps the floor on a non-ok response", async () => {
    const { ensureClaudeCliVersion } = await load();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(ensureClaudeCliVersion(fetchImpl)).resolves.toBe("2.1.322");
  });

  it("keeps the floor when the payload has no semver version", async () => {
    const { ensureClaudeCliVersion } = await load();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "next" }),
    });

    await expect(ensureClaudeCliVersion(fetchImpl)).resolves.toBe("2.1.322");
  });

  it("never downgrades below the floor", async () => {
    const { ensureClaudeCliVersion } = await load();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.0.1" }),
    });

    await expect(ensureClaudeCliVersion(fetchImpl)).resolves.toBe("2.1.322");
  });

  it("does not call the network when pinned", async () => {
    process.env.CLAUDE_CLI_VERSION = "9.9.9";
    const { ensureClaudeCliVersion } = await load();
    const fetchImpl = vi.fn();

    await ensureClaudeCliVersion(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("raises the floor via setClaudeCliFallback but never lowers it", async () => {
    const { setClaudeCliFallback, getClaudeCliVersion } = await load();
    setClaudeCliFallback("1.0.0");
    expect(getClaudeCliVersion()).toBe("2.1.322");
    setClaudeCliFallback("2.2.0");
    expect(getClaudeCliVersion()).toBe("2.2.0");
  });
});

describe("applyClaudeCliVersion", () => {
  it("rewrites claude-cli/x.y.z in header objects", async () => {
    const { applyClaudeCliVersion } = await load();
    const headers = applyClaudeCliVersion({
      "User-Agent": "claude-cli/2.1.322 (external, sdk-cli)",
      "X-App": "cli",
    });

    expect(headers["User-Agent"]).toBe("claude-cli/2.1.322 (external, sdk-cli)");
    expect(headers["X-App"]).toBe("cli");
  });

  it("rewrites the live version after a successful lookup", async () => {
    const { ensureClaudeCliVersion, applyClaudeCliVersion } = await load();
    await ensureClaudeCliVersion(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "9.9.9" }),
    }));

    const headers = applyClaudeCliVersion({ "User-Agent": "claude-cli/2.1.322 (external, sdk-cli)" });
    expect(headers["User-Agent"]).toBe("claude-cli/9.9.9 (external, sdk-cli)");
  });

  it("leaves headers without the fingerprint untouched", async () => {
    const { applyClaudeCliVersion } = await load();
    const headers = { "Content-Type": "application/json" };
    expect(applyClaudeCliVersion(headers)).toEqual(headers);
  });

  it("handles a Headers instance", async () => {
    const { applyClaudeCliVersion } = await load();
    const out = applyClaudeCliVersion(new Headers({ "User-Agent": "claude-cli/2.1.322 (external, sdk-cli)" }));
    expect(out.get("User-Agent")).toBe("claude-cli/2.1.322 (external, sdk-cli)");
  });

  it("returns falsy input unchanged", async () => {
    const { applyClaudeCliVersion } = await load();
    expect(applyClaudeCliVersion(null)).toBeNull();
    expect(applyClaudeCliVersion(undefined)).toBeUndefined();
  });
});