import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { getExecutor } from "../../open-sse/executors/index.js";
import {
  OPENCODE_SESSION_RE,
  generateSessionId,
  translateSessionId,
  stableSessionId,
} from "../../open-sse/executors/opencode.js";
import {
  generateSessionId as generateZenSessionId,
  translateSessionId as translateZenSessionId,
} from "../../open-sse/executors/opencode-zen.js";

function makeCredentials(overrides = {}) {
  return {
    connectionId: "conn_test",
    rawHeaders: {},
    ...overrides,
  };
}

function prepare(executor, overrides = {}) {
  const credentials = overrides.credentials || makeCredentials();
  const prepared = executor.prepareRequestCredentials({
    body: overrides.body || { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] },
    credentials,
    providerSessionId: overrides.providerSessionId ?? "conversation-a",
    clientTool: overrides.clientTool ?? "claude",
  });
  return { credentials, prepared };
}

// Upstream Zen reads ses_<12 hex><14 base62> as ~(time * 0x1000 + counter)
// truncated to the low 48 bits, so the recovered clock wraps at 2^36 ms.
const SESSION_PREFIX_MASK = (1n << 48n) - 1n;
const SESSION_TIME_WINDOW_MS = 120_000n;

function sessionPrefixValue(id) {
  return ~BigInt(`0x${id.slice(4, 16)}`) & SESSION_PREFIX_MASK;
}

function sessionCounter(id) {
  return Number(sessionPrefixValue(id) & 0xfffn);
}

// Signed distance of the prefix from now*0x1000, in ms, across the wrap.
function sessionTimeOffsetMs(id, now = Date.now()) {
  const span = SESSION_PREFIX_MASK + 1n;
  const diff = ((sessionPrefixValue(id) - BigInt(now) * 0x1000n) % span + span) % span;
  return diff > span / 2n ? diff - span : diff;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
});

describe("OpenCode Free Session ID Format", () => {
  it("generates session IDs matching OpenCode canonical format (ses_ + 12 hex + 14 base62)", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId();
      expect(id).toMatch(OPENCODE_SESSION_RE);
      expect(id).toHaveLength(30);
    }
  });

  it("translates arbitrary sessions into valid OpenCode session format", () => {
    const inputs = [
      "claude:550e8400-e29b-41d4-a716-446655440000",
      "antigravity:conv-abc-123",
      "session-from-codex",
      "12345",
      "",
    ];
    for (const raw of inputs) {
      const translated = translateSessionId(raw, "claude");
      expect(translated).toMatch(OPENCODE_SESSION_RE);
      expect(translated).toHaveLength(30);
    }
  });

  // Upstream decodes the prefix as ~(time * 0x1000 + counter) and answers
  // 403 FreeTierError unless the decoded time is recent and the counter small;
  // digest-filled prefixes decoded to an arbitrary timestamp and failed (#4780).
  it("encodes a recent inverted timestamp with a small counter in session prefixes", () => {
    for (const translate of [translateSessionId, translateZenSessionId]) {
      for (const raw of ["claude:550e8400-e29b-41d4-a716-446655440000", "session-from-codex", "", "x".repeat(300)]) {
        const translated = translate(raw, "claude");
        expect(translated).toMatch(OPENCODE_SESSION_RE);
        expect(sessionCounter(translated)).toBeLessThanOrEqual(16);
        const offsetMs = sessionTimeOffsetMs(translated);
        expect(offsetMs >= -SESSION_TIME_WINDOW_MS && offsetMs <= SESSION_TIME_WINDOW_MS).toBe(true);
      }
    }
    const expectedPrefix = ((~(1_700_000_000_000n * 0x1000n + 1n)) & SESSION_PREFIX_MASK)
      .toString(16)
      .padStart(12, "0");
    expect(generateSessionId(1_700_000_000_000).slice(4, 16)).toBe(expectedPrefix);
    expect(generateZenSessionId(1_700_000_000_000).slice(4, 16)).toBe(expectedPrefix);
  });

  it("reuses one minted id per client session and client tool across requests", () => {
    for (const translate of [translateSessionId, translateZenSessionId]) {
      const raw = "claude:non-opencode-uuid-12345";
      const first = translate(raw, "claude");
      expect(first).toMatch(OPENCODE_SESSION_RE);
      // another session in between must not disturb the cached id
      expect(translate(`${raw}-other`, "claude")).toMatch(OPENCODE_SESSION_RE);
      expect(translate(raw, "claude")).toBe(first);
      // the client tool is part of the identity
      expect(translate(raw, "codex")).not.toBe(first);
      expect(translate(raw, "claude")).toBe(first);
    }
  });

  it("preserves already-valid OpenCode sessions without re-hashing", () => {
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    expect(translateSessionId(valid)).toBe(valid);
    expect(translateSessionId(`  ${valid}  `)).toBe(valid);
    expect(translateZenSessionId(valid)).toBe(valid);
    expect(translateZenSessionId(`  ${valid}  `)).toBe(valid);
  });

  it("evicts the oldest translated session once the cache bound is exceeded", () => {
    for (const translate of [translateSessionId, translateZenSessionId]) {
      const probe = translate("claude:eviction-probe", "claude");
      for (let i = 0; i < 1000; i++) translate(`claude:eviction-filler-${i}`, "claude");
      // the probe aged out, so it is minted again instead of being handed back
      expect(translate("claude:eviction-probe", "claude")).not.toBe(probe);
    }
  });
});

