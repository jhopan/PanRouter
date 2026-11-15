import { AI_PROVIDERS } from "@/shared/constants/providers";

/**
 * Validation + filtering helpers for the Zed import 2-step confirmation flow.
 * Extracted so the route handlers stay slim and so the rejection paths can be
 * unit-tested without spinning up Next's Request/Response stack.
 *
 * Parity: OmniRoute src/lib/zed-oauth/importUtils.ts.
 */

// Upstream only rejected empty tokens; a two-character keychain value can only
// be junk (placeholder, truncated read), so drop it before it reaches a
// connection row.
export const MIN_ZED_TOKEN_LENGTH = 8;

function isSupportedZedProvider(provider) {
  return (
    typeof provider === "string" &&
    provider.length > 0 &&
    provider !== "unknown" &&
    !!AI_PROVIDERS[provider]
  );
}

/** Why a discovered credential will not be imported, or null when importable. */
export function zedCredentialSkipReason(credential) {
  const token = typeof credential?.token === "string" ? credential.token : "";
  if (!token) return "missing token";
  if (token.length < MIN_ZED_TOKEN_LENGTH) return "short token";
  if (!isSupportedZedProvider(credential?.provider)) return "unsupported provider";
  return null;
}

/**
 * Split discovered credentials into the importable set plus the skipped list and
 * a duplicate count. Duplicates are keyed on provider+token so two keychain
 * entries pointing at the same secret import once.
 */
export function partitionZedCredentials(credentials) {
  const importable = [];
  const skipped = [];
  const seen = new Set();
  let duplicatesDropped = 0;

  for (const credential of Array.isArray(credentials) ? credentials : []) {
    if (zedCredentialSkipReason(credential) !== null) {
      skipped.push(credential);
      continue;
    }

    const dedupeKey = `${credential.provider}:${credential.token}`;
    if (seen.has(dedupeKey)) {
      duplicatesDropped += 1;
      continue;
    }

    seen.add(dedupeKey);
    importable.push(credential);
  }

  return { importable, skipped, duplicatesDropped };
}