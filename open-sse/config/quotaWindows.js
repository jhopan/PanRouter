// Quota-window config: how long a connection must stay parked after its free
// tier refuses a request, per provider.
//
// Reality: providers reset on wildly different cadences — Cline daily, tokenharbor
// daily (Pacific), Antigravity weekly, Claude/Codex 5-hour session windows, Kiro
// on a date it reports itself. Hardcoding one cadence either parks accounts for
// days too long (quota already reset) or retries them hundreds of times (quota
// still empty).
//
// So each entry prefers the provider's own reset timestamp (read from its usage
// API, which the repo already implements per provider) and only falls back to a
// calendar computation when the usage API is unavailable.

/** Calendar fallback scopes. */
export const QUOTA_SCOPES = {
  SESSION: "session",
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
};

export const QUOTA_WINDOWS = {
  /**
   * Per-provider window. Fields:
   *   scope        — calendar fallback cadence (QUOTA_SCOPES).
   *   usageKey     — quota key inside the usage response to read resetAt from.
   *                  null = any quota with a future resetAt (earliest wins).
   *   resetUtcHour — daily scope only: hour (UTC) the quota day rolls over.
   *   maxCooldownMs— per-provider ceiling (defaults to defaultMaxCooldownMs).
   */
  providers: {
    // ── Providers that report an exact reset timestamp ─────────────────────
    // Kiro reports a date via `nextDateReset` in its usage API.
    kiro: { scope: QUOTA_SCOPES.MONTHLY, usageKey: null },
    // Weekly buckets from retrieveUserQuotaSummary (resetTime per bucket).
    antigravity: { scope: QUOTA_SCOPES.WEEKLY, usageKey: "gemini_weekly" },
    // 5h primary window + weekly secondary; `session` is the short one.
    codex: { scope: QUOTA_SCOPES.SESSION, usageKey: "session" },
    claude: { scope: QUOTA_SCOPES.SESSION, usageKey: "session (5h)" },
    // Dynamic windows: "Session (Nh)" and "Weekly (7d)".
    glm: { scope: QUOTA_SCOPES.SESSION, usageKey: "session" },
    "glm-cn": { scope: QUOTA_SCOPES.SESSION, usageKey: "session" },
    // Grok CLI (registry alias `grok-build`/`gb` — one provider id). Every quota
    // row it reports shares one reset: `currentPeriod.end`, typed
    // USAGE_PERIOD_TYPE_WEEKLY. `usageKey: null` → earliest future reset across
    // rows, which is that same weekly boundary on every tier.
    "grok-cli": { scope: QUOTA_SCOPES.WEEKLY, usageKey: null },
    // "Weekly" bucket + a short "Ratelimit" window.
    kimi: { scope: QUOTA_SCOPES.WEEKLY, usageKey: "Weekly" },
    // Refill packs labelled Daily/Weekly/Monthly by cycle length + Bonus Pack N.
    // CycleEndTime is usually a monthly subscription cycle.
    "codebuddy-cn": { scope: QUOTA_SCOPES.MONTHLY, usageKey: "Monthly" },
    // Credits exhausted must wait for the recurring refill window, never a
    // one-shot Bonus Pack expiry. `Monthly` maps to CycleEndTime in the tracker.
    "codebuddy-intl": { scope: QUOTA_SCOPES.MONTHLY, usageKey: "Monthly" },
    // Monthly premium-request quotas (no per-quota resetAt — calendar only).
    github: { scope: QUOTA_SCOPES.MONTHLY, usageKey: null },
    // Billing-cycle reset (subscription_period.ended_at).
    zed: { scope: QUOTA_SCOPES.MONTHLY, usageKey: null },
    // Weekly + monthly pools.
    "opencode-go": { scope: QUOTA_SCOPES.WEEKLY, usageKey: null },
    // OpenCode Zen PAYG: rolling/weekly/monthly pools; calendar-weekly parking.
    "opencode-zen": { scope: QUOTA_SCOPES.WEEKLY, usageKey: null },
    // Weekly quota (needs a Xiaomi session; API key alone can't read resetAt).
    "xiaomi-mimo": { scope: QUOTA_SCOPES.WEEKLY, usageKey: null },
    // Daily free-tier request caps.
    groq: { scope: QUOTA_SCOPES.DAILY, usageKey: null },
    // Rolling 7-day free allowance (no usage API). The 429 body itself states
    // the exact reset ("next rolling 7-day period starts on 2 Oct 2026 at
    // 06:22 UTC") — quotaWindow.js parses it; the weekly calendar here is only
    // the fallback when the message shape changes.
    tokenharbor: { scope: QUOTA_SCOPES.WEEKLY, usageKey: null },
    // ── Calendar-only providers ────────────────────────────────────────────
    cline: { scope: QUOTA_SCOPES.DAILY, resetUtcHour: 0 },
    default: { scope: QUOTA_SCOPES.DAILY, resetUtcHour: 0 },
  },

  sessionWindowMs: 5 * 60 * 60 * 1000, // rolling 5h window when no resetAt is known
  weeklyResetWeekday: 1,               // 1 = Monday (UTC)
  monthlyResetDay: 1,                  // 1st of next month (UTC)
  // Safety ceiling: a clock/misclassification bug must never park an account
  // for longer than this.
  defaultMaxCooldownMs: 40 * 24 * 60 * 60 * 1000,
};

