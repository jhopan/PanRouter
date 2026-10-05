import { describe, expect, it, vi } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const executor = new AntigravityExecutor();

const res = (status) => ({ status });

const BODY_WITH_TIMESTAMP = JSON.stringify({
  error: {
    code: 429,
    message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 74h19m34s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "QUOTA_EXHAUSTED",
        domain: "cloudcode-pa.googleapis.com",
        metadata: {
          uiMessage: "true",
          model: "gemini-3.8-flash-high",
          quotaResetDelay: "74h19m34.031069133s",
          quotaResetTimeStamp: "2026-10-08T02:11:56Z",
        },
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "267574.031069133s",
      },
    ],
  },
});

const BODY_WITHOUT_TIMESTAMP = JSON.stringify({
  error: {
    code: 429,
    message: "Individual quota reached.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "QUOTA_EXHAUSTED",
        domain: "cloudcode-pa.googleapis.com",
        metadata: { model: "gemini-3.8-flash-high" },
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "267574.031069133s",
      },
    ],
  },
});

describe("AntigravityExecutor parseError (quota reset extraction)", () => {
  it("parses exact quotaResetTimeStamp from 429 body", async () => {
    const parsed = await executor.parseError(res(429), BODY_WITH_TIMESTAMP);
    expect(parsed.resetsAtMs).toBe(Date.parse("2026-10-08T02:11:56Z"));
  });

  it("parses quotaResetDelay when only delay is present (met data)", async () => {
    const body = JSON.stringify({
      error: {
        message: "Individual quota reached.",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", metadata: { quotaResetDelay: "2h5m10.5s" } }],
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    try {
      const parsed = await executor.parseError(res(429), body);
      expect(parsed.resetsAtMs).toBe(Date.parse("2026-10-05T02:05:10.500Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to RetryInfo.retryDelay seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    try {
      const parsed = await executor.parseError(res(429), BODY_WITHOUT_TIMESTAMP);
      expect(parsed.resetsAtMs).toBeCloseTo(Date.parse("2026-10-05T00:00:00Z") + parseFloat("267574.031069133") * 1000, 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no reset info -> passes through base parser", async () => {
    const parsed = await executor.parseError(res(500), JSON.stringify({ error: { message: "boom" } }));
    expect(parsed.resetsAtMs).toBeUndefined();
    expect(parsed.status).toBe(500);
    expect(parsed.message).toContain("boom");
  });
});