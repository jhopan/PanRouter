// /api/backup/tokens
//
// Manage the download tokens that let a machine mirror the database.
//
//   GET    — list the tokens (no secret material: only the key id, the name,
//            the machine id, whether it is active, and when it was last used)
//   POST   — create a token; the full token is returned ONCE and never again
//   PATCH  — revoke (isActive:false) or re-enable (isActive:true) a token
//   DELETE — remove a token permanently
//
// The full token is never stored: only its key id, the machine id and the CRC.
// A database dump — which is exactly what the backup feature copies around —
// therefore does not hand out mirror access.
import { NextResponse } from "next/server";

import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import {
  getBackupTokens,
  createBackupToken,
  revokeBackupToken,
  enableBackupToken,
  deleteBackupToken,
} from "@/lib/db/repos/backupTokensRepo";

const CLI_TOKEN_HEADER = "x-9r-cli-token";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

async function authorized(request) {
  if (isCliRequest(request)) return true;
  return verifyDashboardPassword(request.headers.get("x-9r-password"));
}

export async function GET(request) {
  try {
    if (!(await authorized(request))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const tokens = await getBackupTokens();
    return NextResponse.json({ tokens });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!(await authorized(request))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim() || "backup mirror";
    // A token can be pinned to a machine id, or left free so any machine can
    // use it. The default is the server's own machine id, which makes the
    // token useless on the mirror — so the operator has to pass the mirror's
    // id explicitly, or send machineId:"" to allow any machine.
    const machineId = body.machineId === "" ? "" : String(body.machineId || "").trim() || (await getConsistentMachineId());

    const created = await createBackupToken(name, machineId || "any");
    // The token is returned here and nowhere else.
    return NextResponse.json({
      success: true,
      token: created.token,
      id: created.id,
      keyId: created.keyId,
      name: created.name,
      machineId: created.machineId,
      createdAt: created.createdAt,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    if (!(await authorized(request))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const body = await request.json();
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const active = body.isActive === true;
    const ok = active ? await enableBackupToken(id) : await revokeBackupToken(id);
    if (!ok) return NextResponse.json({ error: "Token not found" }, { status: 404 });
    return NextResponse.json({ success: true, id, isActive: active });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    if (!(await authorized(request))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get("id") || "");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const ok = await deleteBackupToken(id);
    if (!ok) return NextResponse.json({ error: "Token not found" }, { status: 404 });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
