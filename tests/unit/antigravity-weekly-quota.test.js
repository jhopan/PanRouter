import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock proxyAwareFetch before any imports that use it
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  parseWeeklyQuotaSummary,
  fetchAntigravityWeeklyQuota,
  _clearWeeklyCache,
} from "../../open-sse/services/usage/antigravity-weekly.js";

// — Fixtures ——————————————————————————————————————————————
const GEMINI_GROUP = {
  displayName: "Gemini Models",
  buckets: [
    {
      bucketId: "gemini-weekly-bucket",
      displayName: "Weekly Limit",
      remainingFraction: 0.75,
      resetTime: "2026-09-15T00:00:00Z",
    },
    {
      bucketId: "gemini-daily-bucket",
      displayName: "Daily Limit",
      remainingFraction: 0.9,
      resetTime: "2026-09-09T00:00:00Z",
    },
  ],
};

const CLAUDE_GPT_GROUP = {
  displayName: "Claude and GPT models",
  buckets: [
    {
      bucketId: "claude-gpt-weekly",
      displayName: "Weekly Quota",
      remainingFraction: 0.5,
      resetTime: "2026-09-14T00:00:00Z",
    },
  ],
};

const GEMINI_ARGON_GROUP = {
  displayName: "Gemini 4 Argon",
  buckets: [
    {
      bucketId: "gemini-argon-wtu-weekly",
      displayName: "Gemini 4 Argon Weekly Limit",
      remainingFraction: 0.43,
      resetTime: "2026-09-10T08:17:00Z",
    },
  ],
};

// Argon's display name also contains "Gemini": the group list keeps Argon AFTER
// the Gemini group on purpose, so the ordering test below fails if the matcher
// order ever stops being argon-first.
const FULL_RESPONSE = { groups: [GEMINI_GROUP, CLAUDE_GPT_GROUP, GEMINI_ARGON_GROUP] };

const NESTED_RESPONSE = {
  quotaSummary: {
    groups: [GEMINI_GROUP, CLAUDE_GPT_GROUP, GEMINI_ARGON_GROUP],
  },
};

