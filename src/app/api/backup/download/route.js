// GET /api/backup/download
//
// Serves the database file to a trusted machine (the Debian box) that mirrors
// the backup off the VPS.
//
// Why a dedicated token instead of the dashboard password: the Debian box runs
// unattended, so it needs a credential it can hold without a human present, and
// it must not be able to reach anything else on this server. A backup token
// (bk-...) is scoped to exactly this route — an API key (sk-...) would reach
// the whole LLM surface, which is far too much for a mirror.
//
// The token is checked against the stored records, so it can be revoked or
// deleted from the dashboard without touching the file on the machine.
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { verifyBackupToken, touchBackupToken } from "@/lib/db/repos/backupTokensRepo";
import { DATA_DIR } from "@/lib/dataDir";

const DB_FILE = path.join(DATA_DIR, "db", "data.sqlite");

export async function GET(request) {
  try {
    const provided =
      request.headers.get("x-backup-token") ||
      new URL(request.url).searchParams.get("token") ||
      "";

    const verdict = await verifyBackupToken(provided);
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.reason || "Invalid token" }, { status: 401 });
    }
    // Best effort — a failed touch must not break the download.
    try { await touchBackupToken(verdict.record.keyId); } catch { /* advisory */ }

    if (!fs.existsSync(DB_FILE)) {
      return NextResponse.json({ error: "Database file not found" }, { status: 404 });
    }

    const stat = fs.statSync(DB_FILE);
    const content = fs.readFileSync(DB_FILE);

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="data.sqlite"`,
        "Cache-Control": "no-store",
        // Never let a proxy keep a copy of the database.
        "Pragma": "no-cache",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
