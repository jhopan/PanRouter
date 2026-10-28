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

import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { assertRepoIsPrivate, parseRepoRef, resolveIntervalHours } from "@/shared/services/dbBackup";
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
    // Older configs stored "owner/name" in githubRepo; newer ones store the
    // bare name plus githubRepoOwner. Parse so both shapes report the owner.
    const ref = parseRepoRef(cfg.githubRepo || "", cfg.githubUser || "");
    const owner = cfg.githubRepoOwner || (ref ? ref.owner : "");
    const repo = cfg.githubRepoOwner ? cfg.githubRepo : (ref ? ref.repo : "");
    return NextResponse.json({
      enabled: cfg.enabled === true,
      intervalHours: resolveIntervalHours(cfg),
      githubUser: cfg.githubUser || "",
      githubRepo: repo,
      githubRepoOwner: owner,
      githubRepoUrl: owner && repo ? `https://github.com/${owner}/${repo}` : "",
      githubTokenConfigured: Boolean(cfg.githubToken),
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
    // The repository may be pasted as a full URL, an ssh remote, "owner/name"
    // or a bare repo name. All of them are accepted; the owner comes from the
    // URL when it carries one, otherwise from the username field.
    const rawRepo = String(body.githubRepo || "").trim();
    const ref = parseRepoRef(rawRepo, githubUser);
    const repoOwner = ref ? ref.owner : "";
    const githubRepo = ref ? ref.repo : "";
    // An empty token means "keep the stored one" — the dashboard never shows it.
    const incomingToken = String(body.githubToken || "").trim();
    const current = (await getSettings()).dbBackup || {};
    const githubToken = incomingToken || current.githubToken || "";

    if (!githubUser || !githubRepo) {
      return NextResponse.json({ error: "GitHub username and repository are required" }, { status: 400 });
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
      dbBackup: {
        enabled,
        intervalHours,
        githubUser,
        githubRepo,
        githubRepoOwner: repoOwner,
        githubToken,
      },
    });

    // Start or stop the scheduler to match.
    await configureDbBackup(settings);

    return NextResponse.json({
      success: true,
      enabled,
      intervalHours,
      githubUser,
      githubRepo,
      githubRepoOwner: repoOwner,
      githubTokenConfigured: true,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
