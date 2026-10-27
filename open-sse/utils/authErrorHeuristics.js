/**
 * Is this 403 an auth failure, or a provider refusal that a token refresh
 * cannot fix?
 *
 * The generic rule is "401 or 403 → refresh the token and retry". For several
 * providers that is wrong:
 *
 *   - Qoder answers 403 for its admission queue (code 10605, "isQueued":
 *     true). The token is fine; the MODEL is momentarily saturated. Refreshing
 *     the token cannot help, and the retry sends a second pointless request.
 *   - CodeBuddy answers 403 with code 11140 (account restricted) and 11128
 *     (channel verification). Neither is an auth problem.
 *
 * Refreshing in those cases costs 3 refresh attempts (6s of backoff) plus a
 * duplicate upstream request, and it buries the real reason in the log as
 * "refresh failed".
 *
 * So: read the body once, decide, and only refresh for a genuine auth error.
 */

/** Provider error codes that are NOT auth failures. */
const NON_AUTH_403_CODES = new Set([
  "10605", // Qoder admission queue
  "11128", // CodeBuddy channel verification
  "11140", // CodeBuddy account restricted
]);

/**
 * Parse the provider error code out of a response body without consuming it.
 * The body may be JSON, a JSON string, or a doubly-nested JSON string.
 * @param {string} bodyText
 * @returns {string|null}
 */
export function extractProviderErrorCode(bodyText) {
  const text = String(bodyText || "");
  if (!text) return null;

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    const m = text.match(/"code"\s*:\s*"?(\d{3,6})"?/);
    return m ? m[1] : null;
  }

  // Walk the nested envelopes: {error:{message:"{\"code\":\"403\"}"}}
  let current = payload;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "string") {
      try { current = JSON.parse(current); continue; } catch { break; }
    }
    if (typeof current !== "object") break;

    const code = current.code ?? current.error?.code;
    if (code !== undefined && code !== null && /^\d{3,6}$/.test(String(code))) {
      return String(code);
    }
    current = current.error?.message ?? current.message ?? current.error;
  }
  return null;
}

/**
 * Does the body carry a message that marks it as a provider refusal rather
 * than an auth problem?
 * @param {string} bodyText
 * @returns {boolean}
 */
export function isProviderRefusalBody(bodyText) {
  const text = String(bodyText || "").toLowerCase();
  if (!text) return false;
  // The body is usually a JSON string inside a JSON string, so the inner
  // quotes are backslash-escaped: {\"isQueued\":true}. Strip the escapes
  // before matching.
  const flat = text.replace(/\\/g, "");
  return (
    /"isqueued"\s*:\s*true/.test(flat)
    || /first message is not system prompt/.test(flat)
    || /unusual activity/.test(flat)
    || /restricted due to/.test(flat)
    || /request illegal/.test(flat)
  );
}

/**
 * Should a 403 trigger a token refresh + retry?
 *
 * @param {number} status - upstream status
 * @param {string} bodyText - upstream body (already read)
 * @returns {boolean} true when a refresh is worth trying
 */
export function shouldRefreshOnForbidden(status, bodyText) {
  if (Number(status) !== 403) return true; // not a 403 → caller decides
  const code = extractProviderErrorCode(bodyText);
  if (code && NON_AUTH_403_CODES.has(code)) return false;
  if (isProviderRefusalBody(bodyText)) return false;
  return true;
}
