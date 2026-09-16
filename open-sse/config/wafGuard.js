/**
 * WAF trigger guard — Render/Cloudflare body-inspection false positive.
 *
 * Render puts every public-facing web service behind Cloudflare's managed WAF,
 * and that WAF is NOT configurable (see Render's own open feature request "Let us
 * disable the Cloudflare WAF"; their DDoS docs say "There's nothing to configure".
 * It also runs at the edge, so an inbound-IP allowlist does not bypass it).
 *
 * That WAF inspects the request BODY and blocks anything containing a
 * backtick-quoted `curl`/`wget` command with an http(s) URL — it reads the
 * markdown inline-code span as command-injection / SSRF. Verified against
 * freebuff-proxy-zn7c.onrender.com (2026-09-16): the identical text WITHOUT the
 * backticks passes. It is deterministic, and size-independent (2 MB of prose is
 * fine; 30 characters with a backtick are not).
 *
 * Why this matters here: an agent session whose context quotes a curl command —
 * an AGENTS.md, a loaded skill, a tool result — gets EVERY subsequent request
 * blocked, because the poisoned text rides along in the conversation history.
 * The session cannot be recovered by editing the source file either: by then the
 * pattern is also in past messages. That is the failure this guard prevents.
 *
 * Scope is deliberately a HOST list, not a provider:
 *   - "frp" is a client-facing model alias; the real target is the compatible
 *     node's baseUrl, which is what actually carries the WAF.
 *   - The native `freebuff` provider talks to www.codebuff.com directly and must
 *     NOT be touched — keying on the provider name would wrongly rewrite it.
 *   - Proxy pools must not be used as the key either: the vercel-relay pool is
 *     shared with unrelated providers (CodeBuddy-INTL uses the same one), and the
 *     block happens with or without a proxy. The pool is not the cause.
 * Host-keying also means this whole guard deactivates by deleting one line once
 * the upstream moves off Render.
 */

// Hosts known to sit behind a body-inspecting WAF. Keep this an explicit list —
// it is the entire blast radius of the mutation, and it should shrink to nothing.
const DEFAULT_WAF_HOSTS = ["freebuff-proxy-zn7c.onrender.com"];

function protectedHosts() {
  const raw = process.env.WAF_PROTECTED_HOSTS;
  if (!raw) return DEFAULT_WAF_HOSTS;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** True when `url` targets a host we know rewrites/blocks on body content. */
export function isWafProtectedUrl(url) {
  if (!url) return false;
  let host;
  try {
    host = new URL(typeof url === "string" ? url : url.toString()).hostname.toLowerCase();
  } catch {
    return false;
  }
  return protectedHosts().includes(host);
}

// The backtick that OPENS a curl/wget command. Deliberately not a "match the whole
// inline-code span" regex: pairing backticks breaks when the document has an odd
// number of them before the trigger (markdown prose does). In the session that
// exposed this, an earlier unpaired backtick shifted the pairing so the `curl …`
// command landed OUTSIDE the matched span and was never neutralised — the sanitised
// retry went out unchanged and was blocked again. Matching the opening backtick
// directly is immune to that: the WAF keys on the backtick immediately preceding
// the command, so removing exactly that one is both necessary and sufficient.
const OPENING_TRIGGER = /`(?=\s*(?:curl|wget)\b)/gi;
const HAS_URL = /https?:\/\//i;
// How far past the command we look for its URL. The WAF matched `curl http://` at
// 3 characters; anything within a few hundred is the same command line.
const URL_LOOKAHEAD = 400;

/**
 * Remove the backtick that opens each curl/wget command.
 *
 * Only that one character is dropped, and only when an http(s) URL follows it in
 * the same command. The command text, its URL, and every other character of the
 * body stay byte-identical — a request with no trigger comes back unchanged
 * (`count === 0`), so nothing is mutated on the normal path.
 *
 * Returns { body, count } — count is how many commands were unwrapped, for logging.
 */
export function sanitizeWafTriggers(body) {
  if (typeof body !== "string" || !body.includes("`")) return { body, count: 0 };
  let count = 0;
  const out = body.replace(OPENING_TRIGGER, (match, offset) => {
    // Bound the window to THIS command: stop at the next backtick or newline, so a
    // separate URL elsewhere in the text (`` `curl` … `https://x` ``) is not treated
    // as this command's URL.
    const ahead = body.slice(offset + 1, offset + URL_LOOKAHEAD);
    const stop = ahead.search(/[`\n]/);
    const window = stop >= 0 ? ahead.slice(0, stop) : ahead;
    if (!HAS_URL.test(window)) return match;
    count++;
    return "";
  });
  return { body: count > 0 ? out : body, count };
}

/**
 * Is this response the WAF block page?
 *
 * Requires BOTH a blocked status and the marker text, so a legitimate 403 (bad
 * key, quota, region lock) never triggers the sanitised retry.
 */
export function isWafBlockResponse(status, bodyText) {
  if (status !== 403 && status !== 503) return false;
  const head = typeof bodyText === "string" ? bodyText.slice(0, 4096) : "";
  if (!head) return false;
  return /web application firewall/i.test(head) || /<title>\s*Blocked\s*<\/title>/i.test(head);
}
