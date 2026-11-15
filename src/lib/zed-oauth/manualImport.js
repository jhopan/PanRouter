import { parseZedCallbackPayload } from "open-sse/shared/zedAuth.js";

/**
 * Validation for POST /api/providers/zed/manual-import.
 *
 * The manual path exists for Docker/headless installs (the host keychain is
 * unreachable from a container) and for users who prefer pasting the redirect
 * URL instead of letting the loopback proxy catch it. The pasted callback is
 * parsed with the same helper the OAuth paste flow uses
 * (`parseZedCallbackPayload`), and the RSA-encrypted token is decrypted later by
 * `exchangeTokens("zed", ...)` with the login's private-key verifier.
 */

const MAX_CALLBACK_URL_LENGTH = 4096;
const MAX_CODE_VERIFIER_LENGTH = 8192;
const MAX_STATE_LENGTH = 200;
const MAX_SYSTEM_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 128;

function readString(value, maxLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`Field exceeds ${maxLength} characters`);
  }
  return trimmed;
}

/**
 * @param {unknown} body
 * @returns {{callbackUrl: string, userId: string, encryptedAccessToken: string,
 *   codeVerifier: string|null, state: string|null, systemId: string|null, name: string|null}}
 */
export function parseZedManualImportBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object");
  }

  const callbackUrl =
    readString(body.callbackUrl, MAX_CALLBACK_URL_LENGTH) ||
    readString(body.code, MAX_CALLBACK_URL_LENGTH);
  if (!callbackUrl) throw new Error("callbackUrl is required");

  // Throws "Invalid Zed callback URL" / "Zed callback must include ..." on junk.
  const { userId, encryptedAccessToken } = parseZedCallbackPayload(callbackUrl);

  return {
    callbackUrl,
    userId,
    encryptedAccessToken,
    codeVerifier: readString(body.codeVerifier, MAX_CODE_VERIFIER_LENGTH) || null,
    state: readString(body.state, MAX_STATE_LENGTH) || null,
    systemId: readString(body.systemId, MAX_SYSTEM_ID_LENGTH) || null,
    name: readString(body.name, MAX_NAME_LENGTH) || null,
  };
}