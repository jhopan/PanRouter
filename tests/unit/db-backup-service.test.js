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

describe("parseRepoRef", () => {
  it("parses a full https URL", async () => {
    const { parseRepoRef } = await import("../../src/shared/services/dbBackup.js");
    expect(parseRepoRef("https://github.com/jhopan12/AutoBuy.git")).toEqual({
      owner: "jhopan12",
      repo: "AutoBuy",
    });
  });

  it("parses an https URL without the .git suffix", async () => {
    const { parseRepoRef } = await import("../../src/shared/services/dbBackup.js");
    expect(parseRepoRef("https://github.com/jhopan12/AutoBuy")).toEqual({
      owner: "jhopan12",
      repo: "AutoBuy",
    });
  });

  it("parses an ssh remote", async () => {
    const { parseRepoRef } = await import("../../src/shared/services/dbBackup.js");
    expect(parseRepoRef("git@github.com:jhopan12/AutoBuy.git")).toEqual({
      owner: "jhopan12",
      repo: "AutoBuy",
    });
  });

  it("parses a bare host path", async () => {
    const { parseRepoRef } = await import("../../src/shared/services/dbBackup.js");
    expect(parseRepoRef("github.com/jhopan12/AutoBuy")).toEqual({
      owner: "jhopan12",
      repo: "AutoBuy",
    });
  });

  it("parses owner/repo", async () => {
    const { parseRepoRef } = await import("../../src/shared/services/dbBackup.js");
    expect(parseRepoRef("jhopan12/AutoBuy")).toEqual({
      owner: "jhopan12",
      repo: "AutoBuy",
    });
  });

  it("takes the owner from the username field when only a repo name is given", async () => {
    const { parseRepoRef } = await import("../../src/shared/services/dbBackup.js");
    expect(parseRepoRef("AutoBuy", "jhopan12")).toEqual({
      owner: "jhopan12",
      repo: "AutoBuy",
    });
  });

  it("returns null when there is nothing to parse", async () => {
    const { parseRepoRef } = await import("../../src/shared/services/dbBackup.js");
    expect(parseRepoRef("")).toBeNull();
    expect(parseRepoRef("   ")).toBeNull();
    expect(parseRepoRef("AutoBuy")).toBeNull();
  });

  it("ignores a trailing slash and a trailing .git", async () => {
    const { parseRepoRef } = await import("../../src/shared/services/dbBackup.js");
    expect(parseRepoRef("https://github.com/jhopan12/AutoBuy/")).toEqual({
      owner: "jhopan12",
      repo: "AutoBuy",
    });
  });
});

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

  it("verifies the token through the token repo", () => {
    expect(route).toMatch(/verifyBackupToken/);
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

  it("accepts the repository as a URL, 'owner/name' or a bare name", () => {
    expect(route).toMatch(/parseRepoRef/);
  });

  it("no longer mints a download token", () => {
    // Download tokens moved to their own table and endpoint.
    expect(route).not.toMatch(/randomBytes/);
  });

  it("never returns the GitHub token in the response", () => {
    // The POST response reports only whether a token is configured.
    const responseBlock = route.slice(route.indexOf("success: true"));
    expect(responseBlock).not.toMatch(/githubToken,/);
    expect(responseBlock).toMatch(/githubTokenConfigured: true/);
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

  it("does not tell the mirror to use GitHub or SSH", () => {
    // The mirror pulls straight from this server with its backup token. The
    // GitHub copy is pushed by the server itself, so git and SSH on the
    // mirror machine are irrelevant — mentioning them only confused things.
    expect(profile).not.toMatch(/gitSetup/);
    expect(profile).not.toMatch(/ssh-keygen/);
    expect(profile).not.toMatch(/git remote add origin/);
  });

  it("never hardcodes a repository as the backup target", () => {
    // A repository URL in the source must only ever be an example in a
    // placeholder, never a default the backup would actually push to.
    // (An earlier revision pushed a real snapshot to whatever URL was used as
    // the example. The example has to stay an example.)
    const codePaths = [
      "src/shared/services/dbBackup.js",
      "src/app/api/backup/config/route.js",
      "src/app/(dashboard)/dashboard/profile/page.js",
    ];
    for (const rel of codePaths) {
      const src = read(rel);
      const urls = src.match(/https:\/\/github\.com\/[^\s"'`]+/g) || [];
      for (const url of urls) {
        // A URL in a placeholder attribute or a comment is fine; one that
        // feeds the remote or the settings default is not.
        const line = src.split("\n").find((l) => l.includes(url)) || "";
        expect(line).toMatch(/placeholder|\/\/|\*|https:\/\/github\.com\/\$\{/);
      }
    }
  });

  it("accepts a pasted repository URL in the repository field", () => {
    expect(profile).toMatch(/https:\/\/github\.com\/jhopan12\/AutoBuy\.git/);
    expect(profile).toMatch(/githubRepoUrl/);
  });

  it("says the mirror never touches GitHub", () => {
    expect(profile).toMatch(/never touches GitHub|pulls straight from this server/);
  });
});

describe("the mirror command must not break hydration", () => {
  it("takes the origin from state, not from window during render", () => {
    // window.location is empty during the server render, so using it directly
    // in the markup makes the first client render differ from the server HTML
    // and React throws a hydration mismatch (the whole tree is regenerated).
    expect(profile).toMatch(/pageOrigin/);
    expect(profile).toMatch(/useState\(""\)/);
  });

  it("fills the origin after mount", () => {
    expect(profile).toMatch(/setPageOrigin\(window\.location\.origin\)/);
  });

  it("the rendered command uses the state, not the raw origin", () => {
    // The `origin` variable (used for the OIDC/SAML redirect) is still read
    // from window during render — that is pre-existing and not part of this
    // panel, so the command must use the state instead.
    expect(profile).toMatch(/\$\{pageOrigin\}\/api\/backup\/download/);
  });
});

describe("backup download tokens", () => {
  const tokenUtil = read("src/shared/utils/backupToken.js");
  const repo = read("src/lib/db/repos/backupTokensRepo.js");
  const tokensRoute = read("src/app/api/backup/tokens/route.js");
  const schema = read("src/lib/db/schema.js");

  it("has its own prefix, distinct from an API key", () => {
    expect(tokenUtil).toMatch(/const PREFIX = "bk"/);
    expect(tokenUtil).toMatch(/sk-/);
  });

  it("uses the same shape as an API key: machine id, key id, crc", () => {
    // bk-{machineId16}-{keyId6}-{crc8}
    expect(tokenUtil).toMatch(/KEY_ID_LEN = 6/);
    expect(tokenUtil).toMatch(/CRC_LEN = 8/);
    expect(tokenUtil).toMatch(/createHmac/);
  });

  it("never stores the full token", () => {
    // Only the key id, the machine id and the crc are kept, so a database
    // dump does not hand out mirror access.
    expect(repo).toMatch(/crc/);
    expect(repo).toMatch(/keyId/);
  });

  it("has a table for them", () => {
    expect(schema).toMatch(/backupTokens/);
  });

  it("can be listed, created, revoked and deleted", () => {
    expect(tokensRoute).toMatch(/export async function GET/);
    expect(tokensRoute).toMatch(/export async function POST/);
    expect(tokensRoute).toMatch(/export async function PATCH/);
    expect(tokensRoute).toMatch(/export async function DELETE/);
    expect(repo).toMatch(/revokeBackupToken/);
    expect(repo).toMatch(/deleteBackupToken/);
  });

  it("the download route rejects a revoked token", () => {
    expect(repo).toMatch(/revoked/);
  });
});

describe("the command blocks are copyable, not literal \\n text", () => {
  const copyable = read("src/app/(dashboard)/dashboard/profile/components/CopyableCode.js");

  it("renders the command in a pre block so the newlines show", () => {
    expect(copyable).toMatch(/<pre/);
    expect(copyable).toMatch(/whitespace-pre-wrap/);
  });

  it("copies the same text it renders", () => {
    expect(copyable).toMatch(/writeText\(code\)/);
  });

  it("has a copy button", () => {
    expect(copyable).toMatch(/aria-label="Copy to clipboard"/);
    expect(copyable).toMatch(/content_copy/);
  });

  it("the command strings are joined with a real newline", () => {
    // The bug was a join on the two characters backslash + n, which the
    // browser showed literally instead of a line break.
    expect(profile).toContain('.join("\\n")');
    expect(profile).not.toContain('.join(" \\n")');
  });

  it("the shell line continuation survives as a backslash", () => {
    // A trailing backslash on a shell line is a continuation, so the script
    // must not lose it to JS escaping.
    expect(profile).toMatch(/SHELL_CONT/);
  });

  it("uses the copyable component for every command block", () => {
    expect(profile).toMatch(/CopyableCode/);
  });
});
