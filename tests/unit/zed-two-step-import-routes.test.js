/**
 * Zed 2-step import — route contract.
 *
 * The keychain reader, connection writer and token exchange are mocked, so this
 * suite pins the security properties without touching the host keyring:
 *   - /discover returns fingerprints + account metadata and NO raw token
 *   - /import accepts a known fingerprint and ignores an unknown one
 *   - /manual-import parses a pasted callback URL and saves the connection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  keychain: {
    found: true,
    userId: "user-1",
    accessToken: "zed-access-token-abcdef",
    systemId: "sys-1",
    credentialsUrl: "https://zed.dev",
    error: null,
  },
  docker: false,
  zedSession: null,
  createConnection: vi.fn(async (data) => ({ id: "conn-1", ...data })),
  fetchUser: vi.fn(async () => ({ email: "user@example.com", name: "Zed User" })),
  resolveOrganizationId: vi.fn(() => "org-1"),
  exchangeTokens: vi.fn(async () => ({
    accessToken: "decrypted-token",
    refreshToken: null,
    expiresIn: null,
    providerSpecificData: { authMethod: "oauth", userId: "user-9", systemId: "sys-9" },
  })),
  readZedSystemId: vi.fn(async () => "sys-from-db"),
  clearZedSession: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({
      status: init?.status || 200,
      body,
    }),
  },
}));

vi.mock("@/lib/oauth/utils/zedCredentials", () => ({
  readZedIdeCredentials: vi.fn(async () => state.keychain),
  readZedSystemId: state.readZedSystemId,
  resolveZedCredentialsUrl: vi.fn(async () => "https://zed.dev"),
  ZED_DEFAULT_CREDENTIALS_URL: "https://zed.dev",
  ZED_KEYRING_LABEL: "zed-github-account",
  ZED_KEYCHAIN_DOCKER_ERROR: "Zed cannot read the host keychain inside Docker",
}));

vi.mock("@/lib/oauth/utils/dockerDetect.js", () => ({
  isRunningInDocker: () => state.docker,
}));

vi.mock("@/lib/oauth/utils/server", () => ({
  getZedSessionStatus: vi.fn(() => state.zedSession),
  clearZedSession: state.clearZedSession,
}));

vi.mock("@/models", () => ({
  createProviderConnection: state.createConnection,
}));

vi.mock("open-sse/shared/zedAuth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchZedAuthenticatedUser: (...args) => state.fetchUser(...args),
    resolveZedOrganizationId: (...args) => state.resolveOrganizationId(...args),
  };
});

vi.mock("@/lib/oauth/providers", () => ({
  exchangeTokens: state.exchangeTokens,
}));

const { POST: discoverRoute } = await import("../../src/app/api/providers/zed/discover/route.js");
const { POST: importRoute } = await import("../../src/app/api/providers/zed/import/route.js");
const { POST: manualImportRoute } = await import(
  "../../src/app/api/providers/zed/manual-import/route.js"
);
const { fingerprintZedCredential } = await import(
  "../../src/lib/zed-oauth/credentialFingerprint.js"
);

const CURRENT_FINGERPRINT = fingerprintZedCredential(
  state.keychain.credentialsUrl,
  state.keychain.userId,
  state.keychain.accessToken,
);

const textRequest = (body) => ({
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const jsonRequest = (body) => ({ json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  state.docker = false;
  state.zedSession = null;
  state.keychain = {
    found: true,
    userId: "user-1",
    accessToken: "zed-access-token-abcdef",
    systemId: "sys-1",
    credentialsUrl: "https://zed.dev",
    error: null,
  };
});

describe("POST /api/providers/zed/discover", () => {
  it("returns fingerprints and account metadata without the raw token", async () => {
    const response = await discoverRoute();

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(1);
    expect(response.body.candidates).toEqual([
      {
        provider: "zed",
        service: "https://zed.dev",
        account: "user-1",
        fingerprint: CURRENT_FINGERPRINT,
      },
    ]);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(state.keychain.accessToken);
    expect(serialized).not.toContain("accessToken");
  });

  it("404s when the keychain has no Zed session", async () => {
    state.keychain = {
      found: false,
      credentialsUrl: "https://zed.dev",
      error: "Zed IDE session not found in the system keyring.",
    };

    const response = await discoverRoute();

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/not found/);
  });

  it("422s with the docker hint when running in a container", async () => {
    state.docker = true;

    const response = await discoverRoute();

    expect(response.status).toBe(422);
    expect(response.body.zedDockerEnvironment).toBe(true);
    expect(state.createConnection).not.toHaveBeenCalled();
  });
});

describe("POST /api/providers/zed/import", () => {
  it("imports the credential whose fingerprint the caller confirmed", async () => {
    const response = await importRoute(
      textRequest({
        confirmedAccounts: [
          { service: "https://zed.dev", account: "user-1", fingerprint: CURRENT_FINGERPRINT },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(1);
    expect(response.body.providers).toEqual(["zed"]);

    expect(state.createConnection).toHaveBeenCalledTimes(1);
    const saved = state.createConnection.mock.calls[0][0];
    expect(saved.provider).toBe("zed");
    expect(saved.authType).toBe("oauth");
    expect(saved.accessToken).toBe(state.keychain.accessToken);
    expect(saved.providerSpecificData).toMatchObject({
      authMethod: "imported",
      userId: "user-1",
      systemId: "sys-1",
      organizationId: "org-1",
    });
  });

  it("rejects an unknown fingerprint without touching connections", async () => {
    const response = await importRoute(
      textRequest({
        confirmedAccounts: [
          { service: "https://zed.dev", account: "user-1", fingerprint: "0".repeat(16) },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(0);
    expect(response.body.credentials).toEqual([]);
    expect(state.createConnection).not.toHaveBeenCalled();
  });

  it("rejects a confirmation for a different account even with the right fingerprint", async () => {
    const response = await importRoute(
      textRequest({
        confirmedAccounts: [
          { service: "https://zed.dev", account: "someone-else", fingerprint: CURRENT_FINGERPRINT },
        ],
      }),
    );

    expect(response.body.count).toBe(0);
    expect(state.createConnection).not.toHaveBeenCalled();
  });

  it("400s when confirmedAccounts is missing or malformed", async () => {
    for (const body of ["{}", '{"confirmedAccounts": "nope"}', "not-json"]) {
      const response = await importRoute(textRequest(body));
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/confirmedAccounts is required/);
    }
    expect(state.createConnection).not.toHaveBeenCalled();
  });

  it("reports a credential the provider API rejects as failed, not imported", async () => {
    state.fetchUser.mockRejectedValueOnce(new Error("401 Unauthorized"));

    const response = await importRoute(
      textRequest({
        confirmedAccounts: [
          { service: "https://zed.dev", account: "user-1", fingerprint: CURRENT_FINGERPRINT },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(0);
    expect(response.body.failed).toHaveLength(1);
    expect(response.body.failed[0].error).toMatch(/401/);
    expect(state.createConnection).not.toHaveBeenCalled();
  });
});

describe("POST /api/providers/zed/manual-import", () => {
  it("parses a pasted callback URL and saves the Zed connection", async () => {
    const callbackUrl = "http://127.0.0.1:58443/?user_id=user-9&access_token=enc-token";
    const response = await manualImportRoute(
      jsonRequest({ callbackUrl, codeVerifier: "zed-rsa-pkcs1:abc" }),
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.connectionId).toBe("conn-1");

    expect(state.exchangeTokens).toHaveBeenCalledTimes(1);
    const [provider, code, redirectUri, codeVerifier, stateArg, meta] =
      state.exchangeTokens.mock.calls[0];
    expect(provider).toBe("zed");
    expect(code).toBe(callbackUrl);
    expect(redirectUri).toBeNull();
    expect(codeVerifier).toBe("zed-rsa-pkcs1:abc");
    expect(stateArg).toBeNull();
    expect(meta).toEqual({ systemId: "sys-from-db" });

    const saved = state.createConnection.mock.calls[0][0];
    expect(saved.provider).toBe("zed");
    expect(saved.accessToken).toBe("decrypted-token");
    expect(saved.testStatus).toBe("active");
  });

  it("falls back to the live login session's verifier and state", async () => {
    state.zedSession = { state: "state-1", codeVerifier: "zed-rsa-pkcs1:session", systemId: "sys-2" };

    const response = await manualImportRoute(
      jsonRequest({
        callbackUrl: "http://127.0.0.1:58443/?user_id=user-9&access_token=enc-token",
      }),
    );

    expect(response.status).toBe(200);
    const [, , , codeVerifier, stateArg] = state.exchangeTokens.mock.calls[0];
    expect(codeVerifier).toBe("zed-rsa-pkcs1:session");
    expect(stateArg).toBe("state-1");
    expect(state.clearZedSession).toHaveBeenCalledWith("state-1");
    expect(state.readZedSystemId).not.toHaveBeenCalled();
  });

  it("400s on an invalid callback URL", async () => {
    const response = await manualImportRoute(jsonRequest({ callbackUrl: "garbage" }));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Zed callback|Invalid/);
    expect(state.createConnection).not.toHaveBeenCalled();
  });

  it("400s when no private-key verifier is available", async () => {
    const response = await manualImportRoute(
      jsonRequest({
        callbackUrl: "http://127.0.0.1:58443/?user_id=user-9&access_token=enc-token",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/codeVerifier|sign-in/);
    expect(state.exchangeTokens).not.toHaveBeenCalled();
    expect(state.createConnection).not.toHaveBeenCalled();
  });

  it("400s when the callback cannot be decrypted", async () => {
    state.exchangeTokens.mockRejectedValueOnce(new Error("Failed to decrypt Zed access token"));

    const response = await manualImportRoute(
      jsonRequest({
        callbackUrl: "http://127.0.0.1:58443/?user_id=user-9&access_token=enc-token",
        codeVerifier: "zed-rsa-pkcs1:wrong",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Failed to read Zed callback/);
    expect(state.createConnection).not.toHaveBeenCalled();
  });
});