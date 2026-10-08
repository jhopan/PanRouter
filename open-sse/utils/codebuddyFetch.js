/**
 * codebuddyFetch — Targeted HTTPS client for CodeBuddy International (www.codebuddy.ai).
 *
 * Tencent EdgeOne DNS steering blackholes queries from datacenter IPs to 0.0.0.1.
 * This helper connects directly to Tencent EdgeOne Anycast IP (43.159.106.56)
 * while preserving full TLS SNI / Host header verification.
 *
 * Completely isolated:
 * - Uses native node:https and node:dns (zero dependencies, zero Undici)
 * - Never patches global fetch
 * - Never touches or affects any other provider or host
 */

import https from "node:https";
import dns from "node:dns";
import { Readable } from "node:stream";

export const CODEBUDDY_EDGE_IP = "43.159.106.56";
export const CODEBUDDY_HOST = "www.codebuddy.ai";

/**
 * Perform an HTTPS request to www.codebuddy.ai resolving directly to its real edge IP.
 *
 * @param {string} urlStr
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, status: number, statusText: string, headers: Map<string, string>, body: any, text: () => Promise<string>, json: () => Promise<any>, clone: () => object }>}
 */
export function codebuddyFetch(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (err) {
      return reject(err);
    }

    const headers = options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers || {}) };

    const req = https.request({
      hostname: url.hostname,
      port: url.port ? parseInt(url.port, 10) : 443,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers,
      signal: options.signal,
      lookup: (hostname, opts, cb) => {
        if (typeof opts === "function") {
          cb = opts;
          opts = {};
        }
        if (hostname.toLowerCase() === CODEBUDDY_HOST) {
          if (opts && opts.all) {
            cb(null, [{ address: CODEBUDDY_EDGE_IP, family: 4 }]);
          } else {
            cb(null, CODEBUDDY_EDGE_IP, 4);
          }
        } else {
          dns.lookup(hostname, opts, cb);
        }
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const bodyText = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage || "",
          headers: new Map(Object.entries(res.headers)),
          body: Readable.toWeb(res),
          text: async () => bodyText,
          json: async () => JSON.parse(bodyText),
          clone: () => ({
            text: async () => bodyText,
            json: async () => JSON.parse(bodyText),
          }),
        });
      });
    });

    req.on("error", reject);

    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}
