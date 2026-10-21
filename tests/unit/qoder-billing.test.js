/**
 * Unit tests for qoder billing error detection.
 *
 * Ensures that real billing blocks (code 110/112, pricingUrl) are detected on
 * the first SSE frame and returned as 403 so chatCore can mark the connection
 * unavailable and trigger combo failover.
 *
 * Code 10605 is NOT billing: it is the admission queue ({"isQueued":true}),
 * which clears in seconds. Classifying it as billing parked the account until
 * the monthly reset for a transient wait.
 */

import { describe, it, expect } from "vitest";
import { __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";

describe("isBillingBlock", () => {
  const { isBillingBlock } = qoderExecutorInternals;

  it("detects code 112 (quota exhausted)", () => {
    const msg = '{"code":"112","message":"Quota exhausted","pricingUrl":"..."}';
    expect(isBillingBlock(msg)).toBe(true);
  });

  it("does NOT treat code 10605 as billing (it is the admission queue)", () => {
    expect(isBillingBlock('{"code":"10605","message":"Queue limit"}')).toBe(false);
    expect(isBillingBlock('{"code":"10605","isQueued":true,"queueCount":0}')).toBe(false);
  });

  it("does NOT treat an explicit isQueued flag as billing", () => {
    expect(isBillingBlock('{"isQueued":true,"modelKey":"qfmodel","queueCount":3}')).toBe(false);
  });

  it("still detects code 110 (daily billing count exceeded)", () => {
    expect(isBillingBlock('{"code":"110","message":"Daily count exceeded"}')).toBe(true);
  });

  it("detects pricingUrl field", () => {
    const msg = '{"message":"Upgrade required","pricingUrl":"https://..."}';
    expect(isBillingBlock(msg)).toBe(true);
  });

  it("returns false for normal errors without billing markers", () => {
    const msg = '{"code":"500","message":"Internal error"}';
    expect(isBillingBlock(msg)).toBe(false);
  });

  it("returns false for empty or non-string input", () => {
    expect(isBillingBlock("")).toBe(false);
    expect(isBillingBlock(null)).toBe(false);
    expect(isBillingBlock(undefined)).toBe(false);
  });
});

describe("wrapQoderSSE billing detection", () => {
  const { wrapQoderSSE } = qoderExecutorInternals;

  function makeResponse(lines, { status = 200 } = {}) {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });
    return new Response(body, { status });
  }

  it("returns 403 response when first frame is billing block (code 112)", async () => {
    const billingEnv = JSON.stringify({
      statusCodeValue: 403,
      body: '{"code":"112","message":"Quota exhausted","pricingUrl":"https://qoder.sh/pricing"}',
    });
    const upstream = `data: ${billingEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/ultimate");

    expect(wrapped.status).toBe(403);
    expect(wrapped.ok).toBe(false);
    const json = await wrapped.json();
    expect(json.error).toBeDefined();
    expect(json.error.message).toContain("112");
  });

  it("passes a code 10605 queue frame through instead of failing the account", async () => {
    const queueEnv = JSON.stringify({
      statusCodeValue: 429,
      body: '{"code":"10605","message":"Queue limit","isQueued":true,"queueCount":0}',
    });
    const upstream = `data: ${queueEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/ultimate");

    // Not a billing block -> not a hard 403. The request is retryable.
    expect(wrapped.status).not.toBe(403);
  });

  it("returns 403 response when first frame is billing block (code 110 string)", async () => {
    const billingEnv = JSON.stringify({
      statusCodeValue: 403,
      body: '{"code":"110","message":"Billing daily count exceeded"}',
    });
    const upstream = `data: ${billingEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/qfmodel");

    expect(wrapped.status).toBe(403);
    expect(wrapped.ok).toBe(false);
    const json = await wrapped.json();
    expect(json.error.message).toContain("Billing daily count exceeded");
  });

  it("returns 403 response when first frame is billing block (code 110 numeric)", async () => {
    const billingEnv = JSON.stringify({
      statusCodeValue: 403,
      body: '{"code":110,"message":"Billing daily count exceeded"}',
    });
    const upstream = `data: ${billingEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/qfmodel");

    expect(wrapped.status).toBe(403);
    expect(wrapped.ok).toBe(false);
  });
  it("returns 403 response when statusCodeValue is string \"403\" (code 110)", async () => {
    const billingEnv = JSON.stringify({
      statusCodeValue: "403",
      body: '{"code":"110","message":"Billing daily count exceeded"}',
    });
    const upstream = `data: ${billingEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/qfmodel");

    expect(wrapped.status).toBe(403);
    expect(wrapped.ok).toBe(false);
    const json = await wrapped.json();
    expect(json.error.message).toContain("Billing daily count exceeded");
  });

  it("emits structured 403 error chunk for object-body billing after a data frame (peek miss)", async () => {
    const okEnv = JSON.stringify({
      statusCodeValue: 200,
      body: JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
    });
    const billingEnv = JSON.stringify({
      statusCodeValue: 403,
      body: { code: "110", message: "Billing daily count exceeded" },
    });
    const upstream = `data: ${okEnv}\n\ndata: ${billingEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/qfmodel");

    const reader = wrapped.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();

    expect(buf).not.toContain("[qoder error");
    const errLine = buf.split("\n").find((l) => l.includes('"error"'));
    expect(errLine).toBeDefined();
    const errChunk = JSON.parse(errLine.slice(5).trim());
    expect(errChunk.error.status).toBe(403);
    expect(errChunk.error.message).toContain("Billing daily count exceeded");
    expect(errChunk.choices).toBeUndefined();
  });


  it("does not treat legitimate assistant text mentioning code 110 as billing", async () => {
    const inner = JSON.stringify({
      choices: [{ delta: { content: "error 110 means billing daily count exceeded in docs" } }],
    });
    const successEnv = JSON.stringify({ statusCodeValue: 200, body: inner });
    const upstream = `data: ${successEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/qfmodel");

    expect(wrapped.status).toBe(200);
    const reader = wrapped.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();

    expect(buf).toContain("billing daily count exceeded");
    expect(buf).not.toContain("[qoder error");
  });

  it("emits structured 403 error chunk for billing envelope after a data frame (peek miss)", async () => {
    const okEnv = JSON.stringify({
      statusCodeValue: 200,
      body: JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
    });
    const billingEnv = JSON.stringify({
      statusCodeValue: 403,
      body: '{"code":"110","message":"Billing daily count exceeded"}',
    });
    const upstream = `data: ${okEnv}\n\ndata: ${billingEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/qfmodel");

    const reader = wrapped.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();

    expect(buf).not.toContain("[qoder error");
    const errLine = buf.split("\n").find((l) => l.includes('"error"'));
    expect(errLine).toBeDefined();
    const errChunk = JSON.parse(errLine.slice(5).trim());
    expect(errChunk.error.status).toBe(403);
    expect(errChunk.error.message).toContain("Billing daily count exceeded");
  });

  it("emits structured 403 error chunk for object-body billing envelope (peek miss)", async () => {
    const billingEnv = JSON.stringify({
      statusCodeValue: 403,
      body: { code: "110", message: "Billing daily count exceeded" },
    });
    const upstream = `data: ${billingEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/qfmodel");

    expect(wrapped.status).toBe(403);
  });

  it("returns 403 response when first frame has pricingUrl", async () => {
    const billingEnv = JSON.stringify({
      statusCodeValue: 402,
      body: '{"message":"Payment required","pricingUrl":"https://..."}',
    });
    const upstream = `data: ${billingEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/ultimate");

    expect(wrapped.status).toBe(403);
  });

  it("returns non-billing errors with their upstream HTTP status", async () => {
    const errorEnv = JSON.stringify({
      statusCodeValue: 500,
      body: "Internal server error",
    });
    const upstream = `data: ${errorEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/ultimate");

    expect(wrapped.status).toBe(500);
    expect(wrapped.ok).toBe(false);
    expect(await wrapped.json()).toEqual({
      error: { message: "Internal server error", code: 500 },
    });
  });

  it("passes through successful responses unchanged", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "hello" } }] });
    const successEnv = JSON.stringify({ statusCodeValue: 200, body: inner });
    const upstream = `data: ${successEnv}\n\n`;

    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/ultimate");

    expect(wrapped.status).toBe(200);
    expect(wrapped.ok).toBe(true);

    const reader = wrapped.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();

    expect(buf).toContain(`data: ${inner}`);
    expect(buf).toContain("data: [DONE]");
  });
});
