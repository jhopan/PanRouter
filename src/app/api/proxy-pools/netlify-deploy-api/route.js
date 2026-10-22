import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import {
  NETLIFY_API,
  NETLIFY_FUNCTION_NAME,
  buildIndexFile,
  buildRelayFunctionZip,
  buildRelayUrl,
  netlifyHeaders,
  pollDeployReady,
} from "@/lib/network/netlifyRelay.js";

// Netlify relay deploy via the Netlify REST API — no CLI, no extra packages.
// Deploy plumbing ported from upstream 9router (fast: ~5s vs 60-180s for the
// netlify-cli route at /api/proxy-pools/netlify-deploy).
//
// The relay function deployed is PanRouter's own: CORS preflight, SSRF guard,
// 9s upstream timeout. It still buffers the body because a digest-deployed
// Lambda function must return a string, not a stream.

function sanitizeSiteName(raw) {
  const name = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!name) return `relay-${Date.now().toString(36)}`;
  // Netlify site names become subdomains: lowercase alphanumerics + hyphens.
  const cleaned = name.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || `relay-${Date.now().toString(36)}`;
}

/** Append a short random suffix so a taken name does not abort the deploy. */
function withUniqueSuffix(base) {
  const suffix = Math.random().toString(36).slice(2, 7);
  const trimmed = base.length > 40 ? base.slice(0, 40) : base;
  return `${trimmed}-${suffix}`;
}

/**
 * Create a Netlify site, retrying with a unique suffix when the name is taken.
 * Netlify answers 422 for a duplicate name; the old code turned that into a
 * hard 409 and the user had to invent a name by hand every time.
 */
async function createSite(headers, siteName) {
  const attempt = async (name) =>
    fetch(`${NETLIFY_API}/sites`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name }),
    });

  let res = await attempt(siteName);
  let usedName = siteName;
  let created = res.ok;

  // Only retry when the NAME collided — a 401/403/500 must surface as-is.
  for (let i = 0; i < 3 && !created && res.status === 422; i += 1) {
    usedName = withUniqueSuffix(siteName);
    res = await attempt(usedName);
    created = res.ok;
  }

  return { res, usedName, created };
}

async function readError(res, fallback) {
  const data = await res.json().catch(() => ({}));
  return data.message || data.error || fallback;
}

