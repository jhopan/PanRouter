/**
 * Read the CodeBuddy account id out of a bearer token.
 *
 * The official CLI sends an `X-User-Id` header on every request — chat,
 * token refresh, account listing — and the value is the token's `sub` claim
 * (a UUID). The gateway ties the request to the account behind the token, so
 * the header has to match the token it was sent with.
 *
 * This lives in its own module with no imports on purpose: the token refresh
 * service and the executor both need it, and importing the executor from the
 * refresh service would close a cycle (executors -> services -> executors)
 * that fails at module-evaluation time with "Cannot access 'm' before
 * initialization".
 */

/**
 * @param {object} credentials
 * @returns {string|null} the account id, or null when the token has none
 */
export function userIdFromCredentials(credentials) {
  const raw =
    credentials?.accessToken ||
    credentials?.access_token ||
    credentials?.token ||
    credentials?.apiKey ||
    credentials?.api_key ||
    "";
  const token = String(raw).trim();
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf8");
    const claims = JSON.parse(json);
    const sub = claims?.sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}
