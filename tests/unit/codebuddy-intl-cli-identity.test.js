// 11140 "account restricted due to unusual activity" is a different gate from
// 11128 (channel verification). The request is valid; the ACCOUNT is flagged.
//
// The intl executor used to send 6 static headers. The official CLI 2.170.0
// sends ~30, including the X-Stainless-* SDK fingerprint and the X-Agent-*
// caller identity. A request missing those still passes 11128 but reads as
// third-party automation, which is what trips 11140.
import { describe, expect, it } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const exec = new CodeBuddyIntlExecutor();
const creds = { accessToken: "test-token" };
const build = (body = { messages: [{ role: "user", content: "hi" }] }) =>
  exec.buildHeaders(creds, true, "https://www.codebuddy.ai/v2/chat/completions", "deepseek-v4.1-flash", body);

describe("codebuddy-intl — CLI identity headers", () => {
  it("sends the full CLI identity set", () => {
    const h = build();
    for (const key of [
      "X-Product", "X-Product-Version", "X-App",
      "X-IDE-Type", "X-IDE-Name", "X-IDE-Version",
      "X-Private-Data", "X-Requested-With", "X-CodeBuddy-Request",
      "X-Domain", "X-Request-ID",
    ]) {
      expect(h[key], `missing ${key}`).toBeTruthy();
    }
  });

  it("sends the Stainless SDK fingerprint", () => {
    const h = build();
    for (const key of [
      "X-Stainless-Lang", "X-Stainless-Package-Version", "X-Stainless-OS",
      "X-Stainless-Arch", "X-Stainless-Runtime", "X-Stainless-Runtime-Version",
      "X-Stainless-Retry-Count", "X-Stainless-Helper-Method",
    ]) {
      expect(h[key], `missing ${key}`).toBeTruthy();
    }
    expect(h["X-Stainless-Lang"]).toBe("js");
    expect(h["X-Stainless-Runtime"]).toBe("node");
    // Values must match the CLI's normalizePlatform()/normalizeArch(), not the
    // raw process values: x64 is advertised as "amd64", arm as "arm32".
    expect(h["X-Stainless-Package-Version"]).toBe("6.25.0");
    expect(h["X-Stainless-OS"]).toMatch(/^(Windows|MacOS|Linux|FreeBSD|OpenBSD|Unknown|Other:.+)$/);
    expect(h["X-Stainless-Arch"]).toMatch(/^(amd64|arm32|ppc32|arm64|x64|ia32)$/);
    expect(h["X-Stainless-Arch"]).not.toBe("x64"); // CLI normalizes x64 -> amd64
  });

  it("sends the agent identity the CLI declares", () => {
    const h = build();
    expect(h["X-Agent-Intent"]).toBe("craft");
    expect(h["X-Agent-Purpose"]).toBe("conversation");
    expect(h["X-Agent-Type"]).toBe("ide");
    expect(h["X-Agent-Runtime"]).toBe("ide");
  });

  it("advertises the installed CLI version in UA and X-IDE-Version", () => {
    const h = build();
    expect(h["User-Agent"]).toMatch(/^IDE\/\d+\.\d+\.\d+ CodeBuddy\/\d+\.\d+\.\d+$/);
    expect(h["X-IDE-Version"]).toBe(h["User-Agent"].match(/CodeBuddy\/(\d+\.\d+\.\d+)/)[1]);
  });

  it("has no duplicate header names differing only by case", () => {
    const keys = Object.keys(build());
    const lowered = keys.map((k) => k.toLowerCase());
    expect(new Set(lowered).size).toBe(keys.length);
  });

  it("still carries the X-Conversation-* family (11128 gate)", () => {
    const h = build();
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Message-ID"]).toMatch(UUID_RE);
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
});

describe("codebuddy-intl — 11140 account restriction", () => {
  it("classifies 11140 as a long account park, not a burst cooldown", () => {
    const body = JSON.stringify({
      code: 11140,
      msg: "request illegal",
      displayMsg: { en: "Your account has been restricted due to unusual activity" },
    });
    const before = Date.now();
    const parsed = exec.parseError({ status: 403 }, body);
    expect(parsed.status).toBe(403);
    expect(parsed.accountRestricted).toBe(true);
    // 12h window, not the usual 2-minute burst cooldown.
    expect(parsed.resetsAtMs).toBeGreaterThan(before + 11 * 3600 * 1000);
    expect(parsed.resetsAtMs).toBeLessThan(before + 13 * 3600 * 1000);
  });

  it("detects the restriction from the message alone", () => {
    const body = JSON.stringify({ msg: "账号存在异常行为，已被限制使用" });
    expect(exec.parseError({ status: 403 }, body).accountRestricted).toBe(true);
  });

  it("still classifies 6004 as a frequency limit, not a restriction", () => {
    const body = JSON.stringify({
      code: 6004,
      msg: "usage exceeds frequency limit, your usage will reset at 2026-10-19 15:00:56",
    });
    const parsed = exec.parseError({ status: 429 }, body);
    expect(parsed.status).toBe(429);
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
    if (a === "x64") return "amd64";
    return a || "unknown";
  };

  it.each([
    ["win32", "x64", "Windows", "amd64"],
    ["darwin", "arm64", "MacOS", "arm64"],
    ["darwin", "x64", "MacOS", "amd64"],
    ["linux", "x64", "Linux", "amd64"],
    ["linux", "arm64", "Linux", "arm64"],
    ["linux", "arm", "Linux", "arm32"],
    ["freebsd", "x64", "FreeBSD", "amd64"],
  ])("%s/%s → %s/%s", (platform, arch, os, cpu) => {
    expect(normalizePlatform(platform)).toBe(os);
    expect(normalizeArch(arch)).toBe(cpu);
  });

  it("never emits the raw x64 token (CLI normalizes it to amd64)", () => {
    expect(normalizeArch("x64")).not.toBe("x64");
  });

  it("falls back to Other:<platform> for an unknown OS instead of lying", () => {
    expect(normalizePlatform("sunos")).toBe("Other:sunos");
  });

  it("reports the real runtime version, not a hardcoded one", () => {
    const h = build();
    expect(h["X-Stainless-Runtime-Version"]).toBe(process.version);
    expect(h["X-Stainless-Runtime"]).toBe("node");
  });

  it("OS and arch always agree with the host process", () => {
    const h = build();
    expect(h["X-Stainless-OS"]).toBe(normalizePlatform(process.platform));
    expect(h["X-Stainless-Arch"]).toBe(normalizeArch(process.arch));
  });
});
