import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_KEEPALIVE_TIMEOUT_MS,
  FRESH_RETRY_KEEPALIVE_TIMEOUT_MS,
  resolveKeepAliveTimeouts,
  isFreshSocketReplayEnabled,
  STALE_SOCKET_ERROR_CODES,
  NON_STALE_SOCKET_ERROR_CODES,
} from "../../open-sse/config/runtimeConfig.js";
import {
  isStaleSocketError,
  getDirectDispatcher,
  getFreshRetryDispatcher,
  resetDirectDispatchersForTests,
} from "../../open-sse/utils/proxyFetch.js";

const PROXY_FETCH = new URL("../../open-sse/utils/proxyFetch.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

afterEach(() => {
  delete process.env.FETCH_FRESH_RETRY;
});

function err(code, message = "fetch failed") {
  const e = new Error(message);
  if (code) e.cause = { code };
  return e;
}

describe("keep-alive TTL is capped below edge idle windows", () => {
  it("clamps both timeouts to the same value", () => {
    // Clamping only keepAliveTimeout would let an upstream `Keep-Alive: timeout=`
    // header raise the socket's life back up to keepAliveMaxTimeout (600s).
    const { keepAliveTimeout, keepAliveMaxTimeout } = resolveKeepAliveTimeouts();
    expect(keepAliveTimeout).toBe(keepAliveMaxTimeout);
    expect(keepAliveTimeout).toBe(DEFAULT_KEEPALIVE_TIMEOUT_MS);
  });

  it("keeps the default far below undici's 600s", () => {
    expect(DEFAULT_KEEPALIVE_TIMEOUT_MS).toBeLessThan(30 * 1000);
  });

  it("uses undici's no-reuse setting for the retry agent", () => {
    expect(FRESH_RETRY_KEEPALIVE_TIMEOUT_MS).toBe(1);
  });

  it("hands back a cached dispatcher rather than a new one per request", async () => {
    resetDirectDispatchersForTests();
    const a = await getDirectDispatcher();
    const b = await getDirectDispatcher();
    expect(typeof a.dispatch).toBe("function");
    expect(a).toBe(b);
  });

  it("hands back a distinct no-reuse dispatcher", async () => {
    resetDirectDispatchersForTests();
    const direct = await getDirectDispatcher();
    const fresh = await getFreshRetryDispatcher();
    expect(fresh).not.toBe(direct);
    expect(typeof fresh.dispatch).toBe("function");
  });
});

describe("stale-socket classification", () => {
  it("recognises every code that proves the pooled socket died", () => {
    for (const code of STALE_SOCKET_ERROR_CODES) {
      expect(isStaleSocketError(err(code))).toBe(true);
    }
  });

  it("recognises the two substrings undici uses when the peer goes away", () => {
    expect(isStaleSocketError(err(null, "other side closed"))).toBe(true);
    expect(isStaleSocketError(err(null, "socket hang up"))).toBe(true);
  });

  it("refuses a bare 'fetch failed'", () => {
    // No error code means no proof the socket died. The upstream may already
    // hold the request, and a replay would bill the same completion twice.
    expect(isStaleSocketError(err(null, "fetch failed"))).toBe(false);
    expect(isStaleSocketError(new Error("fetch failed"))).toBe(false);
  });

  it("never treats an unreachable host as a stale socket", () => {
    for (const code of NON_STALE_SOCKET_ERROR_CODES) {
      expect(isStaleSocketError(err(code))).toBe(false);
    }
  });

  it("never treats an abort or timeout as a stale socket", () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    expect(isStaleSocketError(aborted)).toBe(false);
    const timedOut = new Error("timed out");
    timedOut.name = "TimeoutError";
    expect(isStaleSocketError(timedOut)).toBe(false);
    expect(isStaleSocketError(null)).toBe(false);
    expect(isStaleSocketError(undefined)).toBe(false);
  });
});

describe("fresh-socket replay is opt-in", () => {
  it("is off by default", () => {
    delete process.env.FETCH_FRESH_RETRY;
    expect(isFreshSocketReplayEnabled()).toBe(false);
  });

  it("turns on only for an explicit affirmative", () => {
    for (const value of ["1", "on", "ON", "true", "yes", " yes "]) {
      process.env.FETCH_FRESH_RETRY = value;
      expect(isFreshSocketReplayEnabled()).toBe(true);
    }
  });

  it("stays off for anything else, including off/0/false/no", () => {
    for (const value of ["off", "0", "false", "no", ""]) {
      process.env.FETCH_FRESH_RETRY = value;
      expect(isFreshSocketReplayEnabled()).toBe(false);
    }
  });
});

describe("the direct path never uses the uncapped default pool", () => {
  it("routes both direct returns through the capped dispatcher", () => {
    const source = readFileSync(PROXY_FETCH, "utf8");
    // A bare originalFetch(url, options) on the direct path would fall back to
    // undici's default agent with keepAliveMaxTimeout 600s — the exact bug.
    expect(source).not.toMatch(/return originalFetch\(url, options\);/);
    expect(source).toMatch(/return fetchDirect\(url, options\);/);
  });
});

describe("no MITM DNS bypass in the request path", () => {
  it("has no bypass list or raw-socket rewrite left", () => {
    // The bypass sent every Kiro / Copilot / Cursor / Antigravity request through
    // a manual raw-TLS socket, unconditionally — it never checked whether MITM
    // DNS was enabled or the host was redirected. Where that socket failed each
    // attempt burned its full connect timeout: 35s for one Kiro request, ~3s
    // once removed. MITM is not used here, so it must not creep back in.
    const source = readFileSync(PROXY_FETCH, "utf8");
    expect(source).not.toMatch(/MITM_BYPASS_HOSTS/);
    expect(source).not.toMatch(/shouldBypassMitmDns/);
    expect(source).not.toMatch(/createBypassRequest/);
    expect(source).not.toMatch(/resolveRealIP/);
  });
});
