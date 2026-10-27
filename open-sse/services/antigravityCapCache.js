/**
 * Antigravity account-eligibility pre-filter.
 *
 * Why: Google can flag an account as ineligible ("VALIDATION_REQUIRED") and
 * require a browser re-verification. The official CLI 1.4.8 checks
 * `ineligibleTiers` in the loadCodeAssist response and STOPS — it never sends
 * the chat request. PanRouter used to ignore the field and only regex-scan the
 * payload for the word "verify", so a flagged account kept serving traffic and
 * every request was a wasted round-trip.
 *
 * Two upstream signals carry the gate (both observed in a live MITM capture of
 * the official CLI, 2026-10-27, account ayuantini63):
 *
 *   1. POST /v1internal:loadCodeAssist            → 200
 *      { ineligibleTiers: [ { reasonCode: "VALIDATION_REQUIRED",
 *                              validationUrl: "https://accounts.google.com/..." } ] }
 *
 *   2. POST /v1internal:retrieveUserQuotaSummary  → 403 PERMISSION_DENIED
 *      { error: { details: [ { reason: "VALIDATION_REQUIRED",
 *                               metadata: { validation_url: "..." } } ] } }
 *
 * We remember the verdict per connection and skip the account BEFORE the
 * request goes out, exactly like the Kiro monthly-cap pre-filter.
 *
 * The cache is advisory: a missing/expired entry means "no opinion" and the
 * account stays eligible. We never block on a guess. A flagged entry is
 * persisted so it survives a restart, and a later healthy reading clears it —
 * the user verifying in a browser must be enough to bring the account back.
 */

import { makeKv } from "@/lib/db/helpers/kvStore";

const kv = makeKv("antigravity_ineligible");

const CACHE_TTL_MS = 15 * 60 * 1000;

/** connectionId -> { flaggedAt: number, reasonCode: string|null, validationUrl: string|null } */
const ineligibleCache = new Map();

/** @returns {Map<string, object>} the live cache (tests may inspect it) */
export function getAntigravityIneligibleCache() {
  return ineligibleCache;
}

/**
 * Persist / clear the flagged entry so it survives restarts.
 * Fail-open: a KV error must never touch the request path.
 */
async function persistEntry(connectionId, entry) {
  try {
    if (entry?.flagged) {
      await kv.set(connectionId, {
        flagged: true,
        flaggedAt: entry.flaggedAt,
        reasonCode: entry.reasonCode ?? null,
        validationUrl: entry.validationUrl ?? null,
      });
    } else {
      await kv.remove(connectionId);
    }
  } catch { /* fail-open */ }
}

/**
 * Should this account be skipped because Google flagged it?
 *
 * @param {string} connectionId
 * @param {number} [now]
 * @returns {boolean} true when the account is known-ineligible and still fresh
 */
export function shouldSkipAntigravityAccount(connectionId, now = Date.now()) {
  if (!connectionId) return false;
  const entry = ineligibleCache.get(connectionId);
  if (!entry?.flagged) return false;
  if (now - entry.flaggedAt > CACHE_TTL_MS) {
    ineligibleCache.delete(connectionId);
    return false;
  }
  return true;
}

/**
 * The details of a flagged account, for the dashboard and the log.
 * @param {string} connectionId
 * @returns {{flagged: boolean, reasonCode: string|null, validationUrl: string|null, flaggedAt: number|null}|null}
 */
export function getAntigravityIneligibility(connectionId) {
  const entry = ineligibleCache.get(connectionId);
  if (!entry?.flagged) return null;
  return {
    flagged: true,
    reasonCode: entry.reasonCode ?? null,
    validationUrl: entry.validationUrl ?? null,
    flaggedAt: entry.flaggedAt ?? null,
  };
}

/**
 * Record an eligibility verdict.
 *
 * @param {string} connectionId
 * @param {object|null} eligibility - from parseAntigravityEligibility() /
 *   parseAntigravityQuotaEligibility(), or null for "no opinion"
 * @returns {Promise<boolean>} whether the account is now considered flagged
 */
export async function recordAntigravityEligibility(connectionId, eligibility) {
  if (!connectionId) return false;

  // No opinion (the probe failed, or the payload had no eligibility fields):
  // clear any stale flag so a transient failure does not disable a healthy
  // account forever.
  if (!eligibility || eligibility.eligible !== false) {
    if (ineligibleCache.has(connectionId)) {
      ineligibleCache.delete(connectionId);
      await persistEntry(connectionId, null);
    }
    return false;
  }

  const entry = {
    flagged: true,
    flaggedAt: Date.now(),
    reasonCode: eligibility.reasonCode ?? null,
    validationUrl: eligibility.validationUrl ?? null,
  };
  ineligibleCache.set(connectionId, entry);
  await persistEntry(connectionId, entry);
  return true;
}

/**
 * Restore flagged entries from the KV store at startup.
 * Fail-open: a KV error must never prevent the app from starting.
 *
 * @returns {Promise<number>} how many entries were restored
 */
export async function restoreAntigravityIneligible() {
  try {
    const raw = await kv.getAll();
    const now = Date.now();
    let kept = 0;
    for (const [connectionId, value] of Object.entries(raw || {})) {
      if (!value?.flagged) continue;
      const flaggedAt = Number(value.flaggedAt) || now;
      // A flag older than the TTL is stale — the account may have been
      // verified in the meantime. Drop it and let the next probe decide.
      if (now - flaggedAt > CACHE_TTL_MS) {
        await kv.remove(connectionId);
        continue;
      }
      ineligibleCache.set(connectionId, {
        flagged: true,
        flaggedAt,
        reasonCode: value.reasonCode ?? null,
        validationUrl: value.validationUrl ?? null,
      });
      kept += 1;
    }
    if (kept > 0) {
      console.warn(`[AG_QUOTA] restored ${kept} flagged account(s) from DB`);
    }
    return kept;
  } catch (e) {
    console.warn(`[AG_QUOTA] restoreAntigravityIneligible failed (non-fatal): ${e.message}`);
    return 0;
  }
}

/**
 * Clear the cached flag for a connection — used by the "check & release" button
 * after the user verified the account in a browser.
 */
export async function clearAntigravityIneligible(connectionId) {
  ineligibleCache.delete(connectionId);
  await persistEntry(connectionId, null);
}
