// Netlify relay helpers: relay function bundle + digest-deploy plumbing.
//
// Deploy model (per https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api):
//   1. POST /api/v1/sites                                     → { id, ssl_url }
//   2. POST /api/v1/sites/{site_id}/deploys { files, functions }
//      → { id, required[], required_functions[] } (SHA1 for files, SHA256 for functions)
//   3. PUT  /api/v1/deploys/{id}/files/{path}                 (only SHAs listed in `required`)
//      PUT  /api/v1/deploys/{id}/functions/{name}?runtime=js  (only SHAs in `required_functions`)
//   4. Poll GET /api/v1/deploys/{id} until state === "ready".
//
// The relay speaks the same header spec as the Vercel/Cloudflare/Deno relays
// (x-relay-target + x-relay-path), so proxyAwareFetch needs no changes.
// Manual digest deploys run no build step, so the function is served from its
// default endpoint: <site>/.netlify/functions/relay.
//
// Ported from upstream 9router. Two relay variants live side by side:
//   NETLIFY_RELAY_FUNCTION_CODE      — upstream: buffers the whole response
//   NETLIFY_RELAY_STREAM_FUNCTION_CODE — PanRouter: streams SSE, SSRF-guarded
// The deploy route picks one via `?variant=`.

import { createHash } from "node:crypto";

export const NETLIFY_API = "https://api.netlify.com/api/v1";
export const NETLIFY_FUNCTION_NAME = "relay";
export const NETLIFY_FUNCTION_PATH = "/.netlify/functions/relay";

// ─── Variant 1: upstream 9router relay ────────────────────────────────
// Digest-deployed functions (no build step) run on the Lambda-compatible
// runtime, so the bundle must use exports.handler(event) with a string body,
// not the modern export-default streaming syntax. Live-verified failure
// modes: ESM syntax -> Runtime.UserCodeSyntaxError (502); stream body ->
// cannot-unmarshal-object-into-Go-struct-field (502).
//
// Consequence: SSE is buffered. The response stays valid SSE, but the client
// receives nothing until upstream finishes. Fine for non-streaming calls and
// short answers; a coding agent sees the whole latency at once.
export const NETLIFY_RELAY_FUNCTION_CODE = `exports.handler = async (event) => {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    headers[k.toLowerCase()] = v;
  }

  const target = headers["x-relay-target"];
  const relayPath = headers["x-relay-path"] || "/";

  if (!target) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Missing x-relay-target header" }),
    };
  }

  const targetUrl = target.replace(/\\\\/$/, "") + relayPath;
  const forwardHeaders = { ...event.headers };
  for (const k of Object.keys(forwardHeaders)) {
    const lower = k.toLowerCase();
    if (lower === "x-relay-target" || lower === "x-relay-path" || lower === "host") {
      delete forwardHeaders[k];
    }
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: forwardHeaders,
      body: event.httpMethod !== "GET" && event.httpMethod !== "HEAD" && event.body
        ? event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body
        : undefined,
    });
    // Lambda response body must be a string: returning the stream object
    // fails with cannot-unmarshal-object-into-Go-struct-field (live 502).
    // So buffer here: text for API payloads (JSON/SSE), base64 for binary.
    // Tradeoff vs the other relays: SSE arrives buffered, stays valid SSE.
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const contentType = upstream.headers.get("content-type") || "";
    const isText = new RegExp("^(text/|[^;]*json|[^;]*event-stream|[^;]*javascript|[^;]*xml|[^;]*urlencoded)", "i").test(contentType);
    const rawBody = await upstream.arrayBuffer();
    const responseBody = isText
      ? Buffer.from(rawBody).toString("utf8")
      : Buffer.from(rawBody).toString("base64");
    return {
      statusCode: upstream.status,
      headers: responseHeaders,
      body: responseBody,
      isBase64Encoded: !isText,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: error.message || "Relay fetch failed" }),
    };
  }
};
`;

