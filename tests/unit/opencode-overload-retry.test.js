// The free lane sheds load with 429 "The inference service is overloaded.
// Please try again later." even for a well-formed request. These tests pin the
// single executor-side retry (fresh session) so the CLI gets a response, while
// a real free-tier quota 429 is still delivered untouched and without delay.
import { afterAll, describe, expect, it, vi } from "vitest";

// proxyAwareFetch captures globalThis.fetch when first imported, so the stub
// has to exist before the executor module graph loads (no network in tests).
const { fetchMock, originalFetch } = vi.hoisted(() => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();
  globalThis.fetch = fetchMock;
  return { fetchMock, originalFetch };
});

import {
  OPENCODE_OVERLOAD_ERROR_CODE,
  OpenCodeExecutor,
} from "../../open-sse/executors/opencode.js";

const OVERLOAD = JSON.stringify({
  error: {
    type: "server_error",
    message: "The inference service is overloaded. Please try again later.",
  },
});

// The other 429 on this route: the free-tier gate, which is not transient. It
// also says "try again later", so detection must key on "overloaded".
const FREE_USAGE = JSON.stringify({
  type: "error",
  error: { type: "FreeUsageLimitError", message: "Free usage limit reached. Please try again later." },
});

function upstream(status, body) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

const sessionOf = (call) => call[1].headers["x-opencode-session"];

let identity = 0;
// No connectionId and no body session hints: the executor mints one canonical
// session per auth identity, which is what the retry has to replace.
const canonicalCredentials = () => ({ rawHeaders: { authorization: `Bearer retry-test-${identity++}` } });

function request(executor, { credentials = {}, log, signal } = {}) {
  return executor.execute({
    model: "deepseek-v4.1-flash-free",
    body: { messages: [{ role: "user", content: "say OK" }] },
    stream: true,
    credentials,
    signal,
    log,
  });
}

const settled = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));

describe("OpenCodeExecutor free-lane overload retry", () => {
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries the overload 429 once with a fresh session and returns the recovered stream", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(upstream(429, OVERLOAD))
      .mockResolvedValueOnce(upstream(200, "data: ok\n\n"));
    const log = { debug: vi.fn() };

    const result = await request(new OpenCodeExecutor(), { credentials: canonicalCredentials(), log });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map(sessionOf);
    expect(first).toMatch(/^ses_/);
    expect(second).toMatch(/^ses_/);
    expect(second).not.toBe(first);
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe("data: ok\n\n");
    expect(log.debug).toHaveBeenCalledWith("RETRY", expect.stringContaining("overload"));
  });

  it("surfaces a structured 429 when the retry is overloaded too, without a third attempt", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => upstream(429, OVERLOAD));

    const { value, error } = await settled(
      request(new OpenCodeExecutor(), { credentials: canonicalCredentials() }),
    );

    expect(value).toBeUndefined();
    expect(error).toMatchObject({
      name: "OpenCodeOverloadError",
      code: OPENCODE_OVERLOAD_ERROR_CODE,
      status: 429,
      retryable: true,
    });
    expect(error.message).toContain("retried once");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a free-tier quota 429 and hands its body back intact", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(upstream(429, FREE_USAGE));

    const result = await request(new OpenCodeExecutor(), { credentials: canonicalCredentials() });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(429);
    expect(await result.response.text()).toBe(FREE_USAGE);
  });

  it("does not retry other upstream failures", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(upstream(500, '{"error":"boom"}'));

    const result = await request(new OpenCodeExecutor(), { credentials: canonicalCredentials() });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(500);
  });

  it("reuses a client-supplied native session: it is not ours to replace", async () => {
    fetchMock.mockReset();
    const native = "ses_0123456789abABCDEFGHIJKLMN";
    fetchMock
      .mockResolvedValueOnce(upstream(429, OVERLOAD))
      .mockResolvedValueOnce(upstream(200, "data: ok\n\n"));

    const result = await request(new OpenCodeExecutor(), {
      credentials: { rawHeaders: { "x-opencode-session": native } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(sessionOf)).toEqual([native, native]);
    expect(result.response.status).toBe(200);
  });

  it("stops at once when the caller has already aborted", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(upstream(429, OVERLOAD));
    const controller = new AbortController();
    controller.abort();

    const result = await request(new OpenCodeExecutor(), {
      credentials: canonicalCredentials(),
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(429);
  });

  it("aborts during the backoff instead of retrying", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(upstream(429, OVERLOAD));
    const controller = new AbortController();
    const pending = settled(
      request(new OpenCodeExecutor(), { credentials: canonicalCredentials(), signal: controller.signal }),
    );

    // The stub answers instantly, so the backoff starts right after the first
    // attempt; abort inside its 800 ms window.
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();

    const { error } = await pending;
    expect(error?.name).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});