/**
 * Calendar fallback for a quota scope, computed from `now`.
 * Pure — no I/O, no imports. Used by the error path (placeholder cooldown) and
 * by the quota-window resolver (when the usage API has no resetAt).
 * @param {string} scope - QUOTA_SCOPES value
 * @param {{resetUtcHour?:number, sessionWindowMs?:number, weeklyResetWeekday?:number, monthlyResetDay?:number}} cfg
 * @param {number} now
 * @returns {number} epoch ms of the next reset
 */
export function calendarResetMs(scope, cfg = {}, now = Date.now()) {
  switch (scope) {
    case QUOTA_SCOPES.SESSION: {
      // Rolling window with no boundary reported upstream — assume a full
      // window from now (slightly optimistic, never retries too early).
      return now + (cfg.sessionWindowMs || 5 * 60 * 60 * 1000);
    }
    case QUOTA_SCOPES.WEEKLY: {
      // Next occurrence of the configured weekday (default Monday) at 00:00 UTC.
      const d = new Date(now);
      const target = cfg.weeklyResetWeekday ?? 1;
      const delta = (target - d.getUTCDay() + 7) % 7;
      d.setUTCDate(d.getUTCDate() + (delta === 0 ? 7 : delta));
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    }
    case QUOTA_SCOPES.MONTHLY: {
      const d = new Date(now);
      d.setUTCMonth(d.getUTCMonth() + 1, cfg.monthlyResetDay ?? 1);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    }
    case QUOTA_SCOPES.DAILY:
    default: {
      const d = new Date(now);
      d.setUTCHours(cfg.resetUtcHour ?? 0, 0, 0, 0);
      if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
      return d.getTime();
    }
  }
}

/** Resolve the effective config for a provider (falls back to `default`). */
export function quotaWindowFor(provider) {
  const key = String(provider || "").toLowerCase();
  const { providers, ...shared } = QUOTA_WINDOWS;
  const merged = { ...providers.default, ...(providers[key] || {}) };
  return {
    ...shared,
    ...merged,
    maxCooldownMs: merged.maxCooldownMs ?? shared.defaultMaxCooldownMs,
  };
}

// ── Quota-refusal signatures ───────────────────────────────────────────────
// Single source of truth: errorConfig builds its ERROR_RULES from this list and
// the quota-window resolver uses it to decide "this is a quota refusal, not a
// burst rate limit". Keep additions lowercase (matching lowercases the text).
export const QUOTA_EXHAUSTED_SIGNALS = [
  "daily free limit reached",   // Cline INFERENCE_CAP_ERROR
  "inference_cap_error",        // Cline error code
  "daily limit",
  "daily quota",
  "weekly limit",
  "weekly quota",
  "monthly limit",
  "monthly quota",
  "quota will reset",
  "quota exhausted",
  "free limit reached",
  // Codex 429 can be a bare `The usage limit has been reached` without the
  // structured `usage_limit_reached` payload. Classify it as a quota refusal
  // so auth.js reads the live Codex quota tracker reset instead of backoff.
  "usage limit has been reached",
  // CodeBuddy code 14018: `Credits exhausted. Please visit ...`.
  "credits exhausted",
  // TokenHarbor free-tier rolling window: "You've used this period's free
  // allowance. Your next rolling 7-day period starts on <date> at <hh:mm> UTC."
  "free allowance",
  // Antigravity/Google quota refusals: "Individual quota reached. Please
  // upgrade your subscription to increase your limits. Resets in 74h19m34s."
  // with status RESOURCE_EXHAUSTED in the body.
  "individual quota",
  "resource_exhausted",
  "upgrade your subscription to increase",
  // Google/Antigravity default quota refusals: "You exceeded your current
  // quota" (403) and unverified-account variants. Without this, a 403 quota
  // refusal is treated as a 2-minute rate-limit instead of parked until the
  // weekly bucket resets.
  "exceeded your current quota",
];

