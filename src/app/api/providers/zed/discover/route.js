import { NextResponse } from "next/server";
import { ZED_KEYCHAIN_DOCKER_ERROR } from "@/lib/oauth/utils/zedCredentials";
import { isRunningInDocker } from "@/lib/oauth/utils/dockerDetect.js";
import { discoverZedCredentials } from "@/lib/zed-oauth/keychain.js";
import {
  partitionZedCredentials,
  zedCredentialSkipReason,
} from "@/lib/zed-oauth/importUtils.js";
import { fingerprintZedCredential } from "@/lib/zed-oauth/credentialFingerprint.js";

/**
 * POST /api/providers/zed/discover — first leg of the 2-step Zed import flow.
 *
 * Returns `{ provider, service, account, fingerprint }` for every importable
 * credential found in the OS keyring. The raw token never leaves the server;
 * the dashboard renders this list, the user picks accounts, and `/import` is
 * called with the chosen fingerprints. `/import` re-reads the keychain and
 * filters by fingerprint, so a tampered discover response cannot make it save
 * an unrelated token.
 *
 * Auth: `/api/providers/*` is denied-by-default in dashboardGuard; the path is
 * also local-only there because it reads host secrets.
 */
export async function POST() {
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

    const candidates = importable.map((cred) => ({
      provider: cred.provider,
      service: cred.service,
      account: cred.account,
      fingerprint: fingerprintZedCredential(cred.service, cred.account, cred.token),
    }));

    return NextResponse.json({
      success: true,
      zedInstalled: true,
      zedDockerEnvironment: false,
      count: candidates.length,
      candidates,
      duplicatesDropped,
      skipped: skipped.map((cred) => ({
        provider: cred?.provider || "unknown",
        service: cred?.service || "",
        account: cred?.account || "",
        reason: zedCredentialSkipReason(cred) || "unsupported provider",
      })),
    });
  } catch (error) {
    console.log("Zed discover error:", error);
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
    return NextResponse.json(
      { success: false, error: "Failed to discover Zed credentials" },
      { status: 500 },
    );
  }
}