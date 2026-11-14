// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Re-export error config (backward compat)
export { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, BACKOFF_CONFIG, COOLDOWN_MS } from "./errorConfig.js";

// Cache TTLs (seconds)
export const CACHE_TTL = {
  userInfo: 300,    // 5 minutes
  modelAlias: 3600  // 1 hour
};

// Memory management config
export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: 20,
};

// Parse a positive integer env override, falling back to a default.
function envMs(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function envUrl(name, def) {
  const raw = process.env[name]?.trim();
  return raw || def;
}

// SearXNG endpoint used by the unauthenticated web-search provider.
// Configure this for a separate Docker service or remote SearXNG instance.
export const SEARXNG_URL = envUrl("SEARXNG_URL", "http://localhost:8888/search");

// Inter-chunk stall timeout (once tokens are flowing). Generous headroom so
// slow reasoning models aren't aborted mid-stream. Env: STREAM_STALL_TIMEOUT_MS.
export const STREAM_STALL_TIMEOUT_MS = envMs("STREAM_STALL_TIMEOUT_MS", 360 * 1000);

// Time-to-first-token timeout (prompt prefill). Env: STREAM_FIRST_CHUNK_TIMEOUT_MS.
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200 * 1000);

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration
export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 60 * 1000);

// Keep-alive socket TTL. Upstream edges (Cloudflare, AWS Global Accelerator, the
// hosts behind NVIDIA NIM) drop idle sockets without sending a TCP RST. undici's
// defaults are far too generous for that: keepAliveMaxTimeout is 600s, and an
// upstream `Keep-Alive: timeout=...` header can raise the idle timeout all the
// way up to it. A dropped socket therefore stays in the pool, every retry draws
// the same dead connection, and the request hangs until FETCH_CONNECT_TIMEOUT_MS
// — multiplied by the whole retry ladder.
//
// Cap both values low so a socket that the edge has silently discarded leaves the
// pool within seconds instead of minutes.
export const DEFAULT_KEEPALIVE_TIMEOUT_MS = 4 * 1000;
// 1ms is undici's "do not reuse anything" setting: every request opens a fresh
// TCP/TLS connection. Only used by the one-shot retry after a proven dead socket.
export const FRESH_RETRY_KEEPALIVE_TIMEOUT_MS = 1;

export function resolveKeepAliveTimeouts() {
  const timeout = envMs("FETCH_KEEPALIVE_TIMEOUT_MS", DEFAULT_KEEPALIVE_TIMEOUT_MS);
  // Both sides of the pair, clamped to the same value: clamping only
  // keepAliveTimeout would let an upstream Keep-Alive header push the socket's
  // life back up to keepAliveMaxTimeout.
  return { keepAliveTimeout: timeout, keepAliveMaxTimeout: timeout };
}

// Transport-level replay of a request whose pooled socket died. OFF by default:
// the root cause is the keep-alive TTL above, which alone shrinks the hang
// window from ~249s to seconds. A replay also has to coexist with providers that
// run their own signed-POST replay protection (Qoder's requestId changes per
// attempt), and stacking two replay layers re-sends a request that the outer one
// deliberately refuses to resend. Opt in with FETCH_FRESH_RETRY=1 once a
// deployment has been checked against the providers it actually uses.
export function isFreshSocketReplayEnabled() {
  const raw = String(process.env.FETCH_FRESH_RETRY ?? "").trim().toLowerCase();
  return raw === "1" || raw === "on" || raw === "true" || raw === "yes";
}

// A dead pooled socket surfaces as one of these. DNS, connect-refused and TLS
// failures are listed separately so a genuinely unreachable host is never
// mistaken for a stale socket and replayed.
export const STALE_SOCKET_ERROR_CODES = new Set([
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_HEADERS_TIMEOUT",
]);

export const NON_STALE_SOCKET_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_INVALID_ARG",
  "UND_ERR_ABORTED",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

// Deliberately excludes a bare "fetch failed": with no error code there is no
// proof the socket died, and the upstream may already be holding the request.
// Replaying it there would send — and bill — the same completion twice.
export const STALE_SOCKET_ERROR_SUBSTRINGS = [
  "other side closed",
  "socket hang up",
];

// Gemini native TTS fetch timeout: abort if Google does not return response headers in time.
export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS = envMs("GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS", 45 * 1000);

// Default token limits
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

export const TOKEN_SAVER_HEADER = "x-9router-token-saver";

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

// Default retry config by status code: { attempts, delayMs }
// Backward compat: if value is a number, treated as attempts with RETRY_CONFIG.delayMs
export const DEFAULT_RETRY_CONFIG = {
  429: { attempts: 0, delayMs: 0 },
  502: { attempts: 3, delayMs: 3000 },
  503: { attempts: 3, delayMs: 2000 },
  504: { attempts: 2, delayMs: 3000 }
};

// Normalize a retry entry to { attempts, delayMs }
export function resolveRetryEntry(entry) {
  if (entry == null) return { attempts: 0, delayMs: RETRY_CONFIG.delayMs };
  if (typeof entry === "number") return { attempts: entry, delayMs: RETRY_CONFIG.delayMs };
  return {
    attempts: entry.attempts || 0,
    delayMs: entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs
  };
}

// Requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];
