import { NextResponse } from "next/server";
import { getProxyPoolById, updateProxyPool } from "@/models";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { fetch as undiciFetch } from "undici";

async function testVercelRelay(relayUrl, timeoutMs = 20000) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Also fetch egress IP via icanhazip.com through the relay
  let egressIp = null;
  try {
    const ipRes = await undiciFetch(relayUrl, {
      method: "GET",
      headers: { "x-relay-target": "https://icanhazip.com" },
      signal: AbortSignal.timeout(8000),
    });
    if (ipRes.ok) {
      egressIp = (await ipRes.text()).trim().replace(/[^0-9a-f:.]/gi, "") || null;
    }
  } catch { /* non-fatal */ }

  try {
    // Probe a host that is fast and reliable. httpbin.org was the original
    // target but it is frequently slow or down, so a healthy relay reported
    // "failed". api.ipify.org answers in ~50ms and needs no path handling.
    const res = await undiciFetch(relayUrl, {
      method: "GET",
      headers: {
        "x-relay-target": "https://api.ipify.org",
        "x-relay-path": "/?format=text",
      },
      signal: controller.signal,
    });
    const body = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - startedAt,
      egressIp: egressIp || (res.ok ? body.trim().replace(/[^0-9a-f:.]/gi, "") || null : null),
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err?.name === "AbortError"
        ? `Relay test timed out after ${Math.round(timeoutMs / 1000)}s`
        : (err?.message || String(err)),
      egressIp,
    };
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/proxy-pools/[id]/test - Test proxy pool entry
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const result = proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno" || proxyPool.type === "netlify" || proxyPool.proxyUrl?.includes("netlify.app")
      ? await testVercelRelay(proxyPool.proxyUrl)
      : await testProxyUrl({ proxyUrl: proxyPool.proxyUrl });
    const now = new Date().toISOString();

    await updateProxyPool(id, {
      testStatus: result.ok ? "active" : "error",
      lastTestedAt: now,
      lastError: result.ok ? null : (result.error || `Proxy test failed with status ${result.status}`),
      isActive: result.ok,
      ...(result.egressIp ? { egressIp: result.egressIp } : {}),
    });

    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      statusText: result.statusText || null,
      error: result.error || null,
      elapsedMs: result.elapsedMs || 0,
      testedAt: now,
    });
  } catch (error) {
    console.log("Error testing proxy pool:", error);
    return NextResponse.json({ error: "Failed to test proxy pool" }, { status: 500 });
  }
}
