import { describe, it, expect } from "vitest";
import {
  isWafProtectedUrl,
  sanitizeWafTriggers,
  isWafBlockResponse,
} from "../../open-sse/config/wafGuard.js";

// Real strings, taken from the failing session (request_dump_20260916_124058_25b4f8)
// and from Render's own block page. The guard exists because of these exact inputs.
const REAL_AGENTS_LINE = "`python solver_server.py` lalu `curl http://127.0.0.1:8001/...`.";
const REAL_TOOL_RESULT = "$ `curl -s -m 5 http://127.0.0.1:8099/ ; echo; curl -s -m 5 http://127.0.0.1:8001/health`";
const WAF_PAGE =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n' +
  "<title>Blocked</title>\n</head>\n<body>\n<h1>403 - Forbidden</h1>\n" +
  "<p>Your request was blocked by this site's web application firewall (WAF).</p>\n</body>\n</html>";

// Two nodes in this install point at this host: openai-compatible-chat-* and
// anthropic-compatible-*. Nothing else is WAF-inspected, so nothing else is touched.
const RENDER_HOST = "https://freebuff-proxy-zn7c.onrender.com/v1/chat/completions";

describe("wafGuard — host scoping", () => {
  it("matches the Render freebuff-proxy and nothing else", () => {
    expect(isWafProtectedUrl(RENDER_HOST)).toBe(true);
    expect(isWafProtectedUrl("https://freebuff-proxy-zn7c.onrender.com/me")).toBe(true);
  });

  it("leaves every other upstream alone", () => {
    // The native freebuff provider talks to Codebuff directly — no WAF, no reason
    // to mutate. Keying on the provider name instead of the host would hit it.
    expect(isWafProtectedUrl("https://www.codebuff.com/api/v1/chat/completions")).toBe(false);
    expect(isWafProtectedUrl("https://api.b.ai/v1/chat/completions")).toBe(false);
    expect(isWafProtectedUrl("https://api.cline.bot/api/v1/chat/completions")).toBe(false);
    expect(isWafProtectedUrl("http://neva.jhopanstore.my.id:20128/v1/chat/completions")).toBe(false);
    expect(isWafProtectedUrl("http://localhost:20127/v1/chat/completions")).toBe(false);
  });

  it("is safe on junk input", () => {
    expect(isWafProtectedUrl("")).toBe(false);
    expect(isWafProtectedUrl(null)).toBe(false);
    expect(isWafProtectedUrl("not a url")).toBe(false);
  });
});

describe("wafGuard — sanitize", () => {
  it("unwraps the command that broke the session, touching nothing else", () => {
    const { body, count } = sanitizeWafTriggers(REAL_AGENTS_LINE);
    expect(count).toBe(1);
    // Only the backtick in front of `curl` is gone; its closing backtick stays
    // (cosmetic, and the WAF only keys on the opening one). The first span
    // (`python solver_server.py`) is left completely alone.
    expect(body).toBe("`python solver_server.py` lalu curl http://127.0.0.1:8001/...`.");
    expect(body).toContain("curl http://127.0.0.1:8001/...");
  });

  it("unwraps every occurrence, not just the first", () => {
    const payload = JSON.stringify({
      messages: [
        { role: "system", content: REAL_AGENTS_LINE },
        { role: "assistant", content: REAL_AGENTS_LINE },
        { role: "tool", content: REAL_TOOL_RESULT },
      ],
    });
    const { body, count } = sanitizeWafTriggers(payload);
    expect(count).toBe(3);
    expect(body).not.toContain("`curl");
    expect(body).not.toContain("`python solver_server.py` lalu `curl");
    // Still valid JSON after the rewrite.
    expect(() => JSON.parse(body)).not.toThrow();
  });

  it("does not depend on backtick pairing (regression)", () => {
    // The first implementation matched whole inline-code spans. In the real system
    // prompt an earlier, odd backtick shifted the pairing, so the `curl` command
    // fell outside the matched span and went out unchanged — the sanitised retry
    // was blocked exactly like the original. Removing the opening backtick is
    // immune to that, which is the whole reason this case is pinned.
    const shifted = "lihat `file.md` dan `config.yaml` — verifikasi:\n   `curl http://127.0.0.1:8001/health`\n";
    const { body, count } = sanitizeWafTriggers(shifted);
    expect(count).toBe(1);
    expect(body).not.toContain("`curl");
    expect(body).toContain("curl http://127.0.0.1:8001/health");
    // The unrelated spans are untouched.
    expect(body).toContain("`file.md`");
    expect(body).toContain("`config.yaml`");
  });

  it("neutralises wget too", () => {
    const { body, count } = sanitizeWafTriggers("run `wget http://127.0.0.1/x` now");
    expect(count).toBe(1);
    expect(body).toBe("run wget http://127.0.0.1/x` now");
  });

  it("returns a byte-identical body when there is no trigger", () => {
    const clean = JSON.stringify({
      messages: [
        { role: "system", content: "You are a helpful assistant. Run `npm test` before pushing." },
        { role: "user", content: "buka https://example.com lalu jelaskan" },
        { role: "assistant", content: "lihat `open-sse/executors/base.js:144` untuk detailnya" },
      ],
    });
    const { body, count } = sanitizeWafTriggers(clean);
    expect(count).toBe(0);
    expect(body).toBe(clean); // same string, not merely equal
  });

  it("ignores a backticked curl with no URL, and a URL with no curl", () => {
    const { body, count } = sanitizeWafTriggers("`curl` dan `https://example.com` lalu `npm run build`");
    expect(count).toBe(0);
    expect(body).toBe("`curl` dan `https://example.com` lalu `npm run build`");
  });

  it("is a no-op on non-string input", () => {
    const buf = Buffer.from("`curl http://x`");
    expect(sanitizeWafTriggers(undefined)).toEqual({ body: undefined, count: 0 });
    expect(sanitizeWafTriggers(buf).count).toBe(0);
  });
});

describe("wafGuard — block detection", () => {
  it("recognises Render's WAF page", () => {
    expect(isWafBlockResponse(403, WAF_PAGE)).toBe(true);
    expect(isWafBlockResponse(503, WAF_PAGE)).toBe(true);
  });

  it("does not fire on a legitimate refusal", () => {
    // A real 403 (bad key / quota / region) must not trigger a sanitised retry:
    // rewriting the body would not help and would hide the real error.
    expect(isWafBlockResponse(403, JSON.stringify({ error: { message: "invalid api key" } }))).toBe(false);
    expect(isWafBlockResponse(403, "quota exhausted")).toBe(false);
    expect(isWafBlockResponse(200, WAF_PAGE)).toBe(false);
    expect(isWafBlockResponse(403, "")).toBe(false);
  });

  it("tolerates whitespace in the title", () => {
    expect(isWafBlockResponse(403, "<title> Blocked </title>")).toBe(true);
  });
});
