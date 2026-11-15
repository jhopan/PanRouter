import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { exchangeTokens } from "@/lib/oauth/providers";
import {
  clearZedSession,
  getZedSessionStatus,
} from "@/lib/oauth/utils/server";
import { readZedSystemId } from "@/lib/oauth/utils/zedCredentials";
import { isRunningInDocker } from "@/lib/oauth/utils/dockerDetect.js";
import { parseZedManualImportBody } from "@/lib/zed-oauth/manualImport.js";

/**
 * POST /api/providers/zed/manual-import
 *
 * A pasted Zed native-app callback URL, for Docker/headless installs (the host
 * keychain is unreachable) and for anyone who would rather paste the redirect
 * than let the loopback proxy catch it.
 *
 * Body: `{ callbackUrl, codeVerifier?, state?, systemId?, name? }`
 *
 * The callback's `access_token` is RSA-encrypted to the keypair created during
 * sign-in, so the private key (`codeVerifier`, the same value the OAuth paste
 * flow sends to /api/oauth/zed/exchange) is required. When the caller does not
 * have it, the verifier is taken from the live Zed login session started on
 * this server — which is what the sign-in modal produces.
 *
 * Auth: denied-by-default `/api/providers/*` plus the local-only gate in
 * dashboardGuard.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseZedManualImportBody(body);
  } catch (error) {
    return NextResponse.json(
      { error: String(error?.message || "Validation failed") },
      { status: 400 },
    );
  }

  try {
    const session = getZedSessionStatus(parsed.state || undefined);
    const codeVerifier = parsed.codeVerifier || session?.codeVerifier || null;
    if (!codeVerifier) {
      return NextResponse.json(
        {
          error:
            "The pasted Zed callback carries an RSA-encrypted token. Paste it while the " +
            "sign-in flow is still open, or include the login's codeVerifier.",
        },
        { status: 400 },
      );
    }

    const state = parsed.state || session?.state || null;
    const systemId = parsed.systemId || session?.systemId || (await readZedSystemId());

    let tokenData;
    try {
      tokenData = await exchangeTokens("zed", parsed.callbackUrl, null, codeVerifier, state, {
        ...(systemId ? { systemId } : {}),
      });
    } catch (error) {
      return NextResponse.json(
        { error: `Failed to read Zed callback: ${error?.message || error}` },
        { status: 400 },
      );
    }

    if (!tokenData?.accessToken) {
      return NextResponse.json(
        { error: "Zed callback did not yield an access token" },
        { status: 400 },
      );
    }

    // mapTokens keeps the user id inside providerSpecificData; accept both shapes.
    const userId = tokenData.userId || tokenData.providerSpecificData?.userId;
    if (!userId) {
      return NextResponse.json(
        { error: "Zed callback did not identify a user" },
        { status: 400 },
      );
    }

    const connection = await createProviderConnection({
      provider: "zed",
      authType: "oauth",
      ...tokenData,
      name: parsed.name || undefined,
      testStatus: "active",
    });

    if (state) clearZedSession(state);

    return NextResponse.json({
      success: true,
      connectionId: connection?.id || null,
      provider: "zed",
      account: String(userId),
      zedDockerEnvironment: isRunningInDocker(),
    });
  } catch (error) {
    console.log("Zed manual import error:", error);
    return NextResponse.json(
      { error: "Failed to save credential" },
      { status: 500 },
    );
  }
}