describe("OpenCode Free Executor Session Resolution", () => {
  it("uses request-local session credentials without mutating source credentials", () => {
    const executor = getExecutor("opencode");
    const { credentials, prepared } = prepare(executor);

    expect(executor.constructor.name).toBe("OpenCodeExecutor");
    expect(prepared).not.toBe(credentials);
    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(credentials).not.toHaveProperty("_opencodeSession");
    expect(executor).not.toHaveProperty("_currentSessionId");
  });

  it("preserves valid native x-opencode-session header case-insensitively", () => {
    const executor = getExecutor("opencode");
    const valid = "ses_f534dfae8ffeCy4Ee4tLWNygDc";
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "X-OpenCode-Session": ` ${valid} ` } }),
    });

    expect(prepared._opencodeSession).toBe(valid);
  });

  it("translates invalid native x-opencode-session header into a valid session", () => {
    const executor = getExecutor("opencode");
    const { prepared } = prepare(executor, {
      credentials: makeCredentials({ rawHeaders: { "x-opencode-session": "invalid-session-uuid" } }),
    });

    expect(prepared._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(prepared._opencodeSession).not.toBe("invalid-session-uuid");
  });

  it("translates conversation session deterministically", () => {
    const executor = getExecutor("opencode");
    const first = prepare(executor, { providerSessionId: "conversation-a", clientTool: "claude" }).prepared._opencodeSession;
    const second = prepare(executor, { providerSessionId: "conversation-a", clientTool: "claude" }).prepared._opencodeSession;

    expect(first).toBe(second);
    expect(first).toMatch(OPENCODE_SESSION_RE);
  });

  it("isolates different conversations and tools", () => {
    const executor = getExecutor("opencode");
    const convA = prepare(executor, { providerSessionId: "conversation-a" }).prepared._opencodeSession;
    const convB = prepare(executor, { providerSessionId: "conversation-b" }).prepared._opencodeSession;
    const toolClaude = prepare(executor, { providerSessionId: "same", clientTool: "claude" }).prepared._opencodeSession;
    const toolCodex = prepare(executor, { providerSessionId: "same", clientTool: "codex" }).prepared._opencodeSession;

    expect(convA).not.toBe(convB);
    expect(toolClaude).not.toBe(toolCodex);
  });

  it("adds the valid session header to fetch requests", async () => {
    const executor = getExecutor("opencode");
    const credentials = makeCredentials();
    const result = await executor.execute({
      model: "muse-spark-1.3-contributor-free",
      body: { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] },
      stream: false,
      credentials,
      providerSessionId: "conversation-fetch-test",
      clientTool: "claude",
    });

    expect(result.headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["x-opencode-session"]).toBe(result.headers["x-opencode-session"]);
    expect(fetchMock.mock.calls[0][1].headers["Authorization"]).toBe("Bearer public");
    expect(credentials).not.toHaveProperty("_opencodeSession");
  });

  it("falls back to a valid generated session in buildHeaders when called standalone", () => {
    const executor = getExecutor("opencode");
    const headers = executor.buildHeaders({});

    expect(headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    expect(headers["Authorization"]).toBe("Bearer public");
  });
  it("handles null or undefined body gracefully in transformRequest", () => {
    const executor = getExecutor("opencode");
    expect(() => executor.transformRequest("muse-spark-1.3-contributor-free", null, false, {})).not.toThrow();
    expect(() => executor.transformRequest("big-pickle", undefined, false, {})).not.toThrow();
  });
});

