/**
 * Kiro monthly-cap pre-filter.
 *
 * Why: Kiro's monthly cap (`reason: "MONTHLY_REQUEST_COUNT"`) refuses EVERY model
 * on that account. Relying on the 402 response alone means the request still
 * travels upstream, burns a round-trip, and only then learns the account is
 * capped — for every model, again and again.
 *
 * Kiro's usage API already reports the real numbers:
 *
 *   usageBreakdownList[].currentUsageWithPrecision  (used)
 *   usageBreakdownList[].usageLimitWithPrecision    (total)
 *   nextDateReset                                   (when it refills)
 *
 * So we remember that reading per connection and skip the account BEFORE the
 * request goes out. Same idea as the Antigravity bucket cache.
 *
 * The cache is advisory: a missing/expired/stale entry simply means "no opinion"
 * and the account stays eligible. We never block on a guess.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

/** connectionId -> { cappedUntil: number|null, resetAt: number|null, checkedAt: number, source: string } */
const capCache = new Map();

/** @returns {Map<string, object>} the live cache (tests may inspect it) */
export function getKiroCapCache() {
  return capCache;
}

/** Forget one connection (after a successful request, or a token change). */
export function clearKiroCap(connectionId) {
  if (connectionId) capCache.delete(connectionId);
}

/** Forget everything (tests / settings change). */
export function resetKiroCapCache() {
  capCache.clear();
}

/**
 * Store a usage reading.
 * @param {string} connectionId
 * @param {{quotas?: object}} usage - parsed Kiro usage (see usage/kiro.js)
 * @param {number} [now]
 */
export function recordKiroUsage(connectionId, usage, now = Date.now()) {
  if (!connectionId || !usage?.quotas) return;

  // The cap that matters is the monthly request count. Kiro reports it as a
  // resource bucket; take the first exhausted one, otherwise the nearest reset.
  let resetAt = null;
  let exhausted = false;

  for (const [key, q] of Object.entries(usage.quotas)) {
    if (!q || q.unlimited) continue;
    const total = Number(q.total) || 0;
    const used = Number(q.used) || 0;
    const remaining = Number.isFinite(Number(q.remaining)) ? Number(q.remaining) : total - used;
    const bucketReset = q.resetAt ? new Date(q.resetAt).getTime() : null;

    if (total > 0 && remaining <= 0) {
      exhausted = true;
      if (bucketReset && (!resetAt || bucketReset < resetAt)) resetAt = bucketReset;
    }
  }

  // Prefer an explicit reset when the account is capped; otherwise remember the
  // nearest future reset so a later 402 can use it.
  if (!resetAt) {
    for (const q of Object.values(usage.quotas)) {
      const t = q?.resetAt ? new Date(q.resetAt).getTime() : null;
      if (t && t > now && (!resetAt || t < resetAt)) resetAt = t;
    }
  }

  capCache.set(connectionId, {
    exhausted,
    cappedUntil: exhausted && resetAt ? resetAt : null,
    resetAt,
    checkedAt: now,
    source: "usage",
  });
}

/**
 * Should this account be skipped for the current request?
 * Advisory only: returns false when we have no fresh reading.
 *
 * @param {string} connectionId
 * @param {number} [now]
 * @returns {{ skip: boolean, until?: number, reason?: string }}
 */
export function shouldSkipKiroAccount(connectionId, now = Date.now()) {
  const entry = capCache.get(connectionId);
  if (!entry) return { skip: false };
  if (now - entry.checkedAt > CACHE_TTL_MS) return { skip: false };

  if (entry.exhausted && entry.cappedUntil && entry.cappedUntil > now) {
    return { skip: true, until: entry.cappedUntil, reason: "monthly cap reached" };
  }
  // The reset time has passed: the cap is over, drop the entry.
  if (entry.cappedUntil && entry.cappedUntil <= now) {
    capCache.delete(connectionId);
    return { skip: false };
  }
  return { skip: false };
}

/**
 * Mark an account capped straight from a 402 body, using the usage API's reset
 * when we have it, else the calendar boundary of the next month.
 *
 * @param {string} connectionId
 * @param {number|null} resetAtMs
 * @param {number} [now]
 */
export function markKiroCapped(connectionId, resetAtMs = null, now = Date.now()) {
  if (!connectionId) return;
  const existing = capCache.get(connectionId);
  const resetAt = resetAtMs
    || existing?.resetAt
    || Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);

  capCache.set(connectionId, {
    exhausted: true,
    cappedUntil: resetAt,
    resetAt,
    checkedAt: now,
    source: resetAtMs ? "usage" : "calendar",
  });
}
