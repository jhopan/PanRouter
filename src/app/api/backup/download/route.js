// GET /api/backup/download
//
// Serves the database file to a trusted machine (the Debian box) that mirrors
// the backup off the VPS.
//
// Why a dedicated token instead of the dashboard password: the Debian box runs
// unattended, so it needs a credential it can hold without a human present, and
// it must not be able to reach anything else on this server. The token is
// scoped to exactly one route and compared in constant time.
//
// The token is stored next to the backup configuration (dbBackup.downloadToken)
// and is never returned by the settings GET.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getSettings } from "@/lib/localDb";
import { DATA_DIR } from "@/lib/dataDir";

const DB_FILE = path.join(DATA_DIR, "db", "data.sqlite");

/** Constant-time compare so the token cannot be guessed by timing. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request) {
  try {
    const settings = await getSettings();
    const expected = settings.dbBackup?.downloadToken || "";
    if (!expected) {
      return NextResponse.json({ error: "The download endpoint is not configured" }, { status: 404 });
    }

    const provided =
      request.headers.get("x-backup-token") ||
      new URL(request.url).searchParams.get("token") ||
      "";
    if (!safeEqual(provided, expected)) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

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
