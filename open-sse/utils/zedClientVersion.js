// Advertised Zed editor version for the x-zed-version header.
//
// Zed gates features on the client version the caller claims, so a hardcoded
// pin goes stale with every editor release. The captured pin is the floor: a
// newer dotted triple from the latest zed-industries/zed GitHub release
// replaces it for six hours. The lookup is fire-and-forget — a cold or failed
// fetch keeps the pin and never throws into the request path. An explicit
// executor config.appVersion still wins over both.
//
// Parity: OmniRoute open-sse/executors/zedClientVersion.ts.

export const ZED_CLIENT_VERSION = "0.200.0";
export const ZED_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const ZED_VERSION_FETCH_TIMEOUT_MS = 20_000;
// A failed lookup caches nothing and the getter runs per upstream request, so
// wait one window before asking GitHub again instead of on every request.
export const ZED_VERSION_RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

const ZED_RELEASE_URL = "https://api.github.com/repos/zed-industries/zed/releases/latest";
const DOTTED_TRIPLE_RE = /^\d+\.\d+\.\d+$/;

let cachedVersion = null;
let cachedAt = 0;
let inFlight = null;
// Earliest time the getter may start another background lookup: one TTL after
// any answer, the retry window after a failure.
let nextBackgroundRefreshAt = 0;

function parseReleaseTag(tagName) {
  if (typeof tagName !== "string") return null;
  const stripped = tagName.trim().replace(/^v/, "");
  return DOTTED_TRIPLE_RE.test(stripped) ? stripped : null;
}

function compareDottedTriple(left, right) {
  const lp = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rp = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) if (lp[i] !== rp[i]) return lp[i] - rp[i];
  return 0;
}

// Highest known good version, never below the pin. Monotonic: a release that is
// older than the pin or than a previously seen newer value is ignored.
function highest(...candidates) {
  let best = ZED_CLIENT_VERSION;
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !DOTTED_TRIPLE_RE.test(candidate)) continue;
    if (compareDottedTriple(candidate, best) > 0) best = candidate;
  }
  return best;
}

function pickAtLeastPin(version) {
  return highest(version);
}

function readFreshCache() {
  if (!cachedVersion) return null;
  if (Date.now() - cachedAt >= ZED_VERSION_CACHE_TTL_MS) return null;
  return cachedVersion;
}

function canStartBackgroundRefresh() {
  // Dashboard bundles reach this module through the executor graph; browser
  // lookups would spend the per-IP GitHub budget the server needs.
  if (typeof window !== "undefined") return false;
  if (typeof process === "undefined") return false;
  return !process.env?.NODE_TEST_CONTEXT;
}

/**
 * Sync hot path: the highest release seen (never below the pin), else the pin.
 * A stale cache starts one background refresh; this call never waits on it.
 * The TTL gates refetching only: an expired cache keeps advertising the newest
 * version already seen rather than dropping back to the pin.
 */
export function getZedClientVersion() {
  if (
    canStartBackgroundRefresh() &&
    !readFreshCache() &&
    !inFlight &&
    Date.now() >= nextBackgroundRefreshAt
  ) {
    void refreshZedClientVersion();
  }
  return highest(cachedVersion);
}

/**
 * Warm the GitHub cache (20s timeout, 6h TTL, coalesced, never rejects).
 * Any failure — network, non-2xx, or a tag that is not a dotted triple —
 * leaves the pin (or the previous newer value) in place.
 */
export function refreshZedClientVersion(fetchImpl = globalThis.fetch) {
  const fresh = readFreshCache();
  if (fresh) return Promise.resolve(pickAtLeastPin(fresh));
  if (inFlight) return inFlight;

  const run = (async () => {
    let resolved = null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ZED_VERSION_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(ZED_RELEASE_URL, {
        headers: {
          Accept: "application/json",
          "User-Agent": "panrouter-ZedVersion/1.0",
        },
        signal: controller.signal,
      });
      if (response?.ok) {
        const payload = await response.json();
        resolved = parseReleaseTag(payload?.tag_name);
      }
    } catch {
      resolved = null;
    } finally {
      clearTimeout(timeoutId);
    }

    if (resolved && compareDottedTriple(resolved, highest(cachedVersion)) > 0) {
      cachedVersion = resolved;
      cachedAt = Date.now();
    }
    nextBackgroundRefreshAt =
      Date.now() +
      (resolved ? ZED_VERSION_CACHE_TTL_MS : ZED_VERSION_RETRY_AFTER_FAILURE_MS);
    return pickAtLeastPin(highest(resolved, cachedVersion));
  })();

  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** Test seam: drop the release cache so the next refresh hits the network. */
export function resetZedClientVersionCache() {
  nextBackgroundRefreshAt = 0;
  cachedVersion = null;
  cachedAt = 0;
  inFlight = null;
}