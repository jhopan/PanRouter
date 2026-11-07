import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getAntigravityUsage: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: mocks.getAntigravityUsage,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: mocks.logDebug,
  info: mocks.logInfo,
  warn: mocks.logWarn,
  error: vi.fn(),
}));

const {
  getAntigravityQuotaCache,
  selectAntigravitySkipsToRevalidate,
  revalidateAntigravityExhausted,
  refreshAntigravityQuota,
  _clearRevalidateState,
} = await import("@/sse/services/antigravityQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

// Live sample (VPS, 2026-11-07): a cached gemini_weekly 0% held a healthy
// account out of rotation for 27h while the weekly bucket was really at 99.5%.
const MODEL = "gemini-3.8-flash-high";        // → gemini_weekly family
const FAMILY = "gemini_weekly";
const NOW = Date.parse("2026-11-07T02:02:56.000Z");
const FUTURE = "2026-11-08T05:12:35.000Z";    // the stale cached reset
const PAST = "2026-11-06T00:00:00.000Z";

function conn(id, extra = {}) {
  return { id, accessToken: `tok-${id}`, providerSpecificData: {}, ...extra };
}

function seed(id, bucket) {
  getAntigravityQuotaCache().set(id, { [FAMILY]: bucket });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAntigravityQuotaCache().clear();
  _clearRevalidateState();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("Antigravity pre-skip re-verification", () => {
  it("selects an account whose cached family bucket is exhausted with a future reset", () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    expect(selectAntigravitySkipsToRevalidate([conn("ag-a")], MODEL, NOW)).toEqual(["ag-a"]);
  });

  it("ignores a bucket that still has quota", () => {
    seed("ag-a", { remainingPercentage: 99.55, resetAt: FUTURE });
    expect(selectAntigravitySkipsToRevalidate([conn("ag-a")], MODEL, NOW)).toEqual([]);
  });

  it("ignores a bucket whose reset already passed", () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: PAST });
    expect(selectAntigravitySkipsToRevalidate([conn("ag-a")], MODEL, NOW)).toEqual([]);
  });

  it("ignores accounts with no cached entry", () => {
    expect(selectAntigravitySkipsToRevalidate([conn("ag-a")], MODEL, NOW)).toEqual([]);
  });

  it("ignores accounts without an access token", () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    expect(selectAntigravitySkipsToRevalidate([{ id: "ag-a" }], MODEL, NOW)).toEqual([]);
  });

  it("returns nothing when the model has no known family bucket", () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    expect(selectAntigravitySkipsToRevalidate([conn("ag-a")], "xmodel-1", NOW)).toEqual([]);
  });

  it("respects the re-verify cooldown so a genuinely exhausted account is not polled every call", async () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    const refresh = vi.fn().mockResolvedValue(null);

    await revalidateAntigravityExhausted([conn("ag-a")], MODEL, { now: NOW, refresh });
    expect(refresh).toHaveBeenCalledTimes(1);

    // Still exhausted (the mock did not rewrite the cache) → cooldown holds.
    await revalidateAntigravityExhausted([conn("ag-a")], MODEL, { now: NOW + 30_000, refresh });
    expect(refresh).toHaveBeenCalledTimes(1);

    // Past the cooldown → verified again.
    await revalidateAntigravityExhausted([conn("ag-a")], MODEL, { now: NOW + 5 * 60_000 + 1, refresh });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("clears the stale block when the fresh reading has quota again", async () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    const refresh = vi.fn(async (id) => {
      // What refreshAntigravityQuota does: replace the entry with the live reading.
      getAntigravityQuotaCache().set(id, { [FAMILY]: { remainingPercentage: 99.55, resetAt: "2026-11-14T02:02:40.000Z" } });
    });

    await revalidateAntigravityExhausted([conn("ag-a")], MODEL, { now: NOW, refresh });

    expect(refresh).toHaveBeenCalledWith("ag-a", "tok-ag-a", {});
    // The account is no longer a candidate for skipping.
    expect(selectAntigravitySkipsToRevalidate([conn("ag-a")], MODEL, NOW)).toEqual([]);
  });

  it("is fail-open: a throwing refresh never rejects or blocks the request", async () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    const refresh = vi.fn().mockRejectedValue(new Error("quota API down"));
    await expect(
      revalidateAntigravityExhausted([conn("ag-a")], MODEL, { now: NOW, refresh }),
    ).resolves.toBeUndefined();
  });

  it("uses the real refreshAntigravityQuota by default", () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    expect(typeof refreshAntigravityQuota).toBe("function");
  });
});

describe("Antigravity pre-skip re-verification wired into credential selection", () => {
  it("re-verifies before skipping, so a healthy account is not locked out", async () => {
    // Cached reading says exhausted; the live endpoint says the weekly bucket is
    // nearly empty of usage. The selector must refresh, then serve the account.
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    mocks.getProviderConnections.mockResolvedValue([conn("ag-a")]);
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: { [FAMILY]: { remainingPercentage: 99.55, resetAt: "2026-11-14T02:02:40.000Z" } },
    });

    const result = await getProviderCredentials("antigravity", null, MODEL);

    expect(mocks.getAntigravityUsage).toHaveBeenCalled();
    expect(result?.connectionId).toBe("ag-a");
    expect(result?.allRateLimited).toBeFalsy();
  });

  it("still skips when the fresh reading confirms exhaustion", async () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    mocks.getProviderConnections.mockResolvedValue([conn("ag-a")]);
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: { [FAMILY]: { remainingPercentage: 0, resetAt: FUTURE } },
    });

    const result = await getProviderCredentials("antigravity", null, MODEL);

    expect(result?.allRateLimited).toBe(true);
  });

  it("does not print a bare 'undefined' when the skip came from the quota cache, not a connection lock", async () => {
    seed("ag-a", { remainingPercentage: 0, resetAt: FUTURE });
    mocks.getProviderConnections.mockResolvedValue([conn("ag-a")]);
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: { [FAMILY]: { remainingPercentage: 0, resetAt: FUTURE } },
    });

    await getProviderCredentials("antigravity", null, MODEL);

    const lines = mocks.logWarn.mock.calls
      .map(([, msg]) => String(msg))
      .filter((m) => m.includes("accounts locked"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain("undefined");
  });
});
