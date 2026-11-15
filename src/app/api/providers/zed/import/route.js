import { NextResponse } from "next/server";
import { ZED_KEYCHAIN_DOCKER_ERROR } from "@/lib/oauth/utils/zedCredentials";
import { isRunningInDocker } from "@/lib/oauth/utils/dockerDetect.js";
import { discoverZedCredentials } from "@/lib/zed-oauth/keychain.js";
import {
  partitionZedCredentials,
  zedCredentialSkipReason,
} from "@/lib/zed-oauth/importUtils.js";
import {
  filterCredentialsByConfirmation,
  parseConfirmedAccounts,
} from "@/lib/zed-oauth/confirmedAccounts.js";
import { saveZedCredential } from "@/lib/zed-oauth/saveCredential.js";

/**
 * POST /api/providers/zed/import — second leg of the 2-step Zed import flow.
 *
 * Body: `{ confirmedAccounts: Array<{ service, account, fingerprint }> }` — the
 * fingerprints come from `/discover`. The keychain is re-read here, and only
 * credentials whose `(service, account, fingerprint)` triple still matches the
 * live keychain state are saved. There is deliberately no "import everything"
 * fallback: an empty or missing confirmation list imports nothing.
 *
 * Auth: denied-by-default `/api/providers/*` plus the local-only gate in
 * dashboardGuard (this route reads host secrets and writes connections).
 */
export async function POST(request) {
  let body = null;
  try {
    const raw = await request.text();
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  const confirmed = parseConfirmedAccounts(body);
  if (confirmed === null) {
    return NextResponse.json(
      {
        success: false,
        error:
          "confirmedAccounts is required. Call POST /api/providers/zed/discover first, " +
          "let the user pick which credentials to import, then POST the chosen list as " +
          "{ confirmedAccounts: [{ service, account, fingerprint }, ...] }.",
      },
      { status: 400 },
    );
  }

  try {
    if (isRunningInDocker()) {
      return NextResponse.json(
        {
          success: false,
          error: ZED_KEYCHAIN_DOCKER_ERROR,
          zedInstalled: false,
          zedDockerEnvironment: true,
        },
        { status: 422 },
      );
    }

    const discovery = await discoverZedCredentials();
    if (!discovery.installed) {
      return NextResponse.json(
        {
          success: false,
          error: discovery.error,
          zedInstalled: false,
          zedDockerEnvironment: false,
        },
        { status: 404 },
      );
    }

    const { importable, skipped, duplicatesDropped } = partitionZedCredentials(
      discovery.credentials,
    );
    const toImport = filterCredentialsByConfirmation(importable, confirmed);
    const skippedSummary = skipped.map((cred) => ({
      provider: cred?.provider || "unknown",
      service: cred?.service || "",
      account: cred?.account || "",
      reason: zedCredentialSkipReason(cred) || "unsupported provider",
    }));

    if (toImport.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        providers: [],
        credentials: [],
        requested: confirmed.length,
        zedInstalled: true,
        skipped: skippedSummary,
        duplicatesDropped,
      });
    }

    let savedCount = 0;
    const failed = [];
    for (const cred of toImport) {
      try {
        await saveZedCredential(cred, { systemId: discovery.systemId });
        savedCount += 1;
      } catch (error) {
        failed.push({
          provider: cred.provider,
          account: cred.account,
          error: String(error?.message || error),
        });
        console.log("Zed import failed for", cred.provider, error);
      }
    }

    const providers = [...new Set(toImport.map((cred) => cred.provider))];

    return NextResponse.json({
      success: true,
      count: savedCount,
      providers,
      credentials: toImport.map((cred) => ({
        provider: cred.provider,
        service: cred.service,
        account: cred.account,
        hasToken: Boolean(cred.token),
      })),
      requested: confirmed.length,
      skipped: skippedSummary,
      duplicatesDropped,
      failed,
      zedInstalled: true,
    });
  } catch (error) {
    console.log("Zed import error:", error);
    const message = String(error?.message || "");
    if (message.includes("User canceled") || message.includes("denied")) {
      return NextResponse.json(
        {
          success: false,
          error: "Keychain access denied. Please grant permission when prompted by your OS.",
        },
        { status: 403 },
      );
    }
    if (message.includes("not found") || message.includes("ENOENT")) {
      return NextResponse.json(
        {
          success: false,
          error: "Keychain service not available on this system. On Linux, install libsecret-1-dev.",
        },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { success: false, error: "Failed to import credentials" },
      { status: 500 },
    );
  }
}