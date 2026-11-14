import { beforeEach, describe, expect, it, vi } from "vitest";

const connections = vi.hoisted(() => ({ anthropic: [], claude: [] }));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getProviderConnections: async ({ provider }) => connections[provider] ?? [],
}));

import { getModelInfo } from "../../src/sse/services/model.js";

// A bare `claude-*` id infers provider "anthropic" (API key). A client that
// passes an explicit `--model claude-*` bypasses the ANTHROPIC_DEFAULT_*_MODEL
// aliases, so users who connected only Claude OAuth used to get
// "404 No active credentials for provider: anthropic". Mirror the Codex gpt-*
// rules: keep anthropic when it is connected, otherwise use the claude provider.
describe("bare claude-* model routing", () => {
  beforeEach(() => {
    connections.anthropic = [];
    connections.claude = [];
  });

  it("keeps anthropic when nothing is connected", async () => {
    expect((await getModelInfo("claude-sonnet-4-6")).provider).toBe("anthropic");
  });

  it("uses the Claude OAuth provider when only that is active", async () => {
    connections.claude = [{ id: "c1" }];
    expect((await getModelInfo("claude-sonnet-4-6")).provider).toBe("claude");
  });

  it("keeps anthropic when an anthropic connection is active too", async () => {
    connections.anthropic = [{ id: "a1" }];
    connections.claude = [{ id: "c1" }];
    expect((await getModelInfo("claude-sonnet-4-6")).provider).toBe("anthropic");
  });

  it("does not touch an explicit provider prefix", async () => {
    connections.claude = [{ id: "c1" }];
    expect((await getModelInfo("anthropic/claude-sonnet-4-6")).provider).toBe("anthropic");
  });

  it("does not touch other model families", async () => {
    connections.claude = [{ id: "c1" }];
    expect((await getModelInfo("gpt-4o")).provider).not.toBe("claude");
  });
});