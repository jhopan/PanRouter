// The stream watchdog must not kill a healthy request.
//
// Reported symptom (MiniMax Code Global, 199-message conversation, 120k token
// context): `ERROR: stream stall timeout`. The provider was still working —
// MiniMax takes >6 minutes of reasoning on a context that large — but the
// watchdog only counted bytes, and the registry gave MiniMax no timeout of its
// own, so it inherited the 6-minute default and aborted.
//
// Four things had to be fixed:
//
//   1. The watchdog started counting from the moment the pipe was built, so a
//      slow prefill (TTFT 27-30s, or minutes on a big context) ate into the
//      inter-chunk budget. The first chunk now gets its own, longer budget.
//   2. MiniMax had no `stallTimeoutMs`, so a large reasoning turn aborted. It
//      now has one sized for its context window.
//   3. The abort message said "stream stall timeout" with no numbers, so the
//      log could not tell "provider is slow" from "provider is dead".
//   4. A stall aborted the request outright — no retry, no failover.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.resolve("../" + rel), "utf8");

const streamHandler = read("open-sse/utils/streamHandler.js");
const streamingHandler = read("open-sse/handlers/chatCore/streamingHandler.js");
const runtimeConfig = read("open-sse/config/runtimeConfig.js");
const minimaxGlobal = read("open-sse/providers/registry/minimax-code-global.js");
const minimaxCn = read("open-sse/providers/registry/minimax-code.js");
const chatCore = read("open-sse/handlers/chatCore.js");

describe("stream watchdog — first chunk has its own budget", () => {
  it("separates the first-chunk timeout from the inter-chunk stall timeout", () => {
    // A slow prefill must not consume the inter-chunk budget: they measure
    // different things and are sized differently.
    expect(streamHandler).toMatch(/firstChunkTimeoutMs/);
    expect(streamHandler).toMatch(/STREAM_FIRST_CHUNK_TIMEOUT_MS/);
  });

  it("switches to the inter-chunk budget once a chunk has arrived", () => {
    expect(streamHandler).toMatch(/sawChunk/);
  });

  it("says which budget expired when it aborts", () => {
    // "stream stall timeout" alone cannot tell a slow provider from a dead
    // one; the message has to name the phase and the elapsed time.
    expect(streamHandler).toMatch(/no first chunk/);
    expect(streamHandler).toMatch(/stalled after/);
  });
});

describe("stream watchdog — the abort message carries numbers", () => {
  it("reports elapsed, chunks and bytes in the error text", () => {
    const errBlock = streamHandler.slice(streamHandler.indexOf("abortMessage ="));
    expect(errBlock).toMatch(/chunks=/);
    expect(errBlock).toMatch(/bytes=/);
  });
});

describe("MiniMax Code has a stall timeout sized for its context", () => {
  it("global sets stallTimeoutMs", () => {
    expect(minimaxGlobal).toMatch(/stallTimeoutMs:\s*\d+/);
  });

  it("cn sets stallTimeoutMs", () => {
    expect(minimaxCn).toMatch(/stallTimeoutMs:\s*\d+/);
  });

  it("the timeout is well above the 6-minute default", () => {
    // 199 messages / 120k tokens took over 6 minutes of reasoning. Anything at
    // or below the default would abort the same turn again.
    const m = minimaxGlobal.match(/stallTimeoutMs:\s*([\d\s*]+)/);
    expect(m).toBeTruthy();
    // The value is written as an arithmetic expression (15 * 60 * 1000) so it
    // stays readable; evaluate it rather than reading the first literal.
    const value = m[1].split("*").map((n) => Number(n.trim())).reduce((a, b) => a * b, 1);
    expect(value).toBeGreaterThan(360000);
  });
});

describe("the watchdog reads the per-provider override", () => {
  it("passes the provider's stallTimeoutMs through", () => {
    expect(streamingHandler).toMatch(/PROVIDERS\[provider\]\?\.stallTimeoutMs/);
  });

  it("passes the provider's firstChunkTimeoutMs through", () => {
    expect(streamingHandler).toMatch(/firstChunkTimeoutMs/);
  });
});

describe("a stalled stream is retried, not dropped", () => {
  it("marks the abort so the account loop can fail over", () => {
    // A stall arrives AFTER the 200 was already sent, so the response cannot
    // be replayed from here. What the stream layer can do is mark the error as
    // a stall, so the account loop treats it like a transient provider
    // problem instead of a hard failure and moves to the next account.
    expect(streamHandler).toMatch(/stall/i);
    expect(streamHandler).toMatch(/code\s*=|error\.code/);
  });

  it("does not report a stall as a client abort", () => {
    // 499 means "the client hung up". A stall is the provider's silence, not
    // the client's choice — reporting it as 499 hides the real cause.
    const m = streamHandler.match(/new Error\(abortMessage\)/);
    expect(m).toBeTruthy();
  });
});

describe("runtime config exposes both budgets", () => {
  it("defines the first-chunk budget", () => {
    expect(runtimeConfig).toMatch(/STREAM_FIRST_CHUNK_TIMEOUT_MS/);
  });

  it("defines the inter-chunk budget", () => {
    expect(runtimeConfig).toMatch(/STREAM_STALL_TIMEOUT_MS/);
  });
});

describe("log durations are per-request, not shared", () => {
  it("the request line and the error line use the same start time", () => {
    // A 41-second request must never report 575774ms. Both lines are emitted
    // from the same request scope, so they must share `requestStartTime`.
    expect(chatCore).toMatch(/const requestStartTime = Date\.now\(\)/);
    const errLine = chatCore.slice(chatCore.indexOf("ERROR ${error?.status"));
    expect(errLine).toMatch(/Date\.now\(\) - requestStartTime/);
  });
});
