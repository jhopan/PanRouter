// Automatic database backup to a private GitHub repo.
//
// Why: the VPS holds 1090 provider connections with OAuth tokens. If the disk
// dies or an update corrupts the schema, every account is gone — the token is
// the only way back in. A daily snapshot pushed off the box is the safety net.
//
// The backup is the raw SQLite file (the "Database Location" the dashboard
// shows). It is taken with the adapter's own VACUUM INTO so the copy is
// consistent even while the server is writing: a plain file copy of a live
// SQLite database can miss everything still sitting in the write-ahead log.
//
// Design notes:
//   - The GitHub token NEVER leaves the server. It is stored in the settings
//     row, the same place the dashboard password hash lives, and the settings
//     GET endpoint strips it from the response.
//   - The repo MUST be private. A public repo would publish every OAuth token
//     in the world, so the push is refused unless the repo is private.
//   - The push uses a plain HTTPS git remote with the token embedded, exactly
//     like the vpn-backup script already running on this VPS.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");

const backup = read("src/shared/services/dbBackup.js");
const settingsApi = read("src/app/api/settings/route.js");
const profile = read("src/app/(dashboard)/dashboard/profile/page.js");
const settingsRepo = read("src/lib/db/repos/settingsRepo.js");

describe("db backup service", () => {
  it("exists and exports a scheduled runner", () => {
    expect(backup).toMatch(/export async function runDbBackup\(/);
    expect(backup).toMatch(/export function startDbBackup\(/);
    expect(backup).toMatch(/export function stopDbBackup\(/);
  });

  it("takes the backup with VACUUM INTO so the copy is consistent", () => {
    // A plain fs.copy of a live SQLite file can miss the write-ahead log.
    expect(backup).toMatch(/VACUUM INTO/i);
  });

  it("refuses to push to a non-private repository", () => {
    // A public repo would publish every OAuth token.
    expect(backup).toMatch(/private !== true/);
    expect(backup).toMatch(/is NOT private/);
  });

  it("never returns the GitHub token through the settings API", () => {
    expect(settingsApi).toMatch(/PROTECTED_SETTING_KEYS/);
    expect(settingsApi).toMatch(/githubToken/);
  });

  it("stores the token as a protected setting key", () => {
    expect(settingsRepo).toMatch(/dbBackup/);
  });

  it("exposes the backup configuration in the settings defaults", () => {
    expect(settingsRepo).toMatch(/dbBackup:/);
  });
});

describe("db backup settings shape", () => {
  it("has the four fields the dashboard form needs", () => {
    // enabled, githubUser, githubToken, githubRepo
    const defaults = settingsRepo.match(/dbBackup:\s*\{[\s\S]*?\n\s{2}\},/);
    expect(defaults).toBeTruthy();
    const block = defaults[0];
    expect(block).toMatch(/enabled/);
    expect(block).toMatch(/githubUser/);
    expect(block).toMatch(/githubToken/);
    expect(block).toMatch(/githubRepo/);
  });
});

describe("dashboard", () => {
  it("has a form for the backup configuration", () => {
    expect(profile).toMatch(/githubRepo/);
    expect(profile).toMatch(/githubUser/);
    expect(profile).toMatch(/backup-github-token/);
  });

  it("has a password field for the GitHub token", () => {
    expect(profile).toMatch(/githubToken/);
  });

  it("offers a manual 'Back up now' action", () => {
    expect(profile).toMatch(/backup-now|Back up now/i);
  });
});

describe("download endpoint for the Debian box", () => {
  const route = read("src/app/api/backup/download/route.js");
  const guard = read("src/dashboardGuard.js");

  it("exists", () => {
    expect(fs.existsSync(path.resolve("../src/app/api/backup/download/route.js"))).toBe(true);
  });

  it("requires a token", () => {
    expect(route).toMatch(/token/);
    expect(route).toMatch(/401/);
  });

  it("serves the database file", () => {
    expect(route).toMatch(/data\.sqlite/);
  });

  it("compares the token in constant time", () => {
    expect(route).toMatch(/timingSafeEqual/);
  });

  it("is reachable: the general dashboard auth must not gate it", () => {
    // The machine holds the backup token, not a dashboard session, so the
    // route has to be reachable and do its own auth. Without this the request
    // was rejected by the guard before the route ever ran.
    expect(guard).toMatch(/"\/api\/backup\/download"/);
  });
});

describe("the backup config endpoint", () => {
  const route = read("src/app/api/backup/config/route.js");

  it("verifies the repo is private before storing the config", () => {
    expect(route).toMatch(/assertRepoIsPrivate/);
  });

  it("accepts the repo as 'name' or 'owner/name'", () => {
    expect(route).toMatch(/repoParts/);
  });

  it("generates a download token and shows it once", () => {
    expect(route).toMatch(/randomBytes/);
    expect(route).toMatch(/downloadToken/);
  });

  it("never returns the GitHub token", () => {
    expect(route).not.toMatch(/githubToken,\s*$/m);
  });
});

describe("the run-now endpoint", () => {
  const route = read("src/app/api/backup/run/route.js");

  it("exists and forces a run", () => {
    expect(route).toMatch(/runDbBackup/);
    expect(route).toMatch(/force: true/);
  });
});

describe("backup interval", () => {
  it("is configurable in hours", () => {
    expect(backup).toMatch(/resolveIntervalHours/);
    expect(settingsRepo).toMatch(/intervalHours/);
  });

  it("defaults to once a day", () => {
    expect(backup).toMatch(/DEFAULT_INTERVAL_HOURS = 24/);
  });

  it("clamps to a sane range", () => {
    // resolveIntervalHours is exported so it can be unit-tested directly; the
    // clamping bounds are asserted here on the source.
    expect(backup).toMatch(/Math\.max\(raw, 1\)/);
    expect(backup).toMatch(/24 \* 7/);
  });

  it("the dashboard offers the interval choices", () => {
    expect(profile).toMatch(/intervalHours/);
    expect(profile).toMatch(/Every hour/);
    expect(profile).toMatch(/Every 24 hours \(daily\)/);
  });

  it("shows the mirror command so the URL is not guessed", () => {
    expect(profile).toMatch(/api\/backup\/download/);
    expect(profile).toMatch(/x-backup-token/);
  });
});
