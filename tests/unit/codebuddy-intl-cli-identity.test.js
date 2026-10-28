// The intl executor must look like the official CodeBuddy CLI on the wire.
//
// Source of truth: a live MITM capture of CodeBuddy Code CLI 2.178.0 on
// Windows/x64 (2026-10-28), taken through the proxy at
// scripts/codebuddy-mitm-addon.py. The capture is the authority — not the
// bundle source, which normalizes some values the compiled CLI does not.
//
// The captured header set (of which the ones below are the ones the gateway
// can key on):
//
//   accept: application/json
//   content-encoding: gzip
//   baggage: codebuddy.session_id=<uuid>,codebuddy.conversation_request_id=<hex>
//   traceparent / b3 / X-B3-* / X-Trace-ID
//   X-Agent-Intent: craft          X-Agent-Purpose: conversation
//   X-Agent-Type: main             X-Agent-Runtime: other
//   X-IDE-Type: CLI                X-IDE-Name: CLI
//   X-IDE-Version: 2.178.0         User-Agent: CLI/2.178.0 CodeBuddy/2.178.0
//   X-Product: SaaS                X-Domain: www.codebuddy.ai
//   X-Private-Data: false          X-Requested-With: XMLHttpRequest
//   X-CodeBuddy-Request: 1
//   X-Conversation-ID / X-Conversation-Request-ID / X-Conversation-Message-ID
//   X-Root-Request-ID / X-Request-ID
//   X-User-Id: <the token's sub claim>
//   X-Stainless-*: js, 7.39.0, Windows, x64, node, v26.7.0, 0
//
// Three headers the CLI does NOT send: X-App, X-Product-Version and
// X-Stainless-Helper-Method. Sending a header the official client never
// sends is itself a tell.
import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import {
  CodeBuddyIntlExecutor,
  userIdFromCredentials,
} from "../../open-sse/executors/codebuddy-intl.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX32_RE = /^[0-9a-f]{32}$/;
const HEX16_RE = /^[0-9a-f]{16}$/;

const exec = new CodeBuddyIntlExecutor();
const URL = "https://www.codebuddy.ai/v2/chat/completions";

