// POST /api/backup/run
//
// Run one backup immediately, ignoring the daily schedule. Used by the
// dashboard's "Back up now" button so the operator can verify the setup works
// without waiting for the night.
import { NextResponse } from "next/server";

import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { runDbBackup } from "@/shared/services/dbBackup";

const CLI_TOKEN_HEADER = "x-9r-cli-token";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function POST(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get("x-9r-password")))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const result = await runDbBackup({ force: true });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason || "The backup failed" }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      fileName: result.fileName,
      bytes: result.bytes,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