describe("OpenCode Free User-Agent Validation", () => {
  it("defaults User-Agent to the v2 CLI form for non-opencode downstream clients", () => {
    const executor = getExecutor("opencode");
    const headersNoUa = executor.buildHeaders({});
    expect(headersNoUa["User-Agent"]).toBe("opencode/latest/2.0.26/cli");

    const headersClaude = executor.buildHeaders({ rawHeaders: { "user-agent": "Claude-Code/1.0" } });
    expect(headersClaude["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
  });

  it("replaces v1-style opencode User-Agents, which upstream now rejects with 403", () => {
    const executor = getExecutor("opencode");
    for (const ua of ["opencode", "opencode/1.15.0", "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14"]) {
      expect(executor.buildHeaders({ rawHeaders: { "user-agent": ua } })["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
    }
  });

  it("preserves a v2 opencode downstream User-Agent", () => {
    const executor = getExecutor("opencode");
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode/latest/2.0.29/desktop" } });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.29/desktop");
  });

  it("sends the v2 session headers and never x-opencode-request", () => {
    const executor = getExecutor("opencode");
    const headers = executor.buildHeaders({
      rawHeaders: { "x-opencode-request": "msg_0ae8d9cd3001swxaFbM248jcIF" },
    });
    const session = headers["x-opencode-session"];
    expect(session).toMatch(OPENCODE_SESSION_RE);
    expect(headers["x-opencode-session-id"]).toBe(session);
    expect(headers["x-session-affinity"]).toBe(session);
    expect(headers["x-session-id"]).toBe(session);
    expect(headers["x-opencode-client"]).toBe("cli");
    expect("x-opencode-request" in headers).toBe(false);
  });
});

describe("OpenCode Stable Session Reuse (429 follow-up)", () => {
  function anonymousCredentials(auth) {
    return makeCredentials({ connectionId: undefined, rawHeaders: { authorization: `Bearer ${auth}` } });
  }

  it("reuses one stable upstream session instead of minting a new one per request", () => {
    const executor = getExecutor("opencode");
    const body = { messages: [{ role: "user", content: "hello" }] };
    const first = executor.prepareRequestCredentials({
      body,
      credentials: anonymousCredentials("stable-key-1"),
      providerSessionId: null,
      clientTool: "claude",
    });
    const second = executor.prepareRequestCredentials({
      body,
      credentials: anonymousCredentials("stable-key-1"),
      providerSessionId: null,
      clientTool: "claude",
    });

    expect(first._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(second._opencodeSession).toBe(first._opencodeSession);
  });

  it("isolates stable sessions by downstream identity", () => {
    const executor = getExecutor("opencode");
    const body = { messages: [{ role: "user", content: "hello" }] };
    const forKey = (auth) => executor.prepareRequestCredentials({
      body,
      credentials: anonymousCredentials(auth),
      providerSessionId: null,
      clientTool: "claude",
    })._opencodeSession;

    expect(forKey("user-A")).not.toBe(forKey("user-B"));
    expect(forKey("user-A")).toMatch(OPENCODE_SESSION_RE);
  });

  it("exposes the stable session helper directly", () => {
    const first = stableSessionId({ connectionId: "direct-conn" });
    expect(stableSessionId({ connectionId: "direct-conn" })).toBe(first);
    expect(first).toMatch(OPENCODE_SESSION_RE);
  });

  it("keeps the standalone buildHeaders session stable across calls", () => {
    const executor = getExecutor("opencode");
    const first = executor.buildHeaders({})["x-opencode-session"];
    const second = executor.buildHeaders({})["x-opencode-session"];
    expect(first).toMatch(OPENCODE_SESSION_RE);
    expect(second).toBe(first);
  });

  it("applies the read/shell free-tier fingerprint on Chat Completions", () => {
    const executor = getExecutor("opencode");

    const chatNoTools = executor.transformRequest("nemotron-3-ultra-free", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(chatNoTools.stream).toBe(true);
    // tool_choice "none" is answered with 403 FreeTierError upstream.
    expect(chatNoTools.tool_choice).toBeUndefined();
    expect(chatNoTools.tools.map((t) => t.function?.name)).toEqual(["read", "shell"]);
    expect(chatNoTools.messages[0].role).toBe("system");

    const chatWithTools = executor.transformRequest("nemotron-3-ultra-free", {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "Bash", description: "Claude Code tool" } },
        { type: "function", function: { name: "Read", description: "Claude Code tool" } },
      ],
      tool_choice: "auto",
    });
    expect(chatWithTools.tool_choice).toBe("auto");
    expect(chatWithTools.tools.map((t) => t.function?.name)).toEqual(["Bash", "Read", "read", "shell"]);

    const chatClash = executor.transformRequest("nemotron-3-ultra-free", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "read", description: "existing" } }],
    });
    expect(chatClash.tools.map((t) => t.function?.name)).toEqual(["read_client", "read", "shell"]);
    expect(chatClash.tools[0].function.description).toBe("existing");
  });

  it("cloaks Muse Responses requests even when the client already supplies tools", () => {
    const executor = getExecutor("opencode");
    const transformed = executor.transformRequest("muse-spark-1.3-contributor-free(xhigh)", {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{
        type: "function",
        name: "zcode_search",
        description: "client-provided tool",
        parameters: { type: "object", properties: {} },
      }],
      tool_choice: "auto",
      reasoning_effort: "xhigh",
    }, true, {});

    expect(transformed.stream).toBe(true);
    expect(transformed.reasoning?.effort).toBe("xhigh");
    expect(transformed.tools.map((tool) => tool.name)).toEqual(["zcode_search", "read", "shell"]);
    expect(transformed.instructions).toMatch(/Do not call the `read` or `shell` tools/);
  });

  it("declares forceStream on the opencode transport so chatCore serves SSE upstream", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    expect(PROVIDERS.opencode?.forceStream).toBe(true);
  });
});
