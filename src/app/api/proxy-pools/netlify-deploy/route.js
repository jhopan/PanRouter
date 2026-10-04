import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import { spawn } from "node:child_process";
import path from "node:path";

const NETLIFY_API = "https://api.netlify.com/api/v1";

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
          send({ step: "error", msg: "Subdomain conflict after 5 attempts" });
          controller.close();
          return;
        }

        const siteId = site.id;
        const siteUrl = site.ssl_url || site.url || `https://${siteName}.netlify.app`;
        send({ step: "created", msg: `Site created: ${siteName}` });

        // Step 2: Deploy function via Netlify CLI engine
        send({ step: "building", msg: "Bundling & deploying function via Netlify engine..." });

        const tmplDir = path.resolve(process.cwd(), "src/lib/templates/netlify-relay");
        const fnDir = path.join(tmplDir, "netlify", "functions");

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
        const cmd = isWin ? "netlify.cmd" : "netlify";

        let stdout = "";
        let stderr = "";

        await new Promise((resolve, reject) => {
          const child = spawn(cmd, args, {
            cwd: tmplDir,
            env: { ...process.env, NETLIFY_AUTH_TOKEN: netlifyToken.trim() },
            shell: isWin,
          });

          const timer = setTimeout(() => {
            child.kill();
            reject(new Error("Netlify deploy process timed out after 60s"));
          }, 60000);

          child.stdout?.on("data", (chunk) => {
            const str = chunk.toString();
            stdout += str;
            if (str.includes("Packaging Functions") || str.includes("bundling")) {
              send({ step: "building", msg: "Packaging relay function..." });
            } else if (str.includes("Uploading") || str.includes("Hashing")) {
              send({ step: "uploading", msg: "Uploading function to Netlify..." });
            } else if (str.includes("Waiting for deploy")) {
              send({ step: "processing", msg: "Waiting for deploy to go live..." });
            }
          });

          child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
          });

          child.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`Deploy failed (exit code ${code}): ${stderr || stdout}`));
          });

          child.on("error", (err) => {
            clearTimeout(timer);
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

        // Step 3: Ensure site is public
        await fetch(`${NETLIFY_API}/sites/${siteId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${netlifyToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ password: null, force_ssl: true }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});

        // Step 4: Save to Proxy Pools
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
