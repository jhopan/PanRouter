/**
 * Streaming path tests for Qoder.
 *
 * Our executor's wrapQoderSSE is a reconstructing wrapper: it peeks the first
 * SSE frame, then feeds those same bytes back into the reader loop so a normal
 * completion is forwarded with a single upstream call (nothing is re-sent).
 * Qoder keeps the socket open after the terminal frame (agent keepalive), so
 * the wrapper must also stop cleanly at [DONE] and never close its controller
 * twice when a frame arrives behind the terminal one.
 */

import { describe, it, expect } from "vitest";
import { __test__ as qoderInternals } from "../../open-sse/executors/qoder.js";

const { wrapQoderSSE } = qoderInternals;

const frame = (body, statusCodeValue = 200) =>
  `data: ${JSON.stringify({ statusCodeValue, body: JSON.stringify(body) })}\n\n`;

/** Build an upstream response that streams the given chunks then closes. */
function upstreamResponse(chunks) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

async function drain(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  buf += decoder.decode();
  return buf;
}

describe("qoder stream reconstruction (peek -> forward)", () => {
  it("forwards a clean completion without dropping the peeked head", async () => {
    // Split across two chunks so the peek consumes the first and the pump must
    // forward it back before continuing.
    const head = frame({ choices: [{ delta: { content: "PONG" }, finish_reason: "stop" }] });
    const tail = "data: [DONE]\n\n";
    const wrapped = await wrapQoderSSE(upstreamResponse([head, tail]), "qoder/ultimate");

    expect(wrapped.status).toBe(200);
    const text = await drain(wrapped);
    expect(text).toContain("PONG");
    expect(text).toContain("[DONE]");
  });

  it("streams several frames in order", async () => {
    const wrapped = await wrapQoderSSE(
      upstreamResponse([
        frame({ choices: [{ delta: { content: "a" } }] }),
        frame({ choices: [{ delta: { content: "b" } }] }),
        "data: [DONE]\n\n",
      ]),
      "qoder/qfmodel",
    );
    const text = await drain(wrapped);
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
    expect(text).toContain("[DONE]");
  });

  it("does not throw when a keepalive frame arrives after [DONE]", async () => {
    // Qoder keeps the socket open; the wrapper must cancel the upstream reader
    // and close once, not emit ERR_INVALID_STATE on a second close.
    const wrapped = await wrapQoderSSE(
      upstreamResponse([
        frame({ choices: [{ delta: { content: "OK" } }] }),
        "data: [DONE]\n\n",
        frame({ choices: [{ delta: { content: "ignored" } }] }),
      ]),
      "qoder/auto",
    );

    await expect(drain(wrapped)).resolves.toBeTypeOf("string");
    const text = await drain(await wrapQoderSSE(
      upstreamResponse([
        frame({ choices: [{ delta: { content: "OK" } }] }),
        "data: [DONE]\n\n",
        frame({ choices: [{ delta: { content: "ignored" } }] }),
      ]),
      "qoder/auto",
    ));
    expect(text).toContain("OK");
    expect(text).not.toContain("ignored");
  });

  it("passes a queue frame through as a retryable error, not a 403 block", async () => {
    const queueEnv = JSON.stringify({
      statusCodeValue: 429,
      body: '{"code":"10605","message":"Queue limit","isQueued":true,"queueCount":0}',
    });
    const wrapped = await wrapQoderSSE(upstreamResponse([`data: ${queueEnv}\n\n`]), "qoder/auto");

    // Not billing -> not a hard 403 the account would be locked over.
    expect(wrapped.status).not.toBe(403);
    expect(wrapped.ok).toBe(false);
  });
});
