import {
  readZedIdeCredentials,
  ZED_DEFAULT_CREDENTIALS_URL,
} from "@/lib/oauth/utils/zedCredentials";

/**
 * Adapter between this repo's single-session Zed keychain reader and the
 * upstream discover/import contract, which expects a list of
 * `{ provider, service, account, token }` entries.
 *
 * The reader already handles Linux (secret-tool), macOS (security) and Windows
 * (Credential Manager) plus the `system_id` from Zed's kv_store, and
 * short-circuits inside Docker. One Zed IDE session is one credential.
 *
 * Parity: OmniRoute src/lib/zed-oauth/keychain-reader.ts (service-pattern scan),
 * adapted to the greater-zed session entry this repo reads.
 */

/** @returns {{provider: string, service: string, account: string, token: string}} */
export function toZedCredential(result) {
  return {
    provider: "zed",
    service: result.credentialsUrl || ZED_DEFAULT_CREDENTIALS_URL,
    account: String(result.userId),
    token: String(result.accessToken),
  };
}

/**
 * Read the Zed IDE session and shape it for the import flow.
 *
 * @param {{ readCredentials?: () => Promise<object> }} [deps] injectable reader for tests
 * @returns {Promise<{installed: boolean, credentials: object[], systemId: string|null,
 *   credentialsUrl: string|null, error: string|null}>}
 */
export async function discoverZedCredentials(deps = {}) {
  const readCredentials = deps.readCredentials || readZedIdeCredentials;
  const result = await readCredentials();

  if (!result?.found || !result.accessToken || !result.userId) {
    return {
      installed: false,
      credentials: [],
      systemId: null,
      credentialsUrl: result?.credentialsUrl || null,
      error: result?.error || "Zed IDE session not found in the system keyring.",
    };
  }

  return {
    installed: true,
    credentials: [toZedCredential(result)],
    systemId: result.systemId || null,
    credentialsUrl: result.credentialsUrl || null,
    error: null,
  };
}