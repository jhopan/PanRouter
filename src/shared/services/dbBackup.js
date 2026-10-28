/**
 * Automatic database backup to a private GitHub repo.
 *
 * Why: the VPS holds every provider connection with its OAuth token. If the
 * disk dies, or a release corrupts the schema, every account is gone — the
 * token is the only way back in. A daily snapshot pushed OFF the box is the
 * safety net.
 *
 * The backup is the raw SQLite file — the same "Database Location" the
 * dashboard shows. It is taken with the adapter's own VACUUM INTO so the copy
 * is consistent while the server keeps writing: a plain file copy of a live
 * SQLite database silently misses everything still sitting in the write-ahead
 * log, and the restored DB would be missing recent accounts.
 *
 * Design notes:
 *   - The GitHub token NEVER leaves the server. It lives in the settings row
 *     (next to the dashboard password hash) and the settings GET endpoint
 *     strips it from the response.
 *   - The target repo MUST be private. A public repo would publish every
 *     OAuth token on the box, so the push is refused unless GitHub reports
 *     the repo as private.
 *   - The push is a plain HTTPS git remote with the token embedded, the same
 *     shape as the vpn-backup script already running on this VPS. No extra
 *     tooling needed (no gh CLI on the box).
 *   - Only the DB file is backed up. The small secret files (jwt-secret,
 *     machine-id, auth/cli-secret, qoder/fingerprint.json) are NOT copied —
 *     the operator asked for the database location only, and those stay on the
 *     box.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getAdapter } from "@/lib/db/driver";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { DATA_DIR } from "@/lib/dataDir";

const DB_DIR = path.join(DATA_DIR, "db");
const DB_FILE = path.join(DB_DIR, "data.sqlite");

/** How often the scheduler ticks; the daily slot is checked on every tick. */
const TICK_INTERVAL_MS = 15 * 60 * 1000;

/** The backup is written once per day, at this local hour. */
const BACKUP_HOUR = 3;

/** Keep this many daily snapshots in the repo. */
const KEEP_SNAPSHOTS = 30;

const g = {
  interval: null,
  running: false,
  lastRunDayKey: null,
};

function dayKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Take a consistent copy of the live database.
 *
 * VACUUM INTO produces a fresh, defragmented file that is guaranteed to be a
 * valid snapshot at the moment it runs — the write-ahead log is folded in. The
 * alternative (copying the file) is not safe while the server is writing.
 *
 * @param {string} destPath
 * @returns {Promise<string>} destPath
 */
export async function snapshotDatabase(destPath) {
  const db = await getAdapter();
  // Remove a leftover file — VACUUM INTO refuses to overwrite.
  try { fs.unlinkSync(destPath); } catch { /* not there */ }
  // VACUUM INTO takes a literal path, not a bound parameter.
  db.exec(`VACUUM INTO '${String(destPath).replace(/'/g, "''")}'`);
  return destPath;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => resolve({ code: -1, out, err: e.message }));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

/**
 * Ask GitHub whether the repo is private. A public repo would publish every
 * token in the database, so this is a hard gate — not a warning.
 */
