import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getClinepassUsage } from "../../open-sse/services/usage/clinepass.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const USAGE_URL = "https://api.cline.bot/api/v1/users/me/plan/usage-limits";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_LIMITS = {
  success: true,
  data: {
    limits: [
      {
        type: "five_hour",
        percentUsed: 15,
        resetsAt: "2026-11-10T04:13:33.669456539Z",
      },
      {
        type: "weekly",
        percentUsed: 92,
        resetsAt: "2026-11-14T02:29:15.672222629Z",
      },
      {
        type: "monthly",
        percentUsed: 46,
        resetsAt: "2026-12-07T02:29:15.674628879Z",
      },
    ],
  },
};

describe("clinepass registry usage flags", () => {
  it("is listed for oauth and apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("clinepass");
    expect(USAGE_APIKEY_PROVIDERS).toContain("clinepass");
  });
});

describe("getClinepassUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs usage-limits with WorkOS-prefixed OAuth bearer", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_LIMITS));

    const usage = await getClinepassUsage("eyJpeg.eyJbG.sig");

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("ClinePass");
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(USAGE_URL);
    expect(proxyAwareFetch.mock.calls[0][1].method).toBe("GET");
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer workos:eyJpeg.eyJbG.sig",
    );
  });

  it("keeps an existing workos: prefix on OAuth tokens", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_LIMITS));

    await getClinepassUsage("workos:eyJpeg.eyJbG.sig");

    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer workos:eyJpeg.eyJbG.sig",
    );
  });

  it("uses plain Bearer for API keys (no workos: prefix)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_LIMITS));

    await getClinepassUsage("eyJpeg.should.not.be.used", "clp_1234567890abcdef");

    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer clp_1234567890abcdef",
    );
  });

  it("maps percentUsed windows to remainingPercentage quotas", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_LIMITS));

    const usage = await getClinepassUsage("workos:eyJpeg.eyJbG.sig");

    expect(usage.quotas["Session (5h)"]).toMatchObject({
      used: 15,
      total: 100,
      remainingPercentage: 85,
      resetAt: "2026-11-10T04:13:33.669Z",
    });
    expect(usage.quotas["Weekly (7d)"]).toMatchObject({
      used: 92,
      total: 100,
      remainingPercentage: 8,
    });
    expect(usage.quotas["Monthly"]).toMatchObject({
      used: 46,
      total: 100,
      remainingPercentage: 54,
    });
    // UI treats absolute remaining as % — must not set it.
    expect(usage.quotas["Session (5h)"].remaining).toBeUndefined();
  });

  it("returns auth-expired message on 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));

    const usage = await getClinepassUsage("workos:dead.token");

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/authentication expired|re-authorize/i);
  });

  it("reports an API error without throwing", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    const usage = await getClinepassUsage("workos:eyJpeg.eyJbG.sig");

    expect(usage.message).toMatch(/usage API error \(500\)/);
  });

  it("returns an empty quota map when the plan reports no limits", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: { limits: [] } }));

    const usage = await getClinepassUsage("workos:eyJpeg.eyJbG.sig");

    expect(usage.quotas).toEqual({});
    expect(usage.message).toMatch(/no usage limits/i);
  });

  it("asks for credentials when neither token nor key is available", async () => {
    const usage = await getClinepassUsage(null, null);

    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(usage.message).toMatch(/not available/i);
  });
});

describe("parseQuotaData(clinepass)", () => {
  it("renders one dashboard row per window with used/total percent", () => {
    const rows = parseQuotaData("clinepass", {
      quotas: {
        "Session (5h)": {
          used: 15,
          total: 100,
          remainingPercentage: 85,
          resetAt: "2026-11-10T04:13:33.669Z",
        },
        "Weekly (7d)": {
          used: 92,
          total: 100,
          remainingPercentage: 8,
          resetAt: "2026-11-14T02:29:15.672Z",
        },
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Session (5h)",
      used: 15,
      total: 100,
      resetAt: "2026-11-10T04:13:33.669Z",
    });
  });
});