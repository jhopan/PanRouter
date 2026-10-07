/**
 * realIpResolver — workaround for DNS steering / poisoned answers.
 *
 * Some providers (e.g. Tencent CodeBuddy Intl, www.codebuddy.ai) answer certain
 * resolvers with an unroutable 0.0.0.1 via DNS steering (anti-bot/geo), so
 * server-side fetches from datacenter VPSes fail instantly with
 * "fetch failed: connect to 0.0.0.1". Residential/ISP resolvers get the real IP.
 *
 * This helper queries a chain of public DNS-over-HTTPS endpoints (plus a Node
 * UDP resolver fallback), picks the first real IPv4 answer for the host, caches
 * it briefly, and exposes an undici Agent with a custom `lookup` so fetch can
 * connect to the real IP WITHOUT touching /etc/hosts or system DNS.
 *
 * Fully fail-open: any error just returns null and callers fall back to the
 * platform's normal resolution.
 */

let undiciAgent = null;

const POISONED_IPS = new Set(["0.0.0.0", "0.0.0.1", "127.0.0.1"]);

const DOH_ENDPOINTS = [
  "https://cloudflare-dns.com/dns-query?name=",
  "https://dns.google/resolve?name=",
  "https://doh.pub/dns-query?name=",          // Tencent DNSPod
];

const UDP_DNS_SERVERS = ["8.8.8.8", "1.1.1.1", "119.29.29.29", "223.5.5.5"];

// 60s cache matches the steering records' low TTL; long enough to not hammer DoH.
const CACHE_TTL_MS = 60_000;
const ipCache = new Map(); // host -> { ip, expiresAt }

export function isPoisonedIp(ip) {
  if (!ip) return true;
  const clean = String(ip).trim();
  return POISONED_IPS.has(clean) || clean.startsWith("0.0.0.");
}

function parseDohBody(json, hostname) {
  if (!json?.Answer || !Array.isArray(json.Answer)) return null;
  for (const ans of json.Answer) {
    if (ans.type === 1 && String(ans.name || "").toLowerCase() === hostname) {
      if (!isPoisonedIp(ans.data)) return ans.data;
    }
  }
  return null;
}

async function resolveViaDoh(hostname) {
  for (const base of DOH_ENDPOINTS) {
    try {
      const res = await fetch(`${base}${encodeURIComponent(hostname)}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const ip = parseDohBody(json, hostname);
      if (ip) return ip;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

async function resolveViaUdp(hostname) {
  try {
    const dns = await import("node:dns");
    const resolver = new dns.Resolver();
    resolver.setServers(UDP_DNS_SERVERS);
    const { promisify } = await import("node:util");
    const resolve4 = promisify(resolver.resolve4.bind(resolver));
    const addresses = await resolve4(hostname);
    const ip = addresses.find((a) => !isPoisonedIp(a));
    if (ip) return ip;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Resolve the first real IPv4 for `hostname` (cache + DoH chain + UDP fallback).
 * @param {string} hostname
 * @returns {Promise<string|null>}
 */
export async function resolveHostRealIP(hostname) {
  if (!hostname) return null;
  const h = hostname.toLowerCase();
  const cached = ipCache.get(h);
  if (cached && Date.now() < cached.expiresAt) return cached.ip;

  const ip = (await resolveViaDoh(h)) || (await resolveViaUdp(h));
  if (ip) ipCache.set(h, { ip, expiresAt: Date.now() + CACHE_TTL_MS });
  return ip || null;
}

function createLookupFor(hostname) {
  return async function lookup(host, options, callback) {
    try {
      const ip = await resolveHostRealIP(String(host).toLowerCase());
      if (!ip) {
        const err = new Error(`realIpResolver: no real IP for ${host}`);
        err.code = "ENOTFOUND";
        callback(err);
        return;
      }
      callback(null, [{ address: ip, family: 4, ttl: 0 }]);
    } catch (e) {
      callback(e);
    }
  };
}

/**
 * Returns an undici dispatcher (Agent with custom DNS lookup) for the given URL
 * when its host is currently poisoned by DNS steering; null otherwise.
 * @param {string} url
 * @returns {Promise<import("undici").Agent|null>}
 */
export async function maybeDnsFixDispatcher(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  // Only bother when a poisoned answer is actually expected.
  const { resolve } = await import("node:dns/promises");
  let currentIp = null;
  try {
    const addrs = await resolve(hostname, { family: 4 });
    currentIp = Array.isArray(addrs) ? addrs[0]?.address : null;
  } catch {
    currentIp = null;
  }
  if (currentIp && !isPoisonedIp(currentIp)) return null;

  const realIp = await resolveHostRealIP(hostname);
  if (!realIp) return null;

  if (!undiciAgent) {
    const undici = await import("undici");
    undiciAgent = new undici.Agent({
      connect: { lookup: createLookupFor(hostname) },
    });
  }
  return undiciAgent;
}

/** Test-only: clear caches / reset agent. */
export function _resetRealIpResolver() {
  ipCache.clear();
  undiciAgent = null;
}

/**
 * fetch() wrapper that transparently applies the real-IP dispatcher when the
 * target host is DNS-poisoned (0.0.0.x from system resolver). Fail-open: any
 * resolver hiccup falls back to a plain fetch.
 */
export async function dnsFixedFetch(url, options = {}) {
  try {
    const dispatcher = await maybeDnsFixDispatcher(url);
    if (dispatcher) return globalThis.fetch(url, { ...options, dispatcher });
  } catch {
    // fall through to plain fetch
  }
  return globalThis.fetch(url, options);
}