// POST /api/proxy-pools/netlify-deploy-api
export async function POST(request) {
  try {
    const body = await request.json();
    const netlifyToken = body.netlifyToken?.trim?.() ?? body.netlifyToken;
    const siteName = sanitizeSiteName(body.projectName ?? body.siteName);

    if (!netlifyToken) {
      return NextResponse.json({ error: "Netlify API token is required" }, { status: 400 });
    }

    const headers = {
      ...netlifyHeaders(netlifyToken),
      "Content-Type": "application/json",
    };

    // 1. Create site (name → <name>.netlify.app). A taken name retries with a
    // random suffix instead of failing the whole deploy.
    const { res: siteRes, usedName, created } = await createSite(headers, siteName);

    if (!created) {
      const message = await readError(siteRes, "Failed to create Netlify site");
      const status = siteRes.status === 422 ? 409 : siteRes.status;
      const hint =
        siteRes.status === 422
          ? ` Site name "${siteName}" is taken and every generated suffix collided too.`
          : "";
      return NextResponse.json({ error: `${message}.${hint}` }, { status });
    }

    const site = await siteRes.json();
    const siteId = site.id || site.site_id;
    const siteUrl = site.ssl_url || site.url;
    if (!siteId || !siteUrl) {
      return NextResponse.json({ error: "Netlify site created but no site URL returned" }, { status: 502 });
    }

    // 2. Digest deploy: index.html (SHA1) + relay function bundle (SHA256).
    const { zip, sha256 } = buildRelayFunctionZip();
    const { content: indexContent, sha1 } = buildIndexFile();

    const deployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        files: { "/index.html": sha1 },
        functions: { [NETLIFY_FUNCTION_NAME]: sha256 },
      }),
    });

    if (!deployRes.ok) {
      return NextResponse.json(
        { error: await readError(deployRes, "Failed to create Netlify deploy") },
        { status: deployRes.status }
      );
    }

    const deploy = await deployRes.json();
    const deployId = deploy.id;
    if (!deployId) {
      return NextResponse.json({ error: "Netlify deploy created but no deploy ID returned" }, { status: 502 });
    }

    // 3. Upload only what Netlify asks for (dedupe via `required` lists).
    //
    // Netlify returns `required_functions` only for digests it does not already
    // have. When the list is empty the upload is skipped — which is correct for
    // a re-deploy of identical bytes, but it also means a silent no-op if the
    // function was never stored. Verify the function actually exists after the
    // deploy is ready, and upload it once more if it does not.
    const requiredFiles = new Set(deploy.required || []);
    const requiredFunctions = new Set(deploy.required_functions || []);

    const uploadFunction = () =>
      fetch(
        `${NETLIFY_API}/deploys/${deployId}/functions/${NETLIFY_FUNCTION_NAME}?runtime=js`,
        {
          method: "PUT",
          headers: { ...netlifyHeaders(netlifyToken), "Content-Type": "application/octet-stream" },
          body: zip,
        }
      );

    if (requiredFiles.has(sha1)) {
      const fileRes = await fetch(`${NETLIFY_API}/deploys/${deployId}/files/index.html`, {
        method: "PUT",
        headers: { ...netlifyHeaders(netlifyToken), "Content-Type": "application/octet-stream" },
        body: Buffer.from(indexContent),
      });
      if (!fileRes.ok) {
        return NextResponse.json(
          { error: await readError(fileRes, "Failed to upload site file to Netlify") },
          { status: fileRes.status }
        );
      }
    }

    // Netlify asks for the function digest unless it already has those exact
    // bytes. Upload when asked; the post-deploy check below covers the case
    // where the list was empty but the function is not actually served.
    let functionUploaded = false;
    if (requiredFunctions.has(sha256)) {
      const fnRes = await uploadFunction();
      if (!fnRes.ok) {
        return NextResponse.json(
          { error: await readError(fnRes, "Failed to upload relay function to Netlify") },
          { status: fnRes.status }
        );
      }
      functionUploaded = true;
    }

    // 4. Poll until the deploy is live.
    await pollDeployReady(deployId, netlifyToken);

    // 5. Verify the relay function is actually reachable. A digest deploy can
    // report "ready" while the function was never stored (empty
    // required_functions on a brand-new site), and the pool would then be
    // created pointing at a 404. Probe once, re-upload once, then probe again.
    const relayUrl = buildRelayUrl(siteUrl);
    const probeRelay = async () => {
      try {
        const res = await fetch(relayUrl, {
          method: "GET",
          headers: {
            "x-relay-target": "https://api.ipify.org",
            "x-relay-path": "/?format=text",
          },
          signal: AbortSignal.timeout(15000),
        });
        return res.status;
      } catch {
        return 0;
      }
    };

    let probeStatus = await probeRelay();
    if (probeStatus === 404 || probeStatus === 0) {
      // Give Netlify a moment, then retry the upload and probe again.
      await new Promise((r) => setTimeout(r, 4000));
      if (!functionUploaded) await uploadFunction().catch(() => {});
      await new Promise((r) => setTimeout(r, 4000));
      probeStatus = await probeRelay();
    }
    const relayUrl = buildRelayUrl(siteUrl);

    // Create proxy pool entry with type netlify
    const proxyPool = await createProxyPool({
      name: usedName,
      proxyUrl: relayUrl,
      type: "netlify",
      noProxy: "",
      isActive: true,
      strictProxy: false,
    });

    // The dashboard result modal reads deployUrl + accessUrl + siteName; the
    // upstream 9router route only returned deployUrl, which left "Salin Link
    // Pengaturan" copying `undefined`.
    return NextResponse.json(
      {
        proxyPool,
        deployUrl: relayUrl,
        siteName: usedName,
        siteUrl,
        accessUrl: `https://app.netlify.com/projects/${usedName}/overview`,
        adminUrl: `https://app.netlify.com/sites/${usedName}`,
        // Reported so the dashboard can warn when the pool points at a relay
        // that never actually got stored.
        relayStatus: probeStatus,
        relayOk: probeStatus === 200,
      },
      { status: 201 },
    );
  } catch (error) {
    console.log("Error deploying Netlify relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}
