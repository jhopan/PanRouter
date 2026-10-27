/**
 * MiniMax plan-capacity cache.
 *
 * Why: MiniMax refuses a request with
 *
 *   429 {"type":"error","error":{"type":"rate_limit_error",
 *        "message":"usage limit reached: insufficient balance (1008)"}}
 *
 * when the account's M Plan window is exhausted. The refusal is per account,
 * and the plan windows have a KNOWN reset (the tracker reports
 * `current_interval_remaining_percent`, `current_interval_status` and
 * `end_time`) — but PanRouter only learned about it from the 429, so the
 * account was locked for a flat 300 seconds and then tried again, burning a
 * real request each time.
 *
 * The usage API already reports the window. Remembering that reading lets the
 * router skip the account before the request goes out, exactly like the Kiro
 * monthly-cap cache.
 *
 * Advisory and short-lived: a missing or stale entry means "no opinion" and
 * the account stays eligible. We never block on a guess.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * How long an exhausted account stays skipped.
 *
 * The operator asked for a flat 24-hour block: a plan that ran out while a
 * 470k-token conversation was being sent is not worth retrying in a few hours,
 * and each retry is a real request against the provider. 24h parks the account
 * for the rest of the working day; the usage tracker overwrites the entry as
 * soon as the plan refills.
 */
const EXHAUSTED_TTL_MS = 24 * 60 * 60 * 1000;

/** connectionId -> { exhausted: boolean, resetAt: number|null, checkedAt: number } */
const capCache = new Map();

/** @returns {Map<string, object>} */
export function getMiniMaxCapCache() {
  return capCache;
}

/** Forget one connection (successful request, token change, manual reset). */
export function clearMiniMaxCap(connectionId) {
  if (connectionId) capCache.delete(connectionId);
}

/** Forget everything (tests / settings change). */
export function resetMiniMaxCapCache() {
  capCache.clear();
}

/**
 * Store a usage reading.
 *
 * A window is exhausted when its remaining percentage is 0 (or the tracker
 * says the interval is spent) AND it has not reset yet.
 *
 * @param {string} connectionId
 * @param {{quotas?: object}} usage - parsed MiniMax usage
 * @param {number} [now]
 */
export function recordMiniMaxUsage(connectionId, usage, now = Date.now()) {
  if (!connectionId || !usage?.quotas) return;

  let exhausted = false;
  let resetAt = null;

  for (const q of Object.values(usage.quotas)) {
    if (!q || typeof q !== "object") continue;

    // Credit balance: a zero balance means the account cannot pay at all.
    if (q.isCreditBalance) {
      const balance = Number(q.total);
      if (Number.isFinite(balance) && balance <= 0) {
        exhausted = true;
        // No reset time for credits — they are topped up by the user.
        resetAt = resetAt || null;
      }
      continue;
    }

    const pct = Number(q.remainingPercentage ?? q.remaining);
    const at = q.resetAt ? new Date(q.resetAt).getTime() : null;

    if (Number.isFinite(pct) && pct <= 0 && (!at || at > now)) {
      exhausted = true;
      if (at && (!resetAt || at < resetAt)) resetAt = at;
    } else if (at && at > now && (!resetAt || at < resetAt)) {
      // Remember the nearest future reset so a later 429 can use it.
      resetAt = resetAt || at;
    }
  }

  // A fresh reading OVERRIDES an exhausted entry: when the plan refills (or a
  // top-up lands), the tracker says so and the account becomes eligible again
  // immediately, without waiting for the 24h block to expire.
  capCache.set(connectionId, { exhausted, resetAt, checkedAt: now });
}

/**
 * Should this account be skipped for the current request?
 * @param {string} connectionId
 * @param {number} [now]
 * @returns {{ skip: boolean, until?: number|null, reason?: string }}
 */
export function shouldSkipMiniMaxAccount(connectionId, now = Date.now()) {
  const entry = capCache.get(connectionId);
  if (!entry) return { skip: false };
  // An exhausted account keeps its 24h block; a healthy one goes stale fast so
  // a fresh reading can take over.
  const ttl = entry.exhausted ? EXHAUSTED_TTL_MS : CACHE_TTL_MS;
  if (now - entry.checkedAt > ttl) {
    if (entry.exhausted) return { skip: true, until: null, reason: "plan exhausted" };
    return { skip: false };
  }

  if (!entry.exhausted) return { skip: false };

  // A reset time in the future means the window is still closed.
  if (!entry.resetAt) {
    // No reset time: the credit balance is empty. The user has to top up, so
    // there is nothing to wait for — but the 5-minute TTL would retry the
    // account every 5 minutes, and each attempt is a real request. Park it for
    // the full TTL without re-probing, and let the usage tracker overwrite the
    // entry the moment a top-up lands.
    return { skip: true, until: null, reason: "credit balance exhausted" };
  }
  if (entry.resetAt > now) {
    return { skip: true, until: entry.resetAt, reason: "plan window exhausted" };
  }
  // The window reset — drop the entry.
  capCache.delete(connectionId);
  return { skip: false };
}

/**
 * Mark an account exhausted straight from a 429, using the known reset when we
 * have one, else the generic cooldown.
 *
 * @param {string} connectionId
 * @param {number|null} resetAtMs
 * @param {number} [now]
 */
export function markMiniMaxExhausted(connectionId, resetAtMs = null, now = Date.now()) {
  if (!connectionId) return;
  const existing = capCache.get(connectionId);
  capCache.set(connectionId, {
    exhausted: true,
    resetAt: resetAtMs || existing?.resetAt || null,
    checkedAt: now,
  });
}