/**
 * True when an upstream error means "your quota for this window is gone"
 * as opposed to "you are going too fast".
 * @param {unknown} errorText
 * @returns {boolean}
 */
export function isQuotaExhaustedError(errorText) {
  const lower = String(errorText || "").toLowerCase();
  if (!lower) return false;

  // A per-model FREQUENCY limit is a burst rate limit, not a quota refusal.
  // CodeBuddy 6004 says "usage exceeds frequency limit, but don't worry, your
  // usage will reset at <date>" — the word "limit" is there, but parking the
  // account on the provider's MONTHLY calendar (next 1st of month) because of a
  // 15-minute throttle is wrong: the account still serves other models and the
  // window reopens in minutes. Check this BEFORE the generic signals so a
  // message that also mentions "quota" cannot be misclassified.
  if (/frequency limit|rate.?limit|too many requests|exceeds? frequency|请求过于频繁/i.test(lower)) {
    return false;
  }

  // A SITE-WIDE capacity limit is shared by every key on the provider, so it is
  // not this account's quota either. BazaarLink returns
  // `code:"free_global_rate_limited"` with "Free models share a limited
  // site-wide capacity and it is currently full — this is not your personal
  // quota. Retry after 30 seconds". The body literally says the account is fine,
  // yet the phrase "quota" is present and would otherwise park every key until
  // the monthly calendar boundary.
  if (/site-wide|global_rate_limit|free_global_rate_limited|not your personal quota/i.test(lower)) {
    return false;
  }

  // Qoder billing refusal: code 112 (and 110 for the daily count) wraps a
  // `pricingUrl` — the account must buy credits. It carries no "quota" word, so
  // it fell through to the generic backoff and the model was locked for only
  // 120s, letting the router hammer a paying-required account every two minutes.
  if (/"code"\s*:\s*"?11[02]"?/.test(lower) || /pricingurl/.test(lower)) {
    return true;
  }

  // Kiro monthly cap: {"message":"You have reached the limit.",
  // "reason":"MONTHLY_REQUEST_COUNT"}. No "quota" keyword, so it fell through to
  // the generic 402 cooldown (120s) and the router retried a monthly-capped
  // account every two minutes for the rest of the month. Kiro declares scope
  // MONTHLY and its usage API reports `nextDateReset`, so classifying it as
  // quota-class lets auth.js read the real reset instead of guessing.
  if (/monthly_request_count/.test(lower) || /you have reached the limit/i.test(lower)) {
    return true;
  }

  return QUOTA_EXHAUSTED_SIGNALS.some((sig) => lower.includes(sig));
}

/**
 * Detect a provider-wide capacity limit: the pool is saturated for EVERY key,
 * so rotating to the next account cannot help. Callers use this to stop the
 * account loop instead of locking each key in turn.
 *
 * BazaarLink: `code:"free_global_rate_limited"`, "Free models share a limited
 * site-wide capacity ... Retry after 30 seconds".
 *
 * @param {number} status - HTTP status from upstream
 * @param {string} errorText - raw upstream body
 * @returns {{ globalLimit: true, retryAfterMs: number } | null}
 */
export function globalCapacityLimit(status, errorText) {
  if (Number(status) !== 429) return null;
  const text = String(errorText || "");
  const lower = text.toLowerCase();
  const isGlobal = /free_global_rate_limited|site-wide|shared capacity|全站共用/i.test(lower);
  if (!isGlobal) return null;

  // Prefer the provider's own retry hint so we do not guess.
  const secs = lower.match(/retry after (\d+)\s*(?:second|sec|s\b)/);
  const retryAfterMs = secs ? Math.min(parseInt(secs[1], 10), 300) * 1000 : 30 * 1000;
  return { globalLimit: true, retryAfterMs };
}
