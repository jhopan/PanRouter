import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { generateBackupToken, parseBackupToken } from "@/shared/utils/backupToken";

/**
 * Backup download tokens.
 *
 * The full token is never stored. Only the key id, the machine id and the CRC
 * are kept, so a database dump (which is exactly what the backup feature
 * copies around) does not hand out mirror access. The CRC is an HMAC over the
 * machine id and the key id, so the full token can be reconstructed from the
 * stored parts and checked against the presented one.
 */

function rowToToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    keyId: row.keyId,
    name: row.name,
    machineId: row.machineId,
    crc: row.crc,
    isActive: row.isActive === 1 || row.isActive === true,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

export async function getBackupTokens() {
  const db = await getAdapter();
  return db.all("SELECT * FROM backupTokens ORDER BY createdAt ASC").map(rowToToken);
}

export async function getBackupTokenByKeyId(keyId) {
  if (!keyId) return null;
  const db = await getAdapter();
  return rowToToken(db.get("SELECT * FROM backupTokens WHERE keyId = ?", [keyId]));
}

/**
 * Create a token. The full token is returned once and never again — the
 * stored record only holds the parts needed to verify it.
 *
 * @param {string} name - a label for the operator ("debian-mirror")
 * @param {string} machineId - the machine that will use it
 */
export async function createBackupToken(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { token, keyId } = generateBackupToken(machineId);
  const parsed = parseBackupToken(token);
  const record = {
    id: uuidv4(),
    keyId,
    name: name || "backup mirror",
    machineId,
    crc: parsed?.crc || "",
    isActive: true,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.run(
    "INSERT INTO backupTokens(id, keyId, name, machineId, crc, isActive, lastUsedAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
    [record.id, record.keyId, record.name, record.machineId, record.crc, 1, null, record.createdAt],
  );
  return { ...record, token };
}

/** Deactivate a token without deleting its history. */
export async function revokeBackupToken(id) {
  const db = await getAdapter();
  const res = db.run("UPDATE backupTokens SET isActive = 0 WHERE id = ?", [id]);
  return (res?.changes ?? 0) > 0;
}

/** Re-enable a revoked token. */
export async function enableBackupToken(id) {
  const db = await getAdapter();
  const res = db.run("UPDATE backupTokens SET isActive = 1 WHERE id = ?", [id]);
  return (res?.changes ?? 0) > 0;
}

/** Remove a token entirely. */
export async function deleteBackupToken(id) {
  const db = await getAdapter();
  const res = db.run("DELETE FROM backupTokens WHERE id = ?", [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Check a presented token.
 *
 * The CRC is verified first — a typo or a mangled token is rejected without
 * touching the database. Only then is the key id looked up, and the record
 * must exist and be active.
 *
 * @param {string} token
 * @returns {Promise<{ ok: boolean, reason?: string, record?: object }>}
 */
export async function verifyBackupToken(token) {
  const parsed = parseBackupToken(token);
  if (!parsed) return { ok: false, reason: "Malformed token" };
  if (!parsed.valid) return { ok: false, reason: "Invalid token" };

  const record = await getBackupTokenByKeyId(parsed.keyId);
  if (!record) return { ok: false, reason: "Unknown token" };
  if (!record.isActive) return { ok: false, reason: "Token has been revoked" };
  if (record.crc !== parsed.crc) return { ok: false, reason: "Invalid token" };

  return { ok: true, record };
}

/** Note that a token was used, so the dashboard can show activity. */
export async function touchBackupToken(keyId) {
  if (!keyId) return;
  const db = await getAdapter();
  db.run("UPDATE backupTokens SET lastUsedAt = ? WHERE keyId = ?", [new Date().toISOString(), keyId]);
}