// — parseWeeklyQuotaSummary ———————————————————————————————
describe("parseWeeklyQuotaSummary", () => {
  it("extracts Gemini weekly quota from top-level groups", () => {
    const result = parseWeeklyQuotaSummary(FULL_RESPONSE);
    expect(result.gemini_weekly).toMatchObject({
      used: 250,
      total: 1000,
      remainingPercentage: 75,
      displayName: "Gemini (Weekly)",
      unlimited: false,
    });
    expect(result.gemini_weekly.resetAt).toBe("2026-09-15T00:00:00.000Z");
  });

  it("extracts Claude & GPT weekly quota", () => {
    const result = parseWeeklyQuotaSummary(FULL_RESPONSE);
    expect(result.claude_gpt_weekly).toMatchObject({
      used: 500,
      total: 1000,
      remainingPercentage: 50,
      displayName: "Claude & GPT (Weekly)",
      unlimited: false,
    });
    expect(result.claude_gpt_weekly.resetAt).toBe("2026-09-14T00:00:00.000Z");
  });

  it("extracts Gemini 4 Argon weekly quota into its own bucket", () => {
    const result = parseWeeklyQuotaSummary(FULL_RESPONSE);
    expect(result.gemini_argon_weekly).toMatchObject({
      used: 570,
      total: 1000,
      remainingPercentage: 43,
      displayName: "Gemini 4 Argon (Weekly)",
      unlimited: false,
    });
    expect(result.gemini_argon_weekly.resetAt).toBe("2026-09-10T08:17:00.000Z");
  });

  it("keeps Argon out of the shared Gemini bucket regardless of group order", () => {
    const argonFirst = { groups: [GEMINI_ARGON_GROUP, GEMINI_GROUP] };
    for (const response of [FULL_RESPONSE, argonFirst]) {
      const result = parseWeeklyQuotaSummary(response);
      expect(result.gemini_weekly.remainingPercentage).toBe(75);
      expect(result.gemini_weekly.resetAt).toBe("2026-09-15T00:00:00.000Z");
      expect(result.gemini_argon_weekly.remainingPercentage).toBe(43);
    }
  });

  it("ignores the Argon 5h session bucket (weekly-only parser)", () => {
    const data = {
      groups: [{
        displayName: "Gemini 4 Argon",
        buckets: [{
          bucketId: "gemini-argon-5h",
          displayName: "Gemini 4 Argon 5h Limit",
          remainingFraction: 0.9,
          resetTime: "2026-09-10T12:00:00Z",
        }],
      }],
    };
    expect(parseWeeklyQuotaSummary(data)).toEqual({});
  });

  it("handles alternate nested quotaSummary.groups shape", () => {
    const result = parseWeeklyQuotaSummary(NESTED_RESPONSE);
    expect(result.gemini_weekly).toBeDefined();
    expect(result.claude_gpt_weekly).toBeDefined();
    expect(result.gemini_argon_weekly).toBeDefined();
    expect(result.gemini_weekly.remainingPercentage).toBe(75);
    expect(result.claude_gpt_weekly.remainingPercentage).toBe(50);
    expect(result.gemini_argon_weekly.remainingPercentage).toBe(43);
  });

  it("skips non-weekly buckets", () => {
    const data = {
      groups: [{
        displayName: "Gemini Models",
        buckets: [
          {
            bucketId: "gemini-daily-bucket",
            displayName: "Daily Limit",
            remainingFraction: 0.9,
            resetTime: "2026-09-09T00:00:00Z",
          },
        ],
      }],
    };
    const result = parseWeeklyQuotaSummary(data);
    expect(result).toEqual({});
  });

  it("skips disabled weekly buckets", () => {
    const data = {
      groups: [{
        displayName: "Gemini Models",
        buckets: [{
          bucketId: "gemini-weekly-bucket",
          displayName: "Weekly Limit",
          remainingFraction: 0.75,
          resetTime: "2026-09-15T00:00:00Z",
          disabled: true,
        }],
      }],
    };
    const result = parseWeeklyQuotaSummary(data);
    expect(result).toEqual({});
  });

  it("returns empty object for null/undefined input", () => {
    expect(parseWeeklyQuotaSummary(null)).toEqual({});
    expect(parseWeeklyQuotaSummary(undefined)).toEqual({});
    expect(parseWeeklyQuotaSummary("string")).toEqual({});
  });

  it("returns empty object for response with no groups", () => {
    expect(parseWeeklyQuotaSummary({})).toEqual({});
    expect(parseWeeklyQuotaSummary({ groups: "not-array" })).toEqual({});
    expect(parseWeeklyQuotaSummary({ quotaSummary: {} })).toEqual({});
  });

  it("handles groups with no buckets gracefully", () => {
    const data = {
      groups: [{ displayName: "Gemini Models" }],
    };
    expect(parseWeeklyQuotaSummary(data)).toEqual({});
  });

  it("handles bucket with non-finite remainingFraction", () => {
    const data = {
      groups: [{
        displayName: "Gemini Models",
        buckets: [{
          bucketId: "weekly-bucket",
          displayName: "Weekly",
          remainingFraction: "not-a-number",
        }],
      }],
    };
    expect(parseWeeklyQuotaSummary(data)).toEqual({});
  });

  it("ignores groups that don't match known families", () => {
    const data = {
      groups: [{
        displayName: "Unknown AI Provider",
        buckets: [{
          bucketId: "weekly-bucket",
          displayName: "Weekly",
          remainingFraction: 0.5,
        }],
      }],
    };
    expect(parseWeeklyQuotaSummary(data)).toEqual({});
  });
});

