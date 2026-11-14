import { Readable } from "stream";
import {
  MEMORY_CONFIG,
  FRESH_RETRY_KEEPALIVE_TIMEOUT_MS,
  STALE_SOCKET_ERROR_CODES,
  NON_STALE_SOCKET_ERROR_CODES,
  STALE_SOCKET_ERROR_SUBSTRINGS,
  resolveKeepAliveTimeouts,
  isFreshSocketReplayEnabled,
} from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";
import { ensureClaudeCliVersion, applyClaudeCliVersion } from "./claudeCliVersion.js";

const CLAUDE_UA_PROBE = /claude-cli\/\d/;
function hasClaudeCliHeader(headers) {
  if (!headers) return false;
  const values = headers instanceof Headers
    ? [...headers.values()]
    : Array.isArray(headers)
      ? headers.map((h) => h[1])
      : Object.values(headers);
  return values.some((v) => typeof v === "string" && CLAUDE_UA_PROBE.test(v));
}

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map();
const directDispatchers = new Map();

/** Test hook: drop cached dispatchers so TTL changes are observable. */
export function resetDirectDispatchersForTests() {
  directDispatchers.clear();
  proxyDispatchers.clear();
}

/**
 * Did this error prove the pooled socket was dead before any response header
 * arrived? Only then is replaying the request safe — see the "fetch failed"
 * exclusion in STALE_SOCKET_ERROR_SUBSTRINGS.
 */
export function isStaleSocketError(error) {
  if (!error) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return false;
  const code = error?.cause?.code || error?.code || "";
  if (NON_STALE_SOCKET_ERROR_CODES.has(code)) return false;
  if (STALE_SOCKET_ERROR_CODES.has(code)) return true;
  const message = `${error?.message || ""} ${error?.cause?.message || ""}`.toLowerCase();
  return STALE_SOCKET_ERROR_SUBSTRINGS.some((needle) => message.includes(needle));
}

// ─── TLS fingerprinting via got-scraping (browser-like JA3) ───────────────
// Disabled: not in use. Kept commented for future re-enable.
// Restore the original block to re-enable per-host JA3 spoofing.
/*
let _gotScraping = null;
let _gotScrapingChecked = false;
const _gotScrapingLoggedHosts = new Set();

async function getGotScraping() {
  if (_gotScrapingChecked) return _gotScraping;
  _gotScrapingChecked = true;
  try {
    const mod = await import("got-scraping");
    _gotScraping = typeof mod.gotScraping === "function" ? mod.gotScraping : null;
    if (_gotScraping) dbg("TLS", "got-scraping loaded (browser-like JA3 enabled)");
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping unavailable, falling back to native fetch: ${e.message}`);
    _gotScraping = null;
  }
  return _gotScraping;
}

async function gotScrapingFetch(url, options) {
  const gs = await getGotScraping();
  if (!gs) return null;

  const method = (options.method || "GET").toUpperCase();
  const headersInit = options.headers || {};
  const headers = headersInit instanceof Headers
    ? Object.fromEntries(headersInit.entries())
    : { ...headersInit };

  return new Promise((resolve, reject) => {
    let settled = false;
    const stream = gs.stream({
      url,
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : options.body,
      throwHttpErrors: false,
      retry: { limit: 0 },
      timeout: { request: undefined },
      followRedirect: false,
      decompress: true,
    });

    if (options.signal) {
      const onAbort = () => { try { stream.destroy(new Error("aborted")); } catch { } };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.once("response", (res) => {
      if (settled) return;
      settled = true;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v)) v.forEach((x) => resHeaders.append(k, String(x)));
        else if (v != null) resHeaders.set(k, String(v));
      }
      const body = Readable.toWeb(stream);
      resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage || "", headers: resHeaders }));
    });

    stream.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function tryGotScrapingFetch(url, options) {
  try {
    const res = await gotScrapingFetch(url, options);
    if (res) {
      try {
        const host = new URL(typeof url === "string" ? url : url.toString()).hostname;
        if (!_gotScrapingLoggedHosts.has(host)) {
          _gotScrapingLoggedHosts.add(host);
          dbg("TLS", `using got-scraping for ${host}`);
        }
      } catch { }
    }
    return res;
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping request failed, fallback to native fetch: ${e.message}`);
    return null;
  }
}
*/

