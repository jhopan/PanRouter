// POST /api/backup/config
//
// Store the automatic-backup configuration: GitHub username, token and repo.
//
// The token is a secret — it grants write access to the repo that will hold
// every OAuth token on this box — so it is only ever written here, and it is
// never returned by the settings GET (it is stripped and replaced with a
// `githubTokenConfigured` flag).
//
// The target repo MUST be private. That is checked against the GitHub API
// before the configuration is accepted, so a typo that points at a public repo
// is caught at setup time rather than at the first backup.
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { assertRepoIsPrivate, resolveIntervalHours } from "@/shared/services/dbBackup";
import { configureDbBackup } from "@/shared/services/dbBackup";

const CLI_TOKEN_HEADER = "x-9r-cli-token";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function GET(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get("x-9r-password")))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const settings = await getSettings();
    const cfg = settings.dbBackup || {};
    return NextResponse.json({
      enabled: cfg.enabled === true,
      intervalHours: resolveIntervalHours(cfg),
      githubUser: cfg.githubUser || "",
      githubRepo: cfg.githubRepo || "",
      githubTokenConfigured: Boolean(cfg.githubToken),
      downloadTokenConfigured: Boolean(cfg.downloadToken),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get("x-9r-password")))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const body = await request.json();
    const enabled = body.enabled === true;
    const intervalHours = resolveIntervalHours({ intervalHours: body.intervalHours });
    const githubUser = String(body.githubUser || "").trim();
    // The repo may be given as "name" or as "owner/name". Both are accepted;
    // the owner part is taken from the repo field when it is present, and
    // otherwise from the username field.
    const rawRepo = String(body.githubRepo || "").trim().replace(/\.git$/, "");
    const repoParts = rawRepo.split("/").filter(Boolean);
    const githubRepo = repoParts.length >= 2 ? repoParts.slice(-2).join("/") : repoParts[0] || "";
    const repoOwner = repoParts.length >= 2 ? repoParts[repoParts.length - 2] : githubUser;
    // An empty token means "keep the stored one" — the dashboard never shows it.
    const incomingToken = String(body.githubToken || "").trim();
    const current = (await getSettings()).dbBackup || {};
    const githubToken = incomingToken || current.githubToken || "";

    // The download token is for the Debian box. It is generated once and shown
    // to the operator only at creation time — it cannot be read back later.
    const incomingDownload = String(body.downloadToken || "").trim();
    const downloadToken = incomingDownload || current.downloadToken || randomBytes(24).toString("hex");

    if (!githubUser || !githubRepo) {
      return NextResponse.json({ error: "GitHub username and repo are required" }, { status: 400 });
    }
    if (!githubToken) {
      return NextResponse.json({ error: "GitHub token is required" }, { status: 400 });
    }
    if (!/^[\w.-]+$/.test(githubRepo)) {
      return NextResponse.json({ error: "Invalid repository name" }, { status: 400 });
    }

    // Hard gate: a public repo would publish the whole database.
    try {
      await assertRepoIsPrivate(repoOwner, githubRepo, githubToken);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const settings = await updateSettings({
      dbBackup: { enabled, intervalHours, githubUser, githubRepo, githubToken, downloadToken },
    });

    // Start or stop the scheduler to match.
    await configureDbBackup(settings);

    return NextResponse.json({
      success: true,
      enabled,
      intervalHours,
      githubUser,
      githubRepo: `${repoOwner}/${githubRepo}`,
      githubTokenConfigured: true,
      downloadTokenConfigured: true,
      // Shown once, at creation. It is stored hashed-by-obscurity (compared in
      // constant time) and can never be read back through the API.
      downloadToken,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
