// CACHE_BLOCK persistence: an exhausted Antigravity bucket must survive a
// server restart / PanRouter update. Only entries with remainingPercentage 0
// AND a future resetAt are persisted — healthy readings and the 15-minute
// strike blocks stay in memory.
import { describe, expect, it, vi, beforeEach } from "vitest";

const store = new Map();

vi.mock("@/lib/db/helpers/kvStore", () => ({
  makeKv: () => ({
    async get(key, fallback = null) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async getAll() {
      return Object.fromEntries(store);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async setMany(obj) {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
    },
    async remove(key) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
  }),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));

vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: vi.fn(async () => ({ quotas: {} })),
}));

vi.mock("../utils/logger.js", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

const {
  loadPersistedAntigravityQuota,
  getAntigravityQuotaCache,
  refreshAntigravityQuota,
} = await import("../../src/sse/services/antigravityQuota.js");

const { getAntigravityUsage } = await import("open-sse/services/usage/google.js");

const CONN = "conn-abc-123";

describe("Antigravity CACHE_BLOCK persistence", () => {
  beforeEach(() => {
    store.clear();
    getAntigravityQuotaCache().clear();
    vi.clearAllMocks();
  });

  it("restores an exhausted bucket written before a restart", async () => {
    const resetAt = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString();
    store.set(CONN, { claude_gpt_weekly: { remainingPercentage: 0, resetAt } });

    await loadPersistedAntigravityQuota();

    const cache = getAntigravityQuotaCache();
    expect(cache.get(CONN)?.claude_gpt_weekly).toEqual({ remainingPercentage: 0, resetAt });
  });

  it("drops entries whose resetAt already passed and cleans the row", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    store.set(CONN, { claude_gpt_weekly: { remainingPercentage: 0, resetAt: past } });

    await loadPersistedAntigravityQuota();

    expect(getAntigravityQuotaCache().has(CONN)).toBe(false);
    expect(store.has(CONN)).toBe(false);
  });

  it("never restores a healthy reading (remainingPercentage > 0)", async () => {
    const resetAt = new Date(Date.now() + 3600_000).toISOString();
    store.set(CONN, { claude_gpt_weekly: { remainingPercentage: 42, resetAt } });

    await loadPersistedAntigravityQuota();

    expect(getAntigravityQuotaCache().has(CONN)).toBe(false);
  });

  it("persists a fresh exhausted reading and clears it once healthy", async () => {
    const resetAt = new Date(Date.now() + 3600_000).toISOString();
    getAntigravityUsage.mockResolvedValueOnce({
      quotas: { claude_gpt_weekly: { remainingPercentage: 0, resetAt } },
    });

    await refreshAntigravityQuota(CONN, "token", {});
    // allow the fire-and-forget KV write to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(store.get(CONN)?.claude_gpt_weekly).toEqual({ remainingPercentage: 0, resetAt });

    // A later healthy refresh must clear the persisted row.
    getAntigravityUsage.mockResolvedValueOnce({
      quotas: { claude_gpt_weekly: { remainingPercentage: 80, resetAt } },
    });
    // bypass the 30s refresh throttle by advancing the clock
    vi.setSystemTime(Date.now() + 60_000);
    await refreshAntigravityQuota(CONN, "token", {});
    await new Promise((r) => setTimeout(r, 10));

    expect(store.has(CONN)).toBe(false);
  });

  it("survives a KV failure without throwing", async () => {
    store.set(CONN, { claude_gpt_weekly: { remainingPercentage: 0, resetAt: new Date(Date.now() + 3600_000).toISOString() } });
    // Force getAll to throw by replacing the store with a poison object.
    const original = store.getAll;
    store.getAll = () => {
      throw new Error("db unavailable");
    };
    try {
      await expect(loadPersistedAntigravityQuota()).resolves.toBeUndefined();
    } finally {
      store.getAll = original;
    }
  });
});
