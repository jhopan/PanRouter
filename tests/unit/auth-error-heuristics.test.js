// A 403 is not always an auth failure.
//
// Qoder answers 403 for its admission queue (code 10605) and CodeBuddy answers
// 403 for channel verification (11128) / account restriction (11140). A token
// refresh cannot fix any of those, and the refresh path costs three attempts
// (6s of backoff) plus a duplicate upstream request before the real error is
// finally reported — so the queue wait never actually happens.
import { describe, expect, it } from "vitest";
import {
  shouldRefreshOnForbidden,
  extractProviderErrorCode,
  isProviderRefusalBody,
} from "../../open-sse/utils/authErrorHeuristics.js";

const QODER_QUEUE_BODY = JSON.stringify({
  error: {
    message: JSON.stringify({
      code: "403",
      message: JSON.stringify({
        isQueued: true,
        modelKey: "dfmodel",
        queueCount: 0,
        queueType: "p3",
        retryAfterSeconds: 30,
        serviceAvailable: false,
        subCode: "RESOURCE_LIMIT",
        waitTime: 30,
      }),
      subCode: "RESOURCE_LIMIT",
    }),
  },
});

describe("extractProviderErrorCode", () => {
  it("digs the code out of nested JSON envelopes", () => {
    expect(extractProviderErrorCode(QODER_QUEUE_BODY)).toBe("403");
  });

  it("reads a flat code", () => {
    expect(extractProviderErrorCode(JSON.stringify({ code: 11140 }))).toBe("11140");
  });

  it("falls back to a regex for a non-JSON body", () => {
    expect(extractProviderErrorCode('[403]: {"code":10605}')).toBe("10605");
  });

  it("returns null when there is no code", () => {
    expect(extractProviderErrorCode("")).toBeNull();
    expect(extractProviderErrorCode("boom")).toBeNull();
  });
});

describe("isProviderRefusalBody", () => {
  it("recognises the Qoder queue body", () => {
    expect(isProviderRefusalBody(QODER_QUEUE_BODY)).toBe(true);
  });

  it("recognises the CodeBuddy refusals", () => {
    expect(isProviderRefusalBody(JSON.stringify({ code: 11128, msg: "request illegal" }))).toBe(true);
    expect(isProviderRefusalBody(JSON.stringify({ code: 11140, msg: "request illegal" }))).toBe(true);
  });

  it("does not flag an ordinary error", () => {
    expect(isProviderRefusalBody(JSON.stringify({ error: { message: "invalid api key" } }))).toBe(false);
  });
});

describe("shouldRefreshOnForbidden", () => {
  it("does not refresh for the Qoder admission queue", () => {
    expect(shouldRefreshOnForbidden(403, QODER_QUEUE_BODY)).toBe(false);
  });

  it("does not refresh for CodeBuddy 11128 / 11140", () => {
    expect(shouldRefreshOnForbidden(403, JSON.stringify({ code: 11128, msg: "request illegal" }))).toBe(false);
    expect(shouldRefreshOnForbidden(403, JSON.stringify({ code: 11140, msg: "request illegal" }))).toBe(false);
  });

  it("still refreshes for a plain 403", () => {
    expect(shouldRefreshOnForbidden(403, JSON.stringify({ error: { message: "invalid api key" } }))).toBe(true);
  });

  it("leaves 401 to the caller", () => {
    expect(shouldRefreshOnForbidden(401, "")).toBe(true);
  });
});
