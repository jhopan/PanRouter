import { fingerprintZedCredential } from "./credentialFingerprint.js";

/**
 * Validation + filtering for the `confirmedAccounts` payload of the Zed import
 * 2-step flow.
 *
 * Ported from OmniRoute src/lib/zed-oauth/confirmedAccounts.ts. Upstream uses
 * zod (`confirmedAccountSchema` / `zedImportSchema`); this repo ships no zod, so
 * the same field limits are enforced by hand.
 */

const MAX_IDENTIFIER_LENGTH = 500;
const MAX_FINGERPRINT_LENGTH = 100;
const MAX_CONFIRMED_ACCOUNTS = 100;

function cleanIdentifier(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_IDENTIFIER_LENGTH) return null;
  return trimmed;
}

function cleanFingerprint(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FINGERPRINT_LENGTH) return null;
  return trimmed;
}

export function isConfirmedAccount(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    cleanIdentifier(value.service) !== null &&
    cleanIdentifier(value.account) !== null &&
    cleanFingerprint(value.fingerprint) !== null
  );
}

/**
 * Parse a request body into a normalized confirmed-account list.
 * Returns null when the body is not `{ confirmedAccounts: [...] }` (or any entry
 * is malformed) so the caller can answer 400.
 */
export function parseConfirmedAccounts(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const list = body.confirmedAccounts;
  if (!Array.isArray(list) || list.length > MAX_CONFIRMED_ACCOUNTS) return null;

  const confirmed = [];
  for (const entry of list) {
    if (!isConfirmedAccount(entry)) return null;
    confirmed.push({
      service: cleanIdentifier(entry.service),
      account: cleanIdentifier(entry.account),
      fingerprint: cleanFingerprint(entry.fingerprint),
    });
  }
  return confirmed;
}

/**
 * Keep only the credentials whose current (service, account, fingerprint) triple
 * was confirmed by the caller. The fingerprint is recomputed from the freshly
 * re-read keychain token, so a stale or tampered confirmation matches nothing.
 */
export function filterCredentialsByConfirmation(credentials, confirmed) {
  if (!Array.isArray(confirmed) || confirmed.length === 0) return [];
  const confirmedKeys = new Set(
    confirmed.map((c) => `${c.service}|${c.account}|${c.fingerprint}`),
  );
  return (Array.isArray(credentials) ? credentials : []).filter((cred) => {
    const fingerprint = fingerprintZedCredential(cred.service, cred.account, cred.token);
    return confirmedKeys.has(`${cred.service}|${cred.account}|${fingerprint}`);
  });
}