// MITM DNS bypass was removed. It routed every Kiro / Copilot / Cursor /
// Antigravity request through a manual raw-TLS socket, unconditionally — with no
// check that MITM DNS was enabled or that the host was even redirected. Where
// that socket fails (ECONNRESET, or a TLS handshake the edge aborts) each
// attempt burned its full connect timeout before falling back: measured 35s for
// a single Kiro request that takes ~3s on the ordinary fetch path. MITM is not
// used in this deployment, so there is nothing to bypass.

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try { protocol = new URL(targetUrl).protocol; } catch { return null; }

  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy ||
      process.env.ALL_PROXY || process.env.all_proxy;
  }

  return process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy;
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {

    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

function evictOldest(cacheMap) {
  if (cacheMap.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
    cacheMap.delete(cacheMap.keys().next().value);
  }
}

async function buildAgent(key, keepAliveTimeout, keepAliveMaxTimeout) {
  const cached = directDispatchers.get(key);
  if (cached) return cached;
  const { Agent } = await import("undici");
  evictOldest(directDispatchers);
  const agent = new Agent({ keepAliveTimeout, keepAliveMaxTimeout });
  directDispatchers.set(key, agent);
  return agent;
}

/**
 * Direct-path agent with a capped keep-alive TTL. Without it the request uses
 * undici's default pool, where keepAliveMaxTimeout is 600s: an edge that drops
 * an idle socket without a RST leaves it in the pool, and every retry draws that
 * same dead connection until the connect timeout expires.
 */
export function getDirectDispatcher() {
  const { keepAliveTimeout, keepAliveMaxTimeout } = resolveKeepAliveTimeouts();
  return buildAgent(`direct::${keepAliveTimeout}::${keepAliveMaxTimeout}`, keepAliveTimeout, keepAliveMaxTimeout);
}

/** No-reuse agent (`keepAliveTimeout: 1ms`) — one fresh TCP/TLS connection. */
export function getFreshRetryDispatcher() {
  return buildAgent("fresh", FRESH_RETRY_KEEPALIVE_TIMEOUT_MS, FRESH_RETRY_KEEPALIVE_TIMEOUT_MS);
}

/**
 * Direct-path fetch through the capped-keep-alive agent, with a single replay on
 * a no-reuse agent when the pooled socket is proven dead.
 *
 * The replay only fires when the error itself proves the socket died and no
 * response header arrived yet. A bare "fetch failed" is deliberately excluded:
 * with no error code the upstream may already hold the request, and replaying it
 * would send — and bill — the same completion twice.
 */
async function fetchDirect(url, options) {
  const dispatcher = await getDirectDispatcher();
  try {
    return await originalFetch(url, { ...options, dispatcher });
  } catch (error) {
    const aborted = options?.signal?.aborted === true;
    if (aborted || !isFreshSocketReplayEnabled() || !isStaleSocketError(error)) throw error;
    dbg("[ProxyFetch] dead pooled socket, replaying once on a fresh connection", error?.message);
    return await originalFetch(url, { ...options, dispatcher: await getFreshRetryDispatcher() });
  }
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 */
async function getDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatchers.has(normalized)) {
    // Evict oldest entry if max size reached
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      proxyDispatchers.delete(proxyDispatchers.keys().next().value);
    }
    const { ProxyAgent } = await import("undici");
    proxyDispatchers.set(normalized, new ProxyAgent({ uri: normalized }));
  }

  return proxyDispatchers.get(normalized);
}

// OpenCode's free-tier gate answers 403 `FreeTierError` when the request
// exits from an IP it has flagged — the transport itself succeeded, so the
// proxy-failure fallback below never sees it and every retry keeps leaving
// through the same flagged proxy. Live measurement (#4983 upstream): identical
// body and headers in the same minute — flagged pool egress -> 403
// FreeTierError, direct egress -> 200.
const FREE_TIER_ERROR_MARKER = "FreeTierError";

/** Rebuild a response whose body we buffered while inspecting it. */
function bufferedResponse(text, original) {
  const headers = new Headers(original.headers);
  // The body was decoded while reading, so upstream framing no longer applies.
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(text, { status: original.status, statusText: original.statusText, headers });
}

function targetHost(url) {
  try {
    return new URL(typeof url === "string" ? url : url.toString()).host;
  } catch {
    return String(url);
  }
}

/**
 * After a proxied attempt, replay once on the direct egress when upstream
 * rejected the *proxy's IP* (403 FreeTierError). A body already consumed by the
 * first attempt cannot be resent, and strictProxy keeps its contract of never
 * leaving over another path — both return the rejection as-is.
 */
async function replayFreeTierRejectionDirect(url, options, proxied) {
  if (proxied?.status !== 403) return proxied;
  let text;
  try {
    text = await proxied.text();
  } catch {
    return proxied;
  }
  if (!text.includes(FREE_TIER_ERROR_MARKER)) return bufferedResponse(text, proxied);
  if (options?.body && typeof options.body.getReader === "function" && options.body.locked) {
    return bufferedResponse(text, proxied);
  }
  console.warn(`[ProxyFetch] Proxy egress rejected by the OpenCode free-tier gate (403 FreeTierError); replaying direct: ${targetHost(url)}`);
  try {
    return await originalFetch(url, options);
  } catch (directError) {
    // The direct replay failed outright — surface the original rejection.
    console.warn(`[ProxyFetch] Direct replay failed: ${directError.message}`);
    return bufferedResponse(text, proxied);
  }
}

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  // Keep the spoofed Claude Code version current — new models require a minimum
  // CLI version. Refresh in the background so an unreachable npm registry never
  // adds latency; the request uses the version already known (fail-open floor).
  if (hasClaudeCliHeader(options.headers)) {
    void ensureClaudeCliVersion(originalFetch);
    options = { ...options, headers: applyClaudeCliVersion(options.headers) };
  }

  const targetUrl = typeof url === "string" ? url : url.toString();

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const baseHeaders = options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers || {}) };
    const relayHeaders = {
      ...baseHeaders,
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    return originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      const proxied = await originalFetch(url, { ...options, dispatcher });
      // strictProxy never leaves the configured path — pass the rejection through.
      if (proxyOptions?.strictProxy === true) return proxied;
      return await replayFreeTierRejectionDirect(url, options, proxied);
    } catch (proxyError) {
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
      }
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return fetchDirect(url, options);
    }
  }

  // got-scraping disabled — use native fetch directly
  // (Re-enable per-host by wrapping with tryGotScrapingFetch when needed)
  return fetchDirect(url, options);
}

/**
 * Patched global fetch with env-proxy support and MITM DNS bypass
 */
async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