// A JWT-shaped token whose payload carries the account id, the same way the
// CLI's bearer token does.
function jwtWithSub(sub) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub })}.sig`;
}

const USER_ID = "85482e42-2454-468d-a2b0-f1f6311f0f81";
const creds = { accessToken: jwtWithSub(USER_ID) };
const build = (body = { messages: [{ role: "user", content: "hi" }] }) =>
  exec.buildHeaders(creds, true, URL, "deepseek-v4.1-flash", body);

describe("codebuddy-intl — CLI 2.178.0 identity", () => {
  it("sends the CLI identity set", () => {
    const h = build();
    for (const key of [
      "X-Product", "X-IDE-Type", "X-IDE-Name", "X-IDE-Version",
      "X-Private-Data", "X-Requested-With", "X-CodeBuddy-Request",
      "X-Domain", "X-Request-ID", "Accept",
    ]) {
      expect(h[key], `missing ${key}`).toBeTruthy();
    }
  });

  it("does not send headers the CLI never sends", () => {
    const h = build();
    // The official CLI has no X-App, no X-Product-Version and no
    // X-Stainless-Helper-Method. Sending them looks like a hand-rolled client.
    expect(h["X-App"]).toBeUndefined();
    expect(h["X-Product-Version"]).toBeUndefined();
    expect(h["X-Stainless-Helper-Method"]).toBeUndefined();
  });

  it("sends the Stainless SDK fingerprint the CLI ships", () => {
    const h = build();
    for (const key of [
      "X-Stainless-Lang", "X-Stainless-Package-Version", "X-Stainless-OS",
      "X-Stainless-Arch", "X-Stainless-Runtime", "X-Stainless-Runtime-Version",
      "X-Stainless-Retry-Count",
    ]) {
      expect(h[key], `missing ${key}`).toBeTruthy();
    }
    expect(h["X-Stainless-Lang"]).toBe("js");
    expect(h["X-Stainless-Runtime"]).toBe("node");
    expect(h["X-Stainless-Package-Version"]).toBe("7.39.0");
    expect(h["X-Stainless-Runtime-Version"]).toBe("v26.7.0");
    expect(h["X-Stainless-Retry-Count"]).toBe("0");
    expect(h["X-Stainless-OS"]).toMatch(/^(Windows|MacOS|Linux|FreeBSD|OpenBSD|Unknown|Other:.+)$/);
    expect(h["X-Stainless-Arch"]).toMatch(/^(amd64|arm32|ppc32|arm64|x64|ia32)$/);
  });

  it("asks for JSON like the CLI does, not an event stream", () => {
    // The base executor sets text/event-stream for streaming calls. The CLI
    // sends application/json and still receives text/event-stream back.
    expect(build()["Accept"]).toBe("application/json");
  });

  it("sends the account id from the token's sub claim", () => {
    expect(build()["X-User-Id"]).toBe(USER_ID);
  });

  it("omits X-User-Id when the token carries no account id", () => {
    const h = exec.buildHeaders(
      { accessToken: "not-a-jwt" },
      true,
      URL,
      "deepseek-v4.1-flash",
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(h["X-User-Id"]).toBeUndefined();
  });

  it("reads the account id out of a bearer token", () => {
    expect(userIdFromCredentials({ accessToken: jwtWithSub(USER_ID) })).toBe(USER_ID);
    expect(userIdFromCredentials({ access_token: jwtWithSub(USER_ID) })).toBe(USER_ID);
    expect(userIdFromCredentials({ accessToken: "opaque-token" })).toBeNull();
    expect(userIdFromCredentials({})).toBeNull();
  });

  it("sends the agent identity the CLI declares", () => {
    const h = build();
    expect(h["X-Agent-Intent"]).toBe("craft");
    expect(h["X-Agent-Purpose"]).toBe("conversation");
    expect(h["X-Agent-Type"]).toBe("main");
    expect(h["X-Agent-Runtime"]).toBe("other");
  });

  it("advertises the CLI version in UA and X-IDE-Version", () => {
    const h = build();
    expect(h["User-Agent"]).toBe("CLI/2.178.0 CodeBuddy/2.178.0");
    expect(h["X-IDE-Version"]).toBe("2.178.0");
  });

  it("has no duplicate header names differing only by case", () => {
    const keys = Object.keys(build());
    const lowered = keys.map((k) => k.toLowerCase());
    expect(new Set(lowered).size).toBe(keys.length);
  });

  it("carries the X-Conversation-* family", () => {
    const h = build();
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Message-ID"]).toMatch(UUID_RE);
    expect(h["X-Root-Request-ID"]).toMatch(UUID_RE);
  });

  it("keeps the conversation id stable but rotates the request id", () => {
    const body = { messages: [{ role: "user", content: "same turn" }] };
    const a = build(body);
    const b = build(body);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
    expect(a["X-Conversation-Request-ID"]).not.toBe(b["X-Conversation-Request-ID"]);
  });

  it("matches request id and message id like the CLI does per turn", () => {
    const h = build();
    expect(h["X-Conversation-Message-ID"]).toBe(h["X-Conversation-Request-ID"]);
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Request-ID"]);
  });

  it("sends the tracing headers in the CLI's format", () => {
    const h = build();
    expect(h["X-B3-TraceId"]).toMatch(HEX32_RE);
    expect(h["X-B3-SpanId"]).toMatch(HEX16_RE);
    expect(h["X-B3-ParentSpanId"]).toMatch(HEX16_RE);
    expect(h["X-B3-Sampled"]).toBe("1");
    expect(h["X-Trace-ID"]).toBe(h["X-B3-TraceId"]);
    expect(h["traceparent"]).toMatch(
      new RegExp(`^00-${h["X-B3-TraceId"]}-${h["X-B3-SpanId"]}-01$`),
    );
    expect(h["b3"]).toBe(
      `${h["X-B3-TraceId"]}-${h["X-B3-SpanId"]}-1-${h["X-B3-ParentSpanId"]}`,
    );
  });

  it("sends baggage in the CLI's format", () => {
    const h = build();
    expect(h["baggage"]).toMatch(
      /^codebuddy\.session_id=[0-9a-f-]{36},codebuddy\.conversation_request_id=[0-9a-f]{32}$/,
    );
  });
});

describe("codebuddy-intl — OAuth identity matches the CLI", () => {
  // The CLI refreshes its token with the same identity it chats with: the
  // CLI user agent, the account id, a request id and the still-valid access
  // token as a bearer. The registry used to advertise "IDE/2.160.0" while
  // the chat path said "CLI/2.178.0" — one account, two identities.
  const fs = require("node:fs");
  const registry = fs.readFileSync(
    require("node:path").resolve("../open-sse/providers/registry/codebuddy-intl.js"),
    "utf8",
  );
  const refresh = fs.readFileSync(
    require("node:path").resolve("../open-sse/services/tokenRefresh/providers.js"),
    "utf8",
  );

  it("advertises the CLI user agent everywhere, not the IDE one", () => {
    expect(registry).toMatch(/CLI\/2\.178\.0 CodeBuddy\/2\.178\.0/);
    expect(registry).not.toMatch(/IDE\/2\.160\.0/);
    // Both the chat header and the oauth user agent must agree.
    const uas = registry.match(/CLI\/2\.178\.0 CodeBuddy\/2\.178\.0/g) || [];
    expect(uas.length).toBeGreaterThanOrEqual(2);
  });

  it("sends the account id and a request id on the refresh call", () => {
    expect(refresh).toMatch(/headers\["X-User-Id"\] = userId/);
    expect(refresh).toMatch(/X-Request-ID/);
    expect(refresh).toMatch(/headers\["Authorization"\] = `Bearer/);
  });

  it("reads the account id from a module with no imports of its own", () => {
    // The refresh service and the executor both need this helper. Importing
    // the executor from the refresh service closes a cycle that fails at
    // module-evaluation time, so the helper lives in its own leaf module.
    const leaf = fs.readFileSync(
      require("node:path").resolve("../open-sse/shared/codebuddyUserId.js"),
      "utf8",
    );
    expect(leaf).toMatch(/export function userIdFromCredentials/);
    expect(leaf).not.toMatch(/^import /m);
  });
});

