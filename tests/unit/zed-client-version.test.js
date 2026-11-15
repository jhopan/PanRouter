/**
 * Unit tests for open-sse/utils/zedClientVersion.js
 *
 * The advertised Zed version is a wire fingerprint: the captured pin (0.200.0)
 * is the floor and a newer zed-industries/zed release may raise it. The lookup
 * must be fire-and-forget — a failed or cold fetch keeps the floor and never
 * throws into the request path — and a newer value must never be traded back
 * down for an older tag.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fresh module state per test: the helper caches the resolved version, the
// next-check timestamp and the in-flight promise at module scope.
async function load() {
  vi.resetModules();
  return import("../../open-sse/utils/zedClientVersion.js");
}

function releaseResponse(tag) {
  return new Response(JSON.stringify({ tag_name: tag }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  // Suppress the sync getter's background lookup so each test drives the
  // refresh explicitly (mirrors OmniRoute's NODE_TEST_CONTEXT guard).
  vi.stubEnv("NODE_TEST_CONTEXT", "1");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("zed client version floor", () => {
  it("returns the pin before any lookup", async () => {
    const mod = await load();
    expect(mod.ZED_CLIENT_VERSION).toBe("0.200.0");
    expect(mod.getZedClientVersion()).toBe("0.200.0");
  });

  it("keeps the floor when the fetch rejects", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(mod.refreshZedClientVersion(fetchMock)).resolves.toBe("0.200.0");
    expect(mod.getZedClientVersion()).toBe("0.200.0");
  });

  it("keeps the floor on a non-ok response", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));

    await expect(mod.refreshZedClientVersion(fetchMock)).resolves.toBe("0.200.0");
    expect(mod.getZedClientVersion()).toBe("0.200.0");
  });

  it("keeps the floor when the tag is not a dotted triple", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => releaseResponse("nightly"));

    await expect(mod.refreshZedClientVersion(fetchMock)).resolves.toBe("0.200.0");
  });

  it("never downgrades below the pin", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => releaseResponse("v0.199.9"));

    await expect(mod.refreshZedClientVersion(fetchMock)).resolves.toBe("0.200.0");
    expect(mod.getZedClientVersion()).toBe("0.200.0");
  });
});

describe("zed client version refresh", () => {
  it("adopts a newer release and strips the v prefix", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => releaseResponse("v0.210.3"));

    await expect(mod.refreshZedClientVersion(fetchMock)).resolves.toBe("0.210.3");
    expect(mod.getZedClientVersion()).toBe("0.210.3");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/zed-industries/zed/releases/latest");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("serves the cached version inside the TTL without refetching", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => releaseResponse("v0.210.3"));

    await mod.refreshZedClientVersion(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(mod.ZED_VERSION_CACHE_TTL_MS / 2);
    expect(mod.getZedClientVersion()).toBe("0.210.3");
    await expect(mod.refreshZedClientVersion(fetchMock)).resolves.toBe("0.210.3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest seen version after the TTL expires, without a sync refetch", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => releaseResponse("v0.210.3"));

    await mod.refreshZedClientVersion(fetchMock);
    vi.advanceTimersByTime(mod.ZED_VERSION_CACHE_TTL_MS + 1);

    // The stale cache stays monotonic (never drops below a seen release), and
    // the sync getter itself never waits on the network.
    expect(mod.getZedClientVersion()).toBe("0.210.3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never downgrades below a previously seen newer release", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => releaseResponse("v0.210.3"));
    await mod.refreshZedClientVersion(fetchMock);

    // Cache expired, and GitHub hands back an older (but still above-pin) tag.
    vi.advanceTimersByTime(mod.ZED_VERSION_CACHE_TTL_MS + 1);
    const older = vi.fn(async () => releaseResponse("v0.205.0"));
    await expect(mod.refreshZedClientVersion(older)).resolves.toBe("0.210.3");
    expect(mod.getZedClientVersion()).toBe("0.210.3");
  });

  it("coalesces concurrent refreshes into one request", async () => {
    const mod = await load();
    let resolveFetch;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve(releaseResponse("v0.211.0"));
        }),
    );

    const first = mod.refreshZedClientVersion(fetchMock);
    const second = mod.refreshZedClientVersion(fetchMock);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch();
    await expect(first).resolves.toBe("0.211.0");
    await expect(second).resolves.toBe("0.211.0");
  });

  it("aborts a hanging lookup after the timeout and keeps the floor", async () => {
    const mod = await load();
    const fetchMock = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const pending = mod.refreshZedClientVersion(fetchMock);
    await vi.advanceTimersByTimeAsync(mod.ZED_VERSION_FETCH_TIMEOUT_MS);
    await expect(pending).resolves.toBe("0.200.0");
  });

  it("waits out the retry window after a failure before asking again", async () => {
    const mod = await load();
    vi.unstubAllEnvs(); // allow the sync getter to start its own lookup

    const failing = vi.fn(async () => {
      throw new Error("rate limited");
    });
    await mod.refreshZedClientVersion(failing);

    vi.stubGlobal("fetch", vi.fn(async () => releaseResponse("v0.210.3")));
    expect(mod.getZedClientVersion()).toBe("0.200.0");
    expect(globalThis.fetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(mod.ZED_VERSION_RETRY_AFTER_FAILURE_MS + 1);
    expect(mod.getZedClientVersion()).toBe("0.200.0");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(0);
    expect(mod.getZedClientVersion()).toBe("0.210.3");
  });

  it("resetZedClientVersionCache forces the next lookup", async () => {
    const mod = await load();
    const fetchMock = vi.fn(async () => releaseResponse("v0.210.3"));
    await mod.refreshZedClientVersion(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mod.resetZedClientVersionCache();
    expect(mod.getZedClientVersion()).toBe("0.200.0");

    await mod.refreshZedClientVersion(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});