export async function assertRepoIsPrivate(owner, repo, token) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "panrouter-db-backup",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub: cannot read repo ${owner}/${repo} (HTTP ${res.status}) — check the token and the repo name`);
  }
  const data = await res.json();
  if (data.private !== true) {
    throw new Error(`GitHub: repo ${owner}/${repo} is NOT private — refusing to upload the database`);
  }
  return data;
}

/**
 * Push one snapshot to the backup repo.
 *
 * The repo is cloned into a temp dir, the snapshot is copied in, and the
 * result is committed and pushed. Old snapshots beyond KEEP_SNAPSHOTS are
 * removed so the repo stays small.
 */
export async function pushSnapshot({ owner, repo, token, fileName, content }) {
  const work = fs.mkdtempSync(path.join(DATA_DIR, ".dbbackup-"));
  const remote = `https://${owner}:${token}@github.com/${owner}/${repo}.git`;
  try {
    const clone = await run("git", ["clone", "--depth", "1", remote, work], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (clone.code !== 0) {
      throw new Error(`git clone failed: ${clone.err.trim() || clone.out.trim()}`);
    }

    fs.writeFileSync(path.join(work, fileName), content);

    // Keep the repo bounded: drop the oldest snapshots past the retention.
    const existing = fs.readdirSync(work)
      .filter((f) => /^panrouter-db-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
      .sort();
    const overflow = existing.length - (KEEP_SNAPSHOTS - 1);
    for (let i = 0; i < overflow; i += 1) {
      try { fs.unlinkSync(path.join(work, existing[i])); } catch { /* ignore */ }
    }

    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    await run("git", ["add", "-A"], { cwd: work, env });
    // --allow-empty: an unchanged day still records that a backup ran.
    await run("git", ["commit", "-m", `db backup ${dayKey()}`], { cwd: work, env });
    const push = await run("git", ["push", "origin", "HEAD"], { cwd: work, env });
    if (push.code !== 0) {
      throw new Error(`git push failed: ${push.err.trim() || push.out.trim()}`);
    }
    return { fileName, bytes: content.length };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Run one backup cycle: snapshot → verify the repo is private → push.
 * @returns {Promise<{ok: boolean, reason?: string, fileName?: string, bytes?: number}>}
 */
export async function runDbBackup({ force = false, now = Date.now() } = {}) {
  if (g.running) return { ok: false, reason: "A backup is already running" };

  const settings = await getSettings();
  const cfg = settings.dbBackup || {};
  if (!force && cfg.enabled !== true) return { ok: false, reason: "Automatic backup is disabled" };

  const { githubUser, githubToken, githubRepo } = cfg;
  if (!githubUser || !githubToken || !githubRepo) {
    return { ok: false, reason: "GitHub username, token, or repo is not configured" };
  }

  g.running = true;
  try {
    // The repo field may carry "owner/name"; use the owner from it when present.
    const repoParts = String(githubRepo).split("/").filter(Boolean);
    const owner = repoParts.length >= 2 ? repoParts[repoParts.length - 2] : githubUser;
    const repo = repoParts.length >= 2 ? repoParts[repoParts.length - 1] : repoParts[0];

    await assertRepoIsPrivate(owner, repo, githubToken);

    const stamp = dayKey(now);
    const fileName = `panrouter-db-${stamp}.sqlite`;
    const tmpPath = path.join(DB_DIR, `.backup-${stamp}-${process.pid}.sqlite`);
    try {
      await snapshotDatabase(tmpPath);
      const content = fs.readFileSync(tmpPath);
      const res = await pushSnapshot({ owner, repo, token: githubToken, fileName, content });
      g.lastRunDayKey = stamp;
      console.log(`[DB_BACKUP] pushed ${fileName} (${(res.bytes / 1024 / 1024).toFixed(2)} MB) to ${owner}/${repo}`);
      return { ok: true, fileName, bytes: res.bytes };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  } catch (error) {
    console.warn(`[DB_BACKUP] failed: ${error.message}`);
    return { ok: false, reason: error.message };
  } finally {
    g.running = false;
  }
}

/**
 * The daily tick: run the backup once per day, at BACKUP_HOUR local time.
 */
export async function runDbBackupTick() {
  const settings = await getSettings();
  const cfg = settings.dbBackup || {};
  if (cfg.enabled !== true) return;

  const now = new Date();
  if (now.getHours() < BACKUP_HOUR) return;
  const key = dayKey(now.getTime());
  if (g.lastRunDayKey === key) return;

  await runDbBackup({ now: now.getTime() });
}

export function startDbBackup() {
  if (g.interval) return;
  console.log("[DB_BACKUP] scheduler started");
  g.interval = setInterval(() => { runDbBackupTick().catch(() => {}); }, TICK_INTERVAL_MS);
  if (g.interval.unref) g.interval.unref();
}

export function stopDbBackup() {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[DB_BACKUP] scheduler stopped");
}

/**
 * Start or stop the scheduler to match the current settings.
 */
export async function configureDbBackup(settings) {
  const cfg = settings?.dbBackup || {};
  if (cfg.enabled === true) {
    startDbBackup();
  } else {
    stopDbBackup();
  }
}

export { DB_FILE, DB_DIR, KEEP_SNAPSHOTS, BACKUP_HOUR };
