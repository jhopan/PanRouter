import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const NETLIFY_API = "https://api.netlify.com/api/v1";

// Resolve netlify-cli from the installed dependency tree (PanRouter declares
// netlify-cli in cli/package.json, so a global `npm i -g panrouter` installs it
// alongside the app). Falls back to PATH search for standalone setups.
const requireForCli = createRequire(import.meta.url);
let NETLIFY_CLI_BIN = null;
try {
  NETLIFY_CLI_BIN = requireForCli.resolve("netlify-cli/bin/run.js");
} catch { /* not installed as a dep — PATH search below covers it */ }

// Standalone relay function code (CommonJS handler, native Netlify Functions runtime)
const RELAY_CODE = `exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: ""
    };
  }

  const target = (event.headers || {})["x-relay-target"];
  const relayPath = (event.headers || {})["x-relay-path"] || "";
  if (!target) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Missing x-relay-target header" })
    };
  }

  let targetUrl;
  try {
    const cleanTarget = target.endsWith("/") ? target.slice(0, -1) : target;
    const cleanPath = relayPath ? (relayPath.startsWith("/") ? relayPath : "/" + relayPath) : "";
    targetUrl = new URL(cleanTarget + cleanPath);
  } catch(e) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Invalid URL: " + e.message })
    };
  }

  const skip = new Set([
    "x-relay-target",
    "x-relay-path",
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

        // Step 1: Create site via REST API
        send({ step: "creating", msg: `Creating site "${siteName}"...` });
        let site = null;

        for (let attempt = 0; attempt < 5; attempt++) {
          const siteRes = await fetch(`${NETLIFY_API}/sites`, {
            method: "POST",
            headers: { Authorization: `Bearer ${netlifyToken.trim()}`, "Content-Type": "application/json" },
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
          send({ step: "error", msg: "Subdomain conflict after 5 attempts" });
          controller.close();
          return;
        }

        const siteId = site.id;
        const siteUrl = site.ssl_url || site.url || `https://${siteName}.netlify.app`;
        send({ step: "created", msg: `Site created: ${siteName}` });

        // Step 2: Prepare self-contained relay bundle in temp dir
        send({ step: "building", msg: "Preparing relay function bundle..." });

        const tmplDir = path.join(os.tmpdir(), `panrouter-netlify-${siteName}`);
        const fnDir = path.join(tmplDir, "netlify", "functions");
        fs.mkdirSync(fnDir, { recursive: true });
        fs.writeFileSync(path.join(fnDir, "relay.js"), RELAY_CODE, "utf-8");
        fs.writeFileSync(path.join(tmplDir, "netlify.toml"), NETLIFY_TOML, "utf-8");
        fs.writeFileSync(path.join(tmplDir, "package.json"), JSON.stringify({ name: "netlify-relay", version: "1.0.0", private: true }, null, 2), "utf-8");

        // Step 3: Run Netlify CLI deploy engine
        send({ step: "uploading", msg: "Deploying function via Netlify CLI engine..." });

        const args = [
          "deploy",
          "--prod",
          "--no-build",
          "--site", siteId,
          "--auth", netlifyToken.trim(),
          "--dir", tmplDir,
          "--functions", fnDir,
          "--json",
        ];

        const isWin = process.platform === "win32";
        const cmdName = isWin ? "netlify.cmd" : "netlify";

        // Collect extra candidate directories where netlify-cli might reside
        const searchDirs = [
          path.join(process.env.APPDATA || "", "npm"),
          path.join(process.env.LOCALAPPDATA || "", "hermes", "tools", "node-26.7.0-win32-x64"),
          process.cwd(),
          path.join(process.cwd(), "node_modules", ".bin"),
        ];

        let resolvedCmd = cmdName;
        let resolvedRunScript = NETLIFY_CLI_BIN;
        const finalArgs = args;

        if (!resolvedRunScript) {
          for (const dir of searchDirs) {
            const candidate = path.join(dir, cmdName);
            if (candidate && fs.existsSync(candidate)) {
              resolvedCmd = candidate;
              break;
            }
          }
        }

        // Prepend search dirs to PATH so node and other sub-executables are always found
        const extraPath = searchDirs.filter((d) => d && fs.existsSync(d)).join(path.delimiter);
        const childEnv = {
          ...process.env,
          PATH: extraPath ? `${extraPath}${path.delimiter}${process.env.PATH || ""}` : process.env.PATH,
          NETLIFY_AUTH_TOKEN: netlifyToken.trim(),
          CI: "true",
          NETLIFY_TELEMETRY_DISABLE: "1",
        };

        let stdout = "";
        let stderr = "";

        await new Promise((resolve, reject) => {
          // Preferred: run the installed netlify-cli node script directly (works
          // without .cmd shims / shell on any platform). Fallback: PATH-spawn.
          const child = resolvedRunScript
            ? spawn(process.execPath, [resolvedRunScript, ...finalArgs], {
                cwd: tmplDir,
                env: childEnv,
              })
            : spawn(resolvedCmd, finalArgs, {
                cwd: tmplDir,
                env: childEnv,
                shell: isWin,
              });

          // 180 seconds gives comfortable headroom for international uploads & CDN propagation
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error("Netlify deploy process timed out after 180s"));
          }, 180000);

          child.stdout?.on("data", (chunk) => {
            const str = chunk.toString();
            stdout += str;
            const lines = str.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
              if (line.includes("{") && line.includes("}")) continue;
              const clean = line.replace(/[✔⠋❯]/g, "").trim();
              if (clean.length > 3 && clean.length < 100) {
                send({ step: "deploying", msg: clean });
              }
            }
          });

          child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
          });

          child.on("close", (code) => {
            clearTimeout(timer);
            // Clean up temp dir
            try { fs.rmSync(tmplDir, { recursive: true, force: true }); } catch {}
            if (code === 0) resolve();
            else reject(new Error(`Deploy failed (exit code ${code}): ${stderr || stdout}`));
          });

          child.on("error", (err) => {
            clearTimeout(timer);
            try { fs.rmSync(tmplDir, { recursive: true, force: true }); } catch {}
            reject(err);
          });
        });

        // Parse CLI JSON output
        let deployData = {};
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*"site_id"[\s\S]*\}/);
          if (jsonMatch) deployData = JSON.parse(jsonMatch[0]);
        } catch {}

        const deployUrl = deployData.url || siteUrl;
        const finalProxyUrl = `${deployUrl}/.netlify/functions/relay`;
        send({ step: "ready", msg: "Deploy live!" });

        // Step 4: Ensure site is public
        await fetch(`${NETLIFY_API}/sites/${siteId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${netlifyToken.trim()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ password: null, force_ssl: true }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});

        // Step 5: Save to Proxy Pools
        send({ step: "saving", msg: "Saving to PanRouter Proxy Pools..." });
        const proxyPool = await createProxyPool({
          name: siteName,
          proxyUrl: finalProxyUrl,
          type: "netlify",
          noProxy: "",
          isActive: true,
          strictProxy: false,
        });

        const adminUrl = site?.admin_url || `https://app.netlify.com/projects/${siteName}/overview`;
        const accessUrl = `https://app.netlify.com/projects/${siteName}/overview`;

        send({
          step: "done",
          msg: "Relay successfully deployed!",
          deployUrl: finalProxyUrl,
          siteName,
          adminUrl,
          accessUrl,
          proxyPool,
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
