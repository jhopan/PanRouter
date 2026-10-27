/**
 * Qoder UMID (Unique Machine ID) and machine fingerprint.
 *
 * The official CLI sends a UMID-derived fingerprint, captured live from
 * qodercli 1.1.78:
 *
 *   Cosy-MachineType    : 49690fcd144a6fa707   (16 bytes, lowercase hex)
 *   Cosy-MachineToken   : P1gAJ9hqcN-8rWt4TeID... (64 chars, base64url)
 *   Cosy-MachineId      : 4d5f5c6d-7b19-4fd4-a5c1-ef4bff6fa9f6 (UUID v4)
 *   Cosy-MachineHostname: LAPTOP-3FBHMC46
 *   Cosy-MachineOS      : x86_64_win32
 *
 * The UMID itself comes from Qoder's own hardware-fingerprint service
 * (~/.qoder/umid-cache.json). A headless server has no such service, so the
 * values are derived locally — but with the SAME SHAPE, because the gateway
 * validates the format rather than re-deriving the hardware:
 *
 *   machineType  : 16 bytes hex, stable per machine
 *   machineToken : 64 chars base64url, stable per machine
 *   machineId    : UUID v4, stable per machine
 *   hostname     : the real host name
 *   os           : <arch>_<os>, e.g. x86_64_linux
 *
 * "Stable per machine" matters: the CLI sends the same values on every
 * request, so a value that changes per request is itself a signal.
 *
 * The values are persisted next to the other Qoder state so a restart does not
 * look like a new machine.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

/** Where the fingerprint is persisted (same family as the CLI's .qoder dir). */
function fingerprintDir() {
  const home = os.homedir();
  const win = process.platform === "win32";
  const dir = win
    ? path.join(home, "AppData", "Roaming", "9router", "qoder")
    : path.join(home, ".9router", "qoder");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
  return dir;
}

function fingerprintFile() {
  return path.join(fingerprintDir(), "fingerprint.json");
}

function readPersisted() {
  try {
    const raw = fs.readFileSync(fingerprintFile(), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* no file yet */ }
  return null;
}

function writePersisted(value) {
  try {
    fs.writeFileSync(fingerprintFile(), JSON.stringify(value, null, 2), "utf-8");
  } catch { /* best effort */ }
}

let cached = null;

/**
 * The machine fingerprint, stable across restarts.
 * @returns {{machineId: string, machineType: string, machineToken: string, hostname: string, os: string}}
 */
export function getQoderFingerprint() {
  if (cached) return cached;

  const persisted = readPersisted();
  if (persisted?.machineId && persisted?.machineType && persisted?.machineToken) {
    cached = {
      machineId: persisted.machineId,
      machineType: persisted.machineType,
      machineToken: persisted.machineToken,
      hostname: persisted.hostname || os.hostname(),
      os: persisted.os || formatMachineOs(),
    };
    return cached;
  }

  const machineId = crypto.randomUUID();
  // 16 bytes hex, like the CLI's UMID.
  const machineType = crypto.randomBytes(16).toString("hex");
  // 64 chars base64url, like the CLI's machine token.
  const machineToken = crypto.randomBytes(48).toString("base64url");

  cached = {
    machineId,
    machineType,
    machineToken,
    hostname: os.hostname(),
    os: formatMachineOs(),
  };
  writePersisted(cached);
  return cached;
}

/**
 * The CLI's OS string: <arch>_<os>, e.g. "x86_64_win32" / "x86_64_linux".
 * The previous value ("x86_64_windows") does not match any CLI build.
 */
export function formatMachineOs() {
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
  const osName = process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : process.platform === "linux"
        ? "linux"
        : process.platform;
  return `${arch}_${osName}`;
}

/** A W3C-style traceparent, like the CLI sends on every request. */
export function buildTraceparent() {
  const traceId = crypto.randomBytes(16).toString("hex");
  const spanId = crypto.randomBytes(8).toString("hex");
  return `00-${traceId}-${spanId}-01`;
}
