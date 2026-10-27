/**
 * Cooldown countdown helpers for the dashboard.
 *
 * The backend's `getEarliestModelLockUntil` picks the EARLIEST lock, because
 * that is the moment an account becomes selectable again — the right answer
 * when routing. For a countdown the opposite is true: the account is still
 * parked while ANY lock is live, so the countdown must run to the LAST live
 * lock.
 *
 * The old dashboard code used `sort()[0]` — the earliest of all locks,
 * including ones that had already expired. With an expired lock plus a live
 * one, the expired one won, the difference went negative, and no countdown
 * was rendered at all: the account looked parked with no hint of when it
 * frees up.
 *
 * A quota refusal is not always a model lock. Codex and Kiro record the
 * quota window in `quotaExhaustedUntil`, and a quota park may have no model
 * lock at all, so that field is a source too.
 */

/**
 * The moment a connection's cooldown ends: the LATEST live lock, or the
 * quota-exhaustion date, whichever is later.
 *
 * @param {object} connection - connection record
 * @param {number} [now] - current epoch ms
 * @returns {string|null} ISO timestamp, or null when nothing is parked
 */
export function getCooldownUntil(connection, now = Date.now()) {
  if (!connection || typeof connection !== "object") return null;

  const candidates = [];

  for (const [key, value] of Object.entries(connection)) {
    if (!key.startsWith("modelLock_") || !value) continue;
    const ms = new Date(value).getTime();
    if (Number.isFinite(ms) && ms > now) candidates.push(ms);
  }

  // A quota park (Codex, Kiro) records the window here; it can be the only
  // record of the cooldown when no model lock was written.
  if (connection.quotaExhaustedUntil) {
    const ms = new Date(connection.quotaExhaustedUntil).getTime();
    if (Number.isFinite(ms) && ms > now) candidates.push(ms);
  }

  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates)).toISOString();
}

/**
 * Human-readable countdown, matching the format the dashboard already uses:
 * "45s", "12m 30s", "499h 20m".
 *
 * @param {string} until - ISO timestamp
 * @param {number} [now] - current epoch ms
 * @returns {string} empty string when the time has passed
 */
export function formatCooldownRemaining(until, now = Date.now()) {
  const diff = new Date(until).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return "";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
