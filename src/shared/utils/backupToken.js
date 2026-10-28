import crypto from "crypto";

/**
 * Backup download tokens.
 *
 * A backup token lets an unattended machine (the Debian mirror) pull the
 * database over HTTP. It is deliberately NOT an API key:
 *
 *   - different prefix, so the two are never confused in a log or a cron file
 *   - scoped to exactly one route (GET /api/backup/download) — an API key
 *     reaches the whole LLM surface, which is far too much for a mirror
 *   - the machine id is embedded, so a leaked token says which machine it
 *     belongs to
 *   - the CRC makes the token self-validating: a typo is rejected without a
 *     database lookup
 *
 * Format: bk-{machineId16}-{keyId6}-{crc8}
 *
 * The CRC is an HMAC over the machine id and the key id, keyed with a secret
 * that never leaves the server — the same shape as the API key format
 * (sk-{machineId}-{keyId}-{crc8}) so the two read the same way.
 */

const BACKUP_TOKEN_SECRET = process.env.BACKUP_TOKEN_SECRET || "panrouter-backup-token-secret";

const PREFIX = "bk";
const KEY_ID_LEN = 6;
const CRC_LEN = 8;

function generateKeyId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < KEY_ID_LEN; i += 1) {
    out += chars.charAt(crypto.randomInt(chars.length));
  }
  return out;
}

function generateCrc(machineId, keyId) {
  return crypto
    .createHmac("sha256", BACKUP_TOKEN_SECRET)
    .update(String(machineId) + String(keyId))
    .digest("hex")
    .slice(0, CRC_LEN);
}

/**
 * Create a backup token for a machine.
 *
 * @param {string} machineId - the machine that will use the token
 * @returns {{ token: string, keyId: string, machineId: string }}
 */
export function generateBackupToken(machineId) {
  if (!machineId) throw new Error("machineId is required");
  const keyId = generateKeyId();
  const crc = generateCrc(machineId, keyId);
  return { token: `${PREFIX}-${machineId}-${keyId}-${crc}`, keyId, machineId };
}

/**
 * Parse a backup token and check its CRC.
 *
 * @param {string} token
 * @returns {{ machineId: string, keyId: string, crc: string, valid: boolean }|null}
 *   null when the token does not even have the right shape.
 */
export function parseBackupToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split("-");
  if (parts.length !== 4) return null;
  const [prefix, machineId, keyId, crc] = parts;
  if (prefix !== PREFIX) return null;
  if (!machineId || !keyId || !crc) return null;
  const expected = generateCrc(machineId, keyId);
  return { machineId, keyId, crc, valid: crc === expected };
}

/**
 * Check a token without a database round-trip.
 *
 * @param {string} token
 * @returns {boolean}
 */
export function verifyBackupTokenCrc(token) {
  const parsed = parseBackupToken(token);
  return parsed?.valid === true;
}

/**
 * The key id of a token, used to look the stored record up and to revoke it.
 * @param {string} token
 * @returns {string|null}
 */
export function backupTokenKeyId(token) {
  return parseBackupToken(token)?.keyId || null;
}