describe("codebuddy-intl — gzipped request body", () => {
  it("compresses the body and labels it gzip", async () => {
    const headers = {};
    const body = JSON.stringify({ model: "deepseek-v4.1-flash", messages: [] });
    const encoded = await exec.encodeRequestBody(body, headers);
    expect(headers["Content-Encoding"]).toBe("gzip");
    expect(Buffer.isBuffer(encoded)).toBe(true);
    expect(gzipSync(Buffer.from(body, "utf8")).equals(encoded)).toBe(true);
  });
});

describe("codebuddy-intl — 11140 account restriction", () => {
  it("classifies 11140 as a BAN, not a timed cooldown", () => {
    const body = JSON.stringify({
      code: 11140,
      msg: "request illegal",
      displayMsg: { en: "Your account has been restricted due to unusual activity" },
    });
    const parsed = exec.parseError({ status: 403 }, body);
    expect(parsed.status).toBe(403);
    expect(parsed.banned).toBe(true);
    // No resetsAtMs: a ban lasts until the provider lifts it, so a timer would
    // only re-test the banned account every few hours — exactly the retry
    // pattern the ban was issued for. auth.js parks the account for weeks.
    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it("detects the restriction from the message alone", () => {
    const body = JSON.stringify({ msg: "账号存在异常行为，已被限制使用" });
    expect(exec.parseError({ status: 403 }, body).banned).toBe(true);
  });

  it("still classifies 6004 as a frequency limit, not a restriction", () => {
    const body = JSON.stringify({
      code: 6004,
      msg: "usage exceeds frequency limit, your usage will reset at 2026-10-19 15:00:56",
    });
    const parsed = exec.parseError({ status: 429 }, body);
    expect(parsed.status).toBe(429);
    expect(parsed.banned).toBeUndefined();
    expect(parsed.accountRestricted).toBeUndefined();
  });
});

describe("codebuddy-intl — cross-platform fingerprint", () => {
  // The executor reads process.platform/process.arch, so the same build must
  // produce a coherent fingerprint on Windows, macOS and Linux (x64 or arm64).
  // These assertions exercise the normalization rules directly so the mapping
  // is pinned regardless of where the suite runs.
  const normalizePlatform = (p) => {
    const v = String(p || "").toLowerCase();
    if (v === "darwin") return "MacOS";
    if (v === "win32") return "Windows";
    if (v === "linux") return "Linux";
    if (v === "freebsd") return "FreeBSD";
    if (v === "openbsd") return "OpenBSD";
    return v ? `Other:${v}` : "Unknown";
  };
  const normalizeArch = (a) => {
    if (a === "arm") return "arm32";
    if (a === "ppc") return "ppc32";
    // Wire observation: the CLI sends "x64" raw, not "amd64".
    return a || "unknown";
  };

  it.each([
    ["win32", "x64", "Windows", "x64"],
    ["darwin", "arm64", "MacOS", "arm64"],
    ["darwin", "x64", "MacOS", "x64"],
    ["linux", "x64", "Linux", "x64"],
    ["linux", "arm64", "Linux", "arm64"],
    ["linux", "arm", "Linux", "arm32"],
    ["freebsd", "x64", "FreeBSD", "x64"],
  ])("%s/%s → %s/%s", (platform, arch, os, cpu) => {
    expect(normalizePlatform(platform)).toBe(os);
    expect(normalizeArch(arch)).toBe(cpu);
  });

  it("sends x64 as-is (live wire shows the CLI does NOT map x64→amd64)", () => {
    expect(normalizeArch("x64")).toBe("x64");
  });

  it("falls back to Other:<platform> for an unknown OS instead of lying", () => {
    expect(normalizePlatform("sunos")).toBe("Other:sunos");
  });

  it("OS and arch always agree with the host process", () => {
    const h = build();
    expect(h["X-Stainless-OS"]).toBe(normalizePlatform(process.platform));
    expect(h["X-Stainless-Arch"]).toBe(normalizeArch(process.arch));
  });
});