// — fetchAntigravityWeeklyQuota ———————————————————————————
describe("fetchAntigravityWeeklyQuota", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    _clearWeeklyCache();
  });

  it("fetches and returns parsed weekly quota on success", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => FULL_RESPONSE,
    });

    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result.gemini_weekly).toBeDefined();
    expect(result.claude_gpt_weekly).toBeDefined();
    expect(result.gemini_argon_weekly).toBeDefined();
    expect(result.gemini_argon_weekly.remainingPercentage).toBe(43);
  });

  it("returns {} on HTTP 401", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 401 });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on HTTP 403", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on HTTP 404", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 404 });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on HTTP 429", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 429 });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on network error", async () => {
    proxyAwareFetch.mockRejectedValue(new Error("network timeout"));
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on malformed JSON response", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("deduplicates concurrent requests for the same account", async () => {
    let resolveResponse;
    proxyAwareFetch.mockReturnValue(new Promise(resolve => {
      resolveResponse = resolve;
    }));

    const p1 = fetchAntigravityWeeklyQuota("token", "project-1");
    const p2 = fetchAntigravityWeeklyQuota("token", "project-1");

    resolveResponse({ ok: true, json: async () => FULL_RESPONSE });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("serves cached result within TTL", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => FULL_RESPONSE,
    });

    await fetchAntigravityWeeklyQuota("token", "project-1");
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(result.gemini_weekly).toBeDefined();
  });

  it("sends correct headers and body", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ groups: [] }),
    });

    await fetchAntigravityWeeklyQuota("token", "project-1");

    // Pin the single source of truth (the verified Hub client identity), not a
    // literal that rots every time the client version is re-captured.
    const { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } = await import("open-sse/providers/shared.js");
    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toMatchObject({
      "Authorization": "Bearer token",
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
      "Content-Type": "application/json",
      "X-Client-Name": "antigravity",
      "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
    });
    expect(opts.body).toBe(JSON.stringify({ project: "project-1" }));
  });
});

