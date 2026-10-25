// Qoder wraps upstream errors in nested JSON strings, so the generic parser
// never saw the real code. Two failures from the field:
//
// 1. 10605 `isQueued:true` (admission queue) carries `retryAfterSeconds: 30`,
//    but nothing read it: the model was locked 120s by the generic backoff.
//
// 2. antigravity `400 Bad request` locked every account in turn (30s each) even
//    though Google rejects a malformed payload before looking at the account.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

// Real shape from the log: three levels of stringified JSON.
const QODER_QUEUE = JSON.stringify({
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

describe("qoder — admission queue 10605", () => {
  const exec = new QoderExecutor("qoder");
  const p = exec.parseError({ status: 403 }, QODER_QUEUE);

  it("honours retryAfterSeconds instead of the generic 120s backoff", () => {
    const waitMs = p.resetsAtMs - Date.now();
    expect(waitMs).toBeGreaterThan(29_000);
    expect(waitMs).toBeLessThan(31_000);
  });

  it("maps to 429, which is what a queue throttle is", () => {
    expect(p.status).toBe(429);
  });

  it("names the queued model", () => {
    expect(p.message).toContain("dfmodel");
  });

  it("falls back to the request model when the payload omits modelKey", () => {
    // Upstream usually omits modelKey; without the context fallback the log
    // said `model "?"`, which is useless when several models are queued.
    const body = JSON.stringify({
      error: { message: JSON.stringify({ isQueued: true, retryAfterSeconds: 30 }) },
    });
    const q = exec.parseError({ status: 403 }, body, { model: "qfmodel", provider: "qoder" });
    expect(q.message).toContain("qfmodel");
    expect(q.message).not.toContain('"?"');
  });

  it("never prints a bare question mark without context", () => {
    const body = JSON.stringify({ error: { message: JSON.stringify({ isQueued: true }) } });
    const q = exec.parseError({ status: 403 }, body);
    expect(q.message).not.toContain('"?"');
    expect(q.message).toContain("this model");
  });

  it("is flagged as a queue throttle, not a quota block", () => {
    expect(p.queueThrottle).toBe(true);
  });

  it("falls back to 30s when the provider omits the hint", () => {
    const body = JSON.stringify({ error: { message: JSON.stringify({ isQueued: true, modelKey: "x" }) } });
    const q = exec.parseError({ status: 403 }, body);
    expect(q.resetsAtMs - Date.now()).toBeLessThanOrEqual(30_500);
  });

  it("leaves a plain error alone", () => {
    expect(exec.parseError({ status: 500 }, "boom").status).toBe(500);
  });
});

describe("antigravity — 400 is a request problem", () => {
  const exec = new AntigravityExecutor();

  it("marks 400 fatal so chat.js stops instead of locking every account", async () => {
    const p = await exec.parseError({ status: 400 }, "Bad request");
    expect(p.fatal).toBe(true);
    expect(p.requestRejected).toBe(true);
  });

  it("surfaces the upstream message when the body is JSON", async () => {
    const body = JSON.stringify({ error: { message: "Invalid JSON payload received" } });
    const p = await exec.parseError({ status: 400 }, body);
    expect(p.message).toContain("Invalid JSON payload");
  });

  it("does not request a cooldown", async () => {
    const p = await exec.parseError({ status: 400 }, "Bad request");
    expect(p.resetsAtMs).toBeUndefined();
  });

  it("surfaces Google field violations so the log says what to fix", async () => {
    const body = JSON.stringify({
      error: {
        message: "Bad request",
        details: [{ fieldViolations: [{ field: "contents[0].parts[1].inline_data", description: "Invalid value" }] }],
      },
    });
    const p = await exec.parseError({ status: 400 }, body);
    expect(p.message).toContain("contents[0].parts[1].inline_data");
  });
});

describe("chat.js — fatal 400 does not lock accounts", () => {
  const chat = read("../src/sse/handlers/chat.js");

  it("returns before markAccountUnavailable on fatal", () => {
    const fatalIdx = chat.indexOf("result.fatal === true");
    const markIdx = chat.indexOf("markAccountUnavailable(credentials.connectionId");
    expect(fatalIdx).toBeGreaterThan(-1);
    expect(fatalIdx).toBeLessThan(markIdx);
  });
});