// ─── Variant 2: PanRouter relay ───────────────────────────────────────
// Same header contract, plus:
//   - CORS preflight (OPTIONS) + Access-Control-* headers
//   - SSRF guard: refuses loopback, link-local, RFC1918, and Netlify's own hosts
//   - explicit 9s upstream timeout
// It still has to buffer (the Lambda body is a string), but it returns a
// status/body shape that the OpenAI SSE translator can consume unchanged.
export const NETLIFY_RELAY_STREAM_FUNCTION_CODE = `exports.handler = async function(event) {
  const corsHeaders = () => ({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-max-age": "86400",
  });

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const h = {};
  for (const [k, v] of Object.entries(event.headers || {})) h[k.toLowerCase()] = v;

  const target = h["x-relay-target"];
  const relayPath = h["x-relay-path"] || "";
  if (!target) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ error: "Missing x-relay-target header" }),
    };
  }

  let targetUrl;
  try {
    const cleanTarget = target.endsWith("/") ? target.slice(0, -1) : target;
    const cleanPath = relayPath ? (relayPath.startsWith("/") ? relayPath : "/" + relayPath) : "";
    targetUrl = new URL(cleanTarget + cleanPath);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ error: "Invalid URL: " + e.message }),
    };
  }

  // Minimal safety: never forward to loopback / cloud metadata / Netlify's own
  // infra. Keeps the relay from being a trivial open proxy without blocking
  // legit upstreams (cloudcode-pa, agnes, codebuddy, etc.).
  {
    const host = targetUrl.hostname.toLowerCase();
    const isIp = /^\\\\d{1,3}(\\\\.\\\\d{1,3}){3}$/.test(host);
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") ||
        host === "0.0.0.0" || host.endsWith(".netlify.app") || host.endsWith(".netlify.com") ||
        (isIp && (host.startsWith("169.254.") || host.startsWith("127.") || host.startsWith("10.") ||
                  host.startsWith("192.168.") || host.startsWith("172.")))) {
      return {
        statusCode: 403,
        headers: { ...corsHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ error: "Target not allowed" }),
      };
    }
  }

  const skip = new Set([
    "x-relay-target", "x-relay-path", "host", "connection", "content-length",
    "transfer-encoding", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host",
    "x-nf-request-id", "cdn-loop",
  ]);

  const fwd = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (!skip.has(k.toLowerCase())) fwd[k] = v;
  }

  let res;
  try {
    res = await fetch(targetUrl.toString(), {
      method: event.httpMethod,
      headers: fwd,
      body: event.body && event.httpMethod !== "GET" && event.httpMethod !== "HEAD"
        ? (event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body)
        : undefined,
      signal: AbortSignal.timeout(9000),
    });
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...corsHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ error: "Upstream fetch failed: " + e.message }),
    };
  }

  const rh = { ...corsHeaders() };
  res.headers.forEach((value, key) => { rh[key] = value; });

  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  const isText = /^(text\\\\/|[^;]*json|[^;]*event-stream|[^;]*javascript|[^;]*xml|[^;]*urlencoded)/i.test(ct);

  return {
    statusCode: res.status,
    headers: rh,
    body: isText ? buf.toString("utf8") : buf.toString("base64"),
    isBase64Encoded: !isText,
  };
};
`;

export const NETLIFY_INDEX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>PanRouter Relay</title></head>
<body><p>PanRouter relay function lives at <code>/.netlify/functions/relay</code>.</p></body></html>
`;

export function sha1Hex(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// ─── Minimal stored (uncompressed) ZIP writer ──────────────────────────
// No compression dependency needed: the relay bundle is ~1.5 KB. Stored
// entries are plain CRC32 + headers, verifiable with any unzip tool.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildStoredZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const content = data instanceof Uint8Array ? data : encoder.encode(String(data ?? ""));
    const crc = crc32(content);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 filename flag
    local.setUint16(8, 0, true); // method: stored
    local.setUint32(14, crc, true);
    local.setUint32(18, content.length, true);
    local.setUint32(22, content.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(Buffer.from(local.buffer), Buffer.from(nameBytes), Buffer.from(content));

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true); // central directory signature
    centralHeader.setUint16(8, 0x0800, true); // UTF-8 flag
    centralHeader.setUint16(10, 0, true); // method: stored
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, content.length, true);
    centralHeader.setUint32(24, content.length, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint32(42, offset, true); // local header offset
    central.push(Buffer.from(centralHeader.buffer), Buffer.from(nameBytes));

    offset += 30 + nameBytes.length + content.length;
  }

  const centralStart = offset;
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory signature
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);

  return Buffer.concat([...chunks, ...central, Buffer.from(end.buffer)]);
}

/** Zipped single-file bundle Netlify expects for `runtime=js` uploads. */
export function buildRelayFunctionZip(variant = "upstream") {
  const code = variant === "panrouter"
    ? NETLIFY_RELAY_STREAM_FUNCTION_CODE
    : NETLIFY_RELAY_FUNCTION_CODE;
  const content = new TextEncoder().encode(code);
  const zip = buildStoredZip([{ name: `${NETLIFY_FUNCTION_NAME}.js`, data: content }]);
  return { zip, sha256: sha256Hex(zip) };
}

export function buildIndexFile() {
  const content = new TextEncoder().encode(NETLIFY_INDEX_HTML);
  return { content, sha1: sha1Hex(content) };
}

export function buildRelayUrl(siteUrl) {
  return `${String(siteUrl || "").replace(/\/$/, "")}${NETLIFY_FUNCTION_PATH}`;
}

export function netlifyHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": "PanRouter",
  };
}

export async function pollDeployReady(deployId, token, fetchImpl = fetch, maxMs = 120000, intervalMs = 3000) {
  const start = Date.now();
  for (;;) {
    const res = await fetchImpl(`${NETLIFY_API}/deploys/${deployId}`, {
      headers: netlifyHeaders(token),
    });
    const data = await res.json().catch(() => ({}));
    if (data.state === "ready") return data;
    if (data.state === "error") {
      throw new Error(data.error_message || "Netlify deploy failed");
    }
    if (Date.now() - start > maxMs) throw new Error("Netlify deploy timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
