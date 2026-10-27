// OpenAI-compatible error types mapping (client-facing)
import { QUOTA_EXHAUSTED_SIGNALS, quotaWindowFor, calendarResetMs } from "./quotaWindows.js";

export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// ── Banned accounts ─────────────────────────────────────────────────────────
// A provider that explicitly bans the account ("Your account has been
// restricted due to unusual activity" / "Submit feedback to appeal this
// restriction") is not a temporary condition. Retrying it every few hours is
// pointless and — worse — makes the request pattern look more automated, which
// is the very thing the ban was issued for. Park it for 30 days; a manually
// appealed account returns on its own long before that.
export const BANNED_ACCOUNT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

// ── Free-tier quota refusals ───────────────────────────────────────────────
// Signatures + per-provider reset windows live in config/quotaWindows.js (single
// source of truth). `checkFallbackError` returns a calendar placeholder here;
// auth.js refines it with the provider's real reset timestamp when its usage API
// answers — see open-sse/services/quotaWindow.js.
export const MAX_DAILY_QUOTA_COOLDOWN_MS = 40 * 24 * 60 * 60 * 1000;

/**
 * Placeholder cooldown used by the sync rule matcher. Prefers the provider's
 * cadence, falling back to the daily default.
 * @param {string|null} provider
 * @param {number} now
 * @returns {number}
 */
export function dailyQuotaCooldownMs(provider = null, now = Date.now()) {
  const cfg = quotaWindowFor(provider);
  return Math.min(Math.max(calendarResetMs(cfg.scope, cfg, now) - now, 60 * 1000), cfg.maxCooldownMs);
}


// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  // Cloudflare error 1015 — "You are being rate limited" — IP-level CF block.
  // Distinct from a generic HTML cold-start page: CF 1015 will not self-heal in
  // seconds; the IP (relay egress) is blocked for minutes-to-hours. Lock the
  // account for 1 hour so the request falls to the next account (different relay,
  // different egress IP) instead of hammering the same blocked IP every 5s.
  // Must come BEFORE the generic "<!doctype html" rule below.
  { text: "you are being rate limited", cooldownMs: 60 * 60 * 1000 },
  { text: "error 1015",                 cooldownMs: 60 * 60 * 1000 },
  // HTML error page (e.g. Render cold-start 403 HTML, Cloudflare challenge) —
  // infra-level transient, not an account/permission problem. Short cooldown so
  // the retry succeeds once the origin is awake.
  { text: "<!doctype html", cooldownMs: COOLDOWN.short },
  // ── Free-tier quota refusals (must precede the generic rate-limit rules) ───
  // "Daily free limit reached on model X" (Cline INFERENCE_CAP_ERROR) is a
  // whole-window refusal, not a burst rate limit: backoff retries every few
  // minutes all fail. Signature list + per-provider reset windows live in
  // config/quotaWindows.js; auth.js refines the cooldown with the provider's
  // real reset timestamp when its usage API answers.
  ...QUOTA_EXHAUSTED_SIGNALS.map((text) => ({ text, dailyQuota: true })),
  // Cline OAuth 401 "re-authenticate your Cline account" — refreshable token
  // (OmniRoute #12594 parity): chatCore already attempts a token refresh on 401;
  // the follow-up retry should come fast, not after a 2-minute cooldown.
  { text: "re-authenticate your cline account", cooldownMs: COOLDOWN.short },
  // Kiro IDC missing profileArn / wrong Q region — recoverable config issue,
  // NOT a ban (OmniRoute #11809 parity). Short cooldown so the connection
  // stays active and the retry succeeds after region/profile resolution.
  { text: "user is not authorized to make this call", cooldownMs: COOLDOWN.short },
  // ── MiniMax Code plan exhaustion ─────────────────────────────────────────
  // "usage limit reached: insufficient balance (1008)" means the M Plan window
  // or the credit balance is spent. The plan window does have a reset time, but
  // the operator asked for a flat 24-hour block: a plan that ran out while
  // 470k tokens of conversation were being sent is not worth retrying in a few
  // hours, and every retry burns a real request. 24h keeps the account parked
  // for the rest of the working day and lets the usage tracker overwrite the
  // entry as soon as the plan refills.
  { provider: "minimax-code", text: "insufficient balance", cooldownMs: 24 * 60 * 60 * 1000 },
  { provider: "minimax-code-global", text: "insufficient balance", cooldownMs: 24 * 60 * 60 * 1000 },
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  // ── CodeBuddy Intl gateway blocks (upstream 9router PR #5024) ───────────
  // 11140 is an outright BAN ("Your account has been restricted due to unusual
  // activity" / "Submit feedback to appeal this restriction"). It arrives with
  // msg:"request illegal" AND the restriction text in displayMsg, so the ban
  // rules must come FIRST — otherwise the generic "request illegal" rule below
  // swallows it and the account gets a 2s backoff instead of being parked.
  //
  // Retrying a banned account every few hours is pointless and makes the
  // request pattern look more automated, which is the very thing the ban was
  // issued for. Upstream 9router has no 11140 handling at all — this is ours.
  { provider: "codebuddy-intl", code: 11140, banned: true },
  { provider: "codebuddy-intl", text: "unusual activity",  banned: true },
  { provider: "codebuddy-intl", text: "restricted due to", banned: true },
  // The Intl gateway rejects a request with "request illegal" / "conversation
  // id missing" when its channel verification dislikes the request shape. That
  // is a per-request refusal, but the gateway also throttles the caller, so
  // the connection should back off EXPONENTIALLY instead of taking the flat
  // 403 cooldown below. Provider-scoped on purpose: the same wording from
  // another provider stays request-scoped and must not cool the account down.
  // "request illegal" without a code is handled in parseError (banned: true).
  // "conversation id missing" is still a transient per-request backoff.
  { provider: "codebuddy-intl", text: "conversation id missing",  backoff: true },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { text: "waiting_room_required",   cooldownMs: 2000 },  // 428 — executor already ran the ad-chain; retry soon
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 429, backoff: true },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};
