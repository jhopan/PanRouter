/**
 * Provider-banned account marker.
 *
 * A provider can ban an account outright — CodeBuddy 11140 says "Your account
 * has been restricted due to unusual activity" and offers only a feedback form
 * to appeal. That is not a cooldown: the account stays refused until the
 * provider lifts it.
 *
 * The rotation lock (`modelLock___all`, 30 days) already keeps such an account
 * out of rotation, but it is invisible: the account still looks active in the
 * dashboard and "Test connection" still sends a request to it. So the ban is
 * also recorded on the connection as `bannedUntil` + `banReason`, and the
 * account is filtered out of the candidate list.
 *
 * The ban expires on its own — a wrongly-flagged account comes back without
 * anyone touching it. A manual "Unban" clears it sooner.
 */

/** How long a ban stays recorded when the provider gives no reset time. */
export const DEFAULT_BAN_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Is this connection currently banned?
 * @param {object|null|undefined} connection
 * @param {number} [now]
 * @returns {boolean}
 */
export function isBannedConnection(connection, now = Date.now()) {
  const until = connection?.bannedUntil;
  if (!until) return false;
  const ts = new Date(until).getTime();
  if (!Number.isFinite(ts)) return false;
  return ts > now;
}

/**
 * The fields to write when a provider bans the account.
 * @param {string} reason
 * @param {number|null} [untilMs] - provider supplied reset, if any
 * @param {number} [now]
 * @returns {{bannedUntil: string, banReason: string}}
 */
export function banFields(reason, untilMs = null, now = Date.now()) {
  const until = untilMs && untilMs > now ? untilMs : now + DEFAULT_BAN_DURATION_MS;
  return {
    bannedUntil: new Date(until).toISOString(),
    banReason: String(reason || "Provider banned this account").slice(0, 200),
  };
}

/**
 * Fields that clear a ban. Written as null so the JSON column keeps the key
 * (matching how modelLock_* are cleared).
 */
export function clearBanFields() {
  return { bannedUntil: null, banReason: null };
}
