/**
 * password.js — lightweight sudo/encrypted-password helpers.
 * Extracted from src/mitm/manager.js (MITM removed in v0.5.75.29).
 * Used by: tailscale manager (sudo daemon start), tailscale-check/install routes.
 * No MITM dependencies.
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";

const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "9router-mitm-pwd"; // kept identical so existing stored passwords still decrypt

function deriveKey() {
  try {
    const require = createRequire(import.meta.url);
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + ENCRYPT_SALT).digest();
  } catch {
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

export function encryptPassword(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptPassword(stored) {
  try {
    const [ivHex, tagHex, dataHex] = stored.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
  } catch {
    return null;
  }
}

// In-process cache (same global trick as mitm/manager so tailscale still gets the password)
export function getCachedPassword() { return globalThis.__mitmSudoPassword || null; }
export function setCachedPassword(pwd) { globalThis.__mitmSudoPassword = pwd; }

let _getSettings = null;
let _updateSettings = null;

/** Wire up DB accessors (called once at module init by each consumer). */
export function initDbHooks(getSettingsFn, updateSettingsFn) {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

export async function loadEncryptedPassword() {
  if (!_getSettings) return null;
  try {
    const settings = await _getSettings();
    if (!settings.mitmSudoEncrypted) return null;
    return decryptPassword(settings.mitmSudoEncrypted);
  } catch {
    return null;
  }
}
