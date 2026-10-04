import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import zlib from "node:zlib";

const NETLIFY_API = "https://api.netlify.com/api/v1";

// Relay function code (CommonJS handler, native Node.js runtime)
const RELAY_CODE = `exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: ""
    };
  }

  const target = (event.headers || {})["x-relay-target"];
  if (!target) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Missing x-relay-target header" })
    };
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch(e) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Invalid URL: " + e.message })
    };
  }

  const skip = new Set([
    "x-relay-target",
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "x-nf-request-id",
    "cdn-loop"
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
  } catch(e) {
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Upstream fetch failed: " + e.message })
    };
  }

  const rh = corsHeaders();
  const skipR = new Set(["transfer-encoding", "connection", "keep-alive", "content-encoding"]);
  for (const [k, v] of res.headers.entries()) {
    if (!skipR.has(k.toLowerCase())) rh[k] = v;
  }

  const body = await res.text();
  return {
    statusCode: res.status,
    headers: rh,
    body
  };
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
}
`;

const NETLIFY_TOML = `[build]
  functions = "netlify/functions"

[[redirects]]
  from = "/*"
  to = "/.netlify/functions/relay"
  status = 200
  force = true
`;

// Pure Node.js in-memory ZIP builder (fast, standard ZIP format)
function createZipBuffer(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const [filePath, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const fname = Buffer.from(filePath, "utf-8");

    // Local file header (30 bytes)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    lh.writeUInt16LE(20, 4);         // version needed
    lh.writeUInt16LE(0, 6);          // flags
    lh.writeUInt16LE(8, 8);          // method 8 (deflate)
    lh.writeUInt16LE(0, 10);         // time
    lh.writeUInt16LE(0, 12);         // date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(fname.length, 26);
    lh.writeUInt16LE(0, 28);         // extra len

    const localEntry = Buffer.concat([lh, fname, compressed]);
    localHeaders.push(localEntry);

    // Central directory header (46 bytes)
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    ch.writeUInt16LE(20, 4);         // version made by
    ch.writeUInt16LE(20, 6);         // version needed
    ch.writeUInt16LE(0, 8);          // flags
    ch.writeUInt16LE(8, 10);         // method 8
    ch.writeUInt16LE(0, 12);         // time
    ch.writeUInt16LE(0, 14);         // date
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(fname.length, 28);
    ch.writeUInt16LE(0, 30);         // extra len
    ch.writeUInt16LE(0, 32);         // comment len
    ch.writeUInt16LE(0, 34);         // disk start
    ch.writeUInt16LE(0, 36);         // internal attr
    ch.writeUInt32LE(0, 38);         // external attr
    ch.writeUInt32LE(offset, 42);    // offset

    centralHeaders.push(Buffer.concat([ch, fname]));
    offset += localEntry.length;
  }

  const centralDir = Buffer.concat(centralHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // start disk
  const count = Object.keys(files).length;
  eocd.writeUInt16LE(count, 8);      // entries on disk
  eocd.writeUInt16LE(count, 10);     // total entries
  eocd.writeUInt32LE(centralDir.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 16);    // central dir offset
  eocd.writeUInt16LE(0, 20);         // comment len

  return Buffer.concat([...localHeaders, centralDir, eocd]);
}

async function pollDeploy(deployId, token, onState, maxMs = 90000) {
  const start = Date.now();
  let lastState = "";
  while (Date.now() - start < maxMs) {
    const r = await fetch(`${NETLIFY_API}/deploys/${deployId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    if (d.state && d.state !== lastState) {
      lastState = d.state;
      onState?.(d.state);
    }
    if (d.state === "ready") return d;
    if (d.state === "error") throw new Error(`Deploy failed: ${d.error_message || d.state}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Deploy timed out after 90 seconds");
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { netlifyToken, projectName: rawName } = body;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch { /* stream closed */ }
      };

      try {
        if (!netlifyToken?.trim()) {
          send({ step: "error", msg: "Netlify personal access token is required" });
          controller.close();
          return;
        }

        function genName(base) {
          const suffix = Math.random().toString(36).slice(2, 8);
          const clean = (base?.trim() || "panrouter")
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "") || "panrouter";
          return `${clean}-${suffix}`;
        }

        let siteName = rawName?.trim()
          ? rawName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
          : genName("panrouter");

        // Step 1: Create site
        send({ step: "creating", msg: `Creating site "${siteName}"...` });
        let site = null;

        for (let attempt = 0; attempt < 5; attempt++) {
          const siteRes = await fetch(`${NETLIFY_API}/sites`, {
            method: "POST",
            headers: { Authorization: `Bearer ${netlifyToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: siteName }),
            signal: AbortSignal.timeout(10000),
          });

          if (siteRes.ok) {
            site = await siteRes.json();
            break;
          }

          const err = await siteRes.json().catch(() => ({}));
          const isConflict = siteRes.status === 422 &&
            (JSON.stringify(err).toLowerCase().includes("subdomain") ||
             JSON.stringify(err).toLowerCase().includes("taken") ||
             JSON.stringify(err).toLowerCase().includes("already"));

          if (isConflict) {
            siteName = genName(rawName?.trim() || "panrouter");
            send({ step: "creating", msg: `Name taken, retrying as "${siteName}"...` });
            continue;
          }

          const errMsg = err.message
            || (typeof err.errors === "object" ? JSON.stringify(err.errors) : err.errors)
            || JSON.stringify(err)
            || "Failed to create site";
          send({ step: "error", msg: String(errMsg) });
          controller.close();
          return;
        }

        if (!site) {
          send({ step: "error", msg: `Subdomain conflict after 5 attempts` });
          controller.close();
          return;
        }

        const siteId = site.id;
        const siteUrl = site.ssl_url || site.url || `https://${siteName}.netlify.app`;
        send({ step: "created", msg: `Site created: ${siteName}` });

        // Step 2: Build & Upload Zip directly
        send({ step: "uploading", msg: "Uploading relay bundle (ZIP)..." });
        const zipBuffer = createZipBuffer({
          "netlify/functions/relay.js": RELAY_CODE,
          "netlify.toml": NETLIFY_TOML,
          "package.json": JSON.stringify({ name: "netlify-relay", version: "1.0.0", private: true }, null, 2),
        });

        const deployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${netlifyToken}`,
            "Content-Type": "application/zip",
          },
          body: zipBuffer,
          signal: AbortSignal.timeout(25000),
        });

        if (!deployRes.ok) {
          const err = await deployRes.json().catch(() => ({}));
          send({ step: "error", msg: err.message || `Deploy creation failed (${deployRes.status})` });
          controller.close();
          return;
        }

        const deploy = await deployRes.json();
        const deployId = deploy.id;
        send({ step: "building", msg: "Building function on Netlify..." });

        // Step 3: Poll deploy state
        const stateLabels = {
          uploading: "Uploading bundle...",
          uploaded: "Files received, building...",
          processing: "Processing functions...",
          building: "Building functions...",
          ready: "Deploy ready!",
        };

        const ready = await pollDeploy(deployId, netlifyToken, (state) => {
          send({ step: state, msg: stateLabels[state] || `State: ${state}` });
        });

        const deployUrl = ready.ssl_url || ready.url || siteUrl;
        send({ step: "ready", msg: "Deploy live!" });

        // Step 4: Ensure site is public (disable edge-access/password protection)
        await fetch(`${NETLIFY_API}/sites/${siteId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${netlifyToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ password: null, force_ssl: true }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});

        // Step 5: Save to Proxy Pools
        send({ step: "saving", msg: "Saving to PanRouter Proxy Pools..." });
        const finalProxyUrl = `${deployUrl}/.netlify/functions/relay`;
        const proxyPool = await createProxyPool({
          name: siteName,
          proxyUrl: finalProxyUrl,
          type: "netlify",
          noProxy: "",
          isActive: true,
          strictProxy: false,
        });

        const adminUrl = site?.admin_url || `https://app.netlify.com/projects/${siteName}`;
        const accessUrl = `https://app.netlify.com/projects/${siteName}/overview`;

        send({
          step: "done",
          msg: "Relay successfully deployed!",
          deployUrl: finalProxyUrl,
          siteName,
          adminUrl,
          accessUrl,
          proxyPool
        });
      } catch (err) {
        send({ step: "error", msg: err.message || "Deploy failed" });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
