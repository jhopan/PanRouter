// Qoder 10605 "isQueued" is an admission queue: the MODEL is momentarily busy,
// the account is fine. Verified against the live API with one account:
//
//   sequential   dfmodel 2712ms ok, qfmodel 1124ms ok
//   parallel     dfmodel 906ms ok ∥ qfmodel 1733ms ok
//   same model   dfmodel #1 1295ms ok ∥ dfmodel #2 1355ms ok
//   qfmodel x6   6/6 ok
//
// So one account CAN run several models at once, and the queue clears by
// itself. Locking the account for 30s over it was wrong: it hid a healthy
// account and forced the client to retry from scratch.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const QUEUED = JSON.stringify({
  error: {
    message: JSON.stringify({
      code: "403",
      message: JSON.stringify({
        isQueued: true,
        queueCount: 0,
        queueType: "p3",
        retryAfterSeconds: 30,
        serviceAvailable: false,
        subCode: "RESOURCE_LIMIT",
        waitTime: 30,
      }),
    }),
  },
});

describe("qoder — queue throttle is not an account fault", () => {
  const exec = new QoderExecutor("qoder");
  const p = exec.parseError({ status: 403 }, QUEUED, { model: "qfmodel", provider: "qoder" });

  it("is flagged as a queue throttle", () => {
    expect(p.queueThrottle).toBe(true);
  });

  it("is not flagged as an account restriction", () => {
    expect(p.accountRestricted).toBeUndefined();
  });

  it("is not fatal — the request can be retried", () => {
    expect(p.fatal).toBeUndefined();
  });

  it("names the model from the request context", () => {
    expect(p.message).toContain("qfmodel");
  });
});

describe("chat.js — a queued request waits and retries the SAME account", () => {
  const chat = read("../src/sse/handlers/chat.js");

  // The capacity is provider-wide (queueCount:0, serviceAvailable:false) and
  // the model is FREE but busy: this is a queue, not an error. Rotating would
  // take the same queue on every other account and only burn their quota, so the
  // request waits and retries the same account.
  it("retries the queued request", () => {
    expect(chat).toContain("result.queueThrottle");
    expect(chat).toMatch(/waiting .* and retrying the same account/);
  });

  it("waits the provider's own retryAfterSeconds", () => {
    expect(chat).toContain("QUEUE_MAX_RETRIES");
    expect(chat).toContain("QUEUE_MAX_WAIT_MS");
    expect(chat).toMatch(/resetsAtMs \|\| 0\) - Date\.now\(\)/);
  });

  it("does not rotate to another account while queued", () => {
    // The retry must happen BEFORE the account is excluded, so the same one
    // is picked again.
    const queueIdx = chat.indexOf("if (result.queueThrottle) {");
    const excludeIdx = chat.indexOf("excludeConnectionIds.add(credentials.connectionId)");
    expect(queueIdx).toBeGreaterThan(-1);
    expect(queueIdx).toBeLessThan(excludeIdx);
  });

  it("returns before markAccountUnavailable, so no account is locked", () => {
    const queueIdx = chat.indexOf("if (result.queueThrottle) {");
    const markIdx = chat.indexOf("markAccountUnavailable(credentials.connectionId");
    expect(queueIdx).toBeGreaterThan(-1);
    expect(queueIdx).toBeLessThan(markIdx);
  });

  it("reports the queue window to the client when it finally gives up", () => {
    expect(chat).toMatch(/HTTP_STATUS\.RATE_LIMITED/);
    expect(chat).toMatch(/queued, retry in/);
    expect(chat).toMatch(/giving up without locking the account/);
  });
});

describe("error plumbing — queueThrottle survives the round trip", () => {
  const errorUtil = read("../open-sse/utils/error.js");
  const chatCore = read("../open-sse/handlers/chatCore.js");

  it("parseUpstreamError forwards queueThrottle", () => {
    expect(errorUtil).toContain("queueThrottle: parsed.queueThrottle === true");
  });

  it("createErrorResult propagates the flag", () => {
    expect(errorUtil).toMatch(/flags\?\.queueThrottle \? \{ queueThrottle: true \}/);
  });

  it("chatCore passes it through", () => {
    expect(chatCore).toMatch(/\{ fatal, accountRestricted, queueThrottle(, banned)? \}/);
  });
});