// — Integration: weekly failure does not affect existing quotas —————
describe("weekly quota isolation from existing quota", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    _clearWeeklyCache();
  });

  it("existing getAntigravityUsage succeeds even when weekly RPC fails", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "p1", currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-15T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        throw new Error("weekly endpoint unavailable");
      }
      return { ok: false, status: 404 };
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const result = await getAntigravityUsage("token", {});

    expect(result.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
    });
    expect(result.quotas.gemini_weekly).toBeUndefined();
    expect(result.quotas.claude_gpt_weekly).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("free-tier accounts only show weekly quotas, not per-model short-window quotas", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "p1", currentTier: { name: "Starter" }, paidTier: { id: "free-tier", name: "Antigravity Starter Quota" } }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 1, resetTime: "2026-09-15T00:00:00Z" },
              },
              "claude-sonnet-4-6": {
                displayName: "Claude Sonnet 4.6",
                // Missing remainingFraction — free tier exhausted
                quotaInfo: { resetTime: "2026-09-13T12:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            groups: [{
              displayName: "Gemini Models",
              buckets: [{
                bucketId: "gemini-weekly",
                displayName: "Weekly Limit Remaining",
                remainingFraction: 1,
                resetTime: "2026-09-15T00:00:00Z",
              }],
            }, {
              displayName: "Claude and GPT models",
              buckets: [{
                bucketId: "3p-weekly",
                displayName: "Weekly Limit Remaining",
                remainingFraction: 0,
                resetTime: "2026-09-13T12:00:00Z",
              }],
            }],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const result = await getAntigravityUsage("token", {});

    // Per-model quotas should be absent (free-tier accounts skip model parsing)
    expect(result.quotas["gemini-3.8-flash-high"]).toBeUndefined();
    expect(result.quotas["claude-sonnet-4-6"]).toBeUndefined();

    // Only weekly quotas should appear
    expect(result.quotas.gemini_weekly).toMatchObject({
      used: 0,
      total: 1000,
      remainingPercentage: 100,
    });
    expect(result.quotas.claude_gpt_weekly).toMatchObject({
      used: 1000,
      total: 1000,
      remainingPercentage: 0,
    });
  });

  it("reconciles weekly quota to 0% when all paid-tier family models are exhausted", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "p1", currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                // Exhausted model: no remainingFraction, future resetTime
                quotaInfo: { resetTime: "2026-09-13T12:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            groups: [{
              displayName: "Gemini Models",
              buckets: [{
                bucketId: "gemini-weekly",
                displayName: "Weekly Limit Remaining",
                remainingFraction: 1,
                resetTime: "2026-09-15T00:00:00Z",
              }],
            }],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const result = await getAntigravityUsage("token", {});

    // Per-model quota should show exhausted
    expect(result.quotas["gemini-3.8-flash-high"].remainingPercentage).toBe(0);
    // Weekly quota should be reconciled to 0% with the family reset time
    expect(result.quotas.gemini_weekly).toMatchObject({
      used: 1000,
      total: 1000,
      remainingPercentage: 0,
      resetAt: "2026-09-13T12:00:00.000Z",
    });
  });

  // Mock both RPCs for a paid account: per-model rows + the weekly summary.
  function mockPaidAccount({ models, groups }) {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "p1", currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return { ok: true, status: 200, json: async () => ({ models }) };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return { ok: true, status: 200, json: async () => ({ groups }) };
      }
      return { ok: false, status: 404 };
    });
  }

  const EXHAUSTED_BUCKET = (resetTime) => [{
    bucketId: "weekly",
    displayName: "Weekly Limit Remaining",
    remainingFraction: 1,
    resetTime,
  }];

  it("parks the Argon bucket on the max Argon reset without touching Gemini", async () => {
    mockPaidAccount({
      models: {
        // Every Argon tier is spent; each carries its own reset.
        "gemini-4-argon-high": { displayName: "Gemini 4 Argon (High)", quotaInfo: { resetTime: "2026-09-20T00:00:00Z" } },
        "gemini-4-argon-low": { displayName: "Gemini 4 Argon (Low)", quotaInfo: { resetTime: "2026-09-22T00:00:00Z" } },
        "gemini-3.8-flash-high": {
          displayName: "Gemini 3.8 Flash (High)",
          quotaInfo: { remainingFraction: 1, resetTime: "2026-09-15T00:00:00Z" },
        },
      },
      groups: [
        { displayName: "Gemini Models", buckets: EXHAUSTED_BUCKET("2026-09-15T00:00:00Z") },
        { displayName: "Gemini 4 Argon", buckets: EXHAUSTED_BUCKET("2026-09-19T00:00:00Z") },
      ],
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const result = await getAntigravityUsage("token", {});

    expect(result.quotas["gemini-4-argon-high"].remainingPercentage).toBe(0);
    expect(result.quotas.gemini_argon_weekly).toMatchObject({
      used: 1000,
      total: 1000,
      remainingPercentage: 0,
      // max Argon reset, not the stale summary resetTime
      resetAt: "2026-09-22T00:00:00.000Z",
    });
    // Argon exhaustion must not zero the Gemini family bucket.
    expect(result.quotas.gemini_weekly).toMatchObject({
      remainingPercentage: 100,
      resetAt: "2026-09-15T00:00:00.000Z",
    });
  });

  it("does not let a healthy Argon tier keep the exhausted Gemini bucket available", async () => {
    mockPaidAccount({
      models: {
        "gemini-4-argon-high": {
          displayName: "Gemini 4 Argon (High)",
          quotaInfo: { remainingFraction: 1, resetTime: "2026-09-19T00:00:00Z" },
        },
        "gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)", quotaInfo: { resetTime: "2026-09-13T12:00:00Z" } },
      },
      groups: [
        { displayName: "Gemini Models", buckets: EXHAUSTED_BUCKET("2026-09-15T00:00:00Z") },
        { displayName: "Gemini 4 Argon", buckets: EXHAUSTED_BUCKET("2026-09-19T00:00:00Z") },
      ],
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const result = await getAntigravityUsage("token", {});

    // Argon is excluded from the Gemini family set, so the exhausted Gemini
    // model alone is enough to reconcile the Gemini bucket.
    expect(result.quotas.gemini_weekly).toMatchObject({
      remainingPercentage: 0,
      resetAt: "2026-09-13T12:00:00.000Z",
    });
    expect(result.quotas.gemini_argon_weekly).toMatchObject({
      remainingPercentage: 100,
    });
  });
});
