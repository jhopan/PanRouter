/**
 * dnsExec.js — execWithPassword helper extracted from src/mitm/dns/dnsConfig.js.
 * Used by tailscale (sudo daemon start). No other MITM dependency.
 */

import { spawn } from "node:child_process";
import { execSync } from "node:child_process";

/** True when `sudo` exists (e.g. missing on minimal Docker images like Alpine). */
export function isSudoAvailable() {
  if (process.platform === "win32") return false;
  try {
    execSync("command -v sudo", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute command with sudo password via stdin (macOS/Linux only).
 * Without sudo in PATH (containers), runs via sh — same user, no elevation.
 */
export function execWithPassword(command, password) {
  return new Promise((resolve, reject) => {
    const useSudo = isSudoAvailable();
    const child = useSudo
      ? spawn("sudo", ["-S", "sh", "-c", command], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      : spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    if (useSudo) {
      child.stdin.write(`${password}\n`);
      child.stdin.end();
    }
  });
}
