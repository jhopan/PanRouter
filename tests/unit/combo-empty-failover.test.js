// Empty-content failover: a 2xx stream that ends without ever releasing answer text or a
// tool call falls through to the next combo candidate — unless the finish reason is a
// legitimately-empty class (content_filter) or no candidate is left.
import { describe, expect, it, vi } from "vitest";

import {
  deltaHasClientContent,
  inspectSSELine,
  isNoRetryFinish,
  peekStreamForContent,
  reconstructStream,
  scanSSEBuffer,
} from "../../open-sse/services/emptyFailover.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { NO_RETRY_EMPTY_FINISH, OPENAI_FINISH } from "../../open-sse/translator/schema/finishReasons.js";

const enc = new TextEncoder();

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

const ROLE = `data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`;
const REASONING = `data: {"id":"x","choices":[{"index":0,"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}\n\n`;
const CONTENT = `data: {"id":"x","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\n`;
const EMPTY_STOP = `data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`;
const FILTER_STOP = `data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}\n\n`;
const DONE = `data: [DONE]\n\n`;

function sseResponse(frames, { status = 200 } = {}) {
  const stream = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}

function jsonResponse(payload) {
  return Response.json(payload);
}

describe("deltaHasClientContent", () => {
  it("counts answer text and tool calls", () => {
    expect(deltaHasClientContent({ content: "hi" })).toBe(true);
    expect(deltaHasClientContent({ content: [{ type: "text", text: "hi" }] })).toBe(true);
    expect(deltaHasClientContent({ tool_calls: [{ id: "t1" }] })).toBe(true);
  });

  it("does not count role-only or reasoning-only frames", () => {
    expect(deltaHasClientContent({ role: "assistant" })).toBe(false);
    expect(deltaHasClientContent({ reasoning_content: "thinking" })).toBe(false);
    expect(deltaHasClientContent({})).toBe(false);
    expect(deltaHasClientContent(null)).toBe(false);
  });
});

describe("inspectSSELine", () => {
  it("reads OpenAI chat frames", () => {
    expect(inspectSSELine(ROLE)).toEqual({ content: false, finishReason: null });
    expect(inspectSSELine(REASONING)).toEqual({ content: false, finishReason: null });
    expect(inspectSSELine(CONTENT)).toEqual({ content: true, finishReason: null });
    expect(inspectSSELine(EMPTY_STOP)).toEqual({ content: false, finishReason: "stop" });
    expect(inspectSSELine(DONE)).toEqual({ content: false, finishReason: null });
  });

  it("reads Anthropic Messages frames", () => {
    const delta = `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })}`;
    const block = `data: ${JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", name: "x" } })}`;
    const stop = `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}`;
    expect(inspectSSELine(delta)).toEqual({ content: true, finishReason: null });
    expect(inspectSSELine(block).content).toBe(true);
    expect(inspectSSELine(stop)).toEqual({ content: false, finishReason: "stop" });
  });

  it("reads OpenAI Responses frames", () => {
    const text = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "hi" })}`;
    const tool = `data: ${JSON.stringify({ type: "response.output_item.added", item: { type: "function_call" } })}`;
    const done = `data: ${JSON.stringify({ type: "response.completed", response: {} })}`;
    const filtered = `data: ${JSON.stringify({ type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } })}`;
    expect(inspectSSELine(text)).toEqual({ content: true, finishReason: null });
    expect(inspectSSELine(tool).content).toBe(true);
    expect(inspectSSELine(done)).toEqual({ content: false, finishReason: "stop" });
    expect(inspectSSELine(filtered)).toEqual({ content: false, finishReason: "content_filter" });
  });
});

describe("scanSSEBuffer", () => {
  it("latches content and keeps an incomplete trailing line pending", () => {
    const state = scanSSEBuffer(`${ROLE}\ndata: {"id":"x","choices":[{"delta":`, { sawContent: false, finishReason: null });
    expect(state.sawContent).toBe(false);
    expect(state.pending).toBe(`data: {"id":"x","choices":[{"delta":`);

    const next = scanSSEBuffer(`${state.pending}{"content":"OK"}}]}\n\n`, state);
    expect(next.sawContent).toBe(true);
    expect(next.finishReason).toBe(null);
  });

  it("records the last finish reason", () => {
    const state = scanSSEBuffer(`${ROLE}\n${EMPTY_STOP}\n`, { sawContent: false, finishReason: null });
    expect(state.finishReason).toBe("stop");
  });
});

describe("isNoRetryFinish", () => {
  it("only spares the legitimate empty classes", () => {
    expect(NO_RETRY_EMPTY_FINISH.has(OPENAI_FINISH.CONTENT_FILTER)).toBe(true);
    expect(isNoRetryFinish("content_filter")).toBe(true);
    expect(isNoRetryFinish("CONTENT_FILTER")).toBe(true);
    expect(isNoRetryFinish("stop")).toBe(false);
    expect(isNoRetryFinish("length")).toBe(false);
    expect(isNoRetryFinish(null)).toBe(false);
  });
});

describe("peekStreamForContent", () => {
  it("stops at the first content frame and reports empty for content-less streams", async () => {
    const withContent = await peekStreamForContent(sseResponse([ROLE, CONTENT, DONE]).body);
    expect(withContent.outcome).toBe("content");

    const empty = await peekStreamForContent(sseResponse([ROLE, REASONING, EMPTY_STOP, DONE]).body);
    expect(empty.outcome).toBe("empty");
    expect(empty.finishReason).toBe("stop");
  });

  it("fails open as content when the deadline elapses", async () => {
    // A stream that never emits a frame and never closes.
    const stalled = new ReadableStream({ pull: () => new Promise(() => {}) });
    const peeked = await peekStreamForContent(stalled, { deadlineMs: 20 });
    expect(peeked.outcome).toBe("content");
    expect(peeked.timedOut).toBe(true);
  });
});

describe("reconstructStream is byte-faithful", () => {
  it("replays buffered head bytes and the remaining stream", async () => {
    const frames = [ROLE, CONTENT, `data: {"id":"x","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}\n\n`, DONE];
    const original = frames.join("");
    const peeked = await peekStreamForContent(sseResponse(frames).body);
    const replay = new Response(reconstructStream(peeked.head, peeked.reader, peeked.pendingRead));
    expect(await replay.text()).toBe(original);
  });
});

describe("handleComboChat empty-content fall-through", () => {
  it("falls through to the next model when a stream ends with no content", async () => {
    const calls = [];
    const empty = sseResponse([ROLE, EMPTY_STOP, DONE]);
    const good = jsonResponse({ choices: [{ message: { role: "assistant", content: "answer" } }] });
    const handleSingleModel = vi.fn(async (_body, model) => {
      calls.push(model);
      return model === "a/first" ? empty : good;
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/first", "b/second"],
      handleSingleModel,
      log,
      comboName: "empty-combo",
      comboStrategy: "fallback",
    });

    expect(res).toBe(good);
    expect(calls).toEqual(["a/first", "b/second"]);
  });

  it("keeps a legitimately empty content_filter answer instead of retrying", async () => {
    const calls = [];
    const filtered = sseResponse([ROLE, FILTER_STOP, DONE]);
    const handleSingleModel = vi.fn(async (_body, model) => {
      calls.push(model);
      return filtered;
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/first", "b/second"],
      handleSingleModel,
      log,
      comboName: "filtered-combo",
      comboStrategy: "fallback",
    });

    expect(calls).toEqual(["a/first"]);
    expect(await res.text()).toContain("content_filter");
  });

  it("returns the empty stream as-is when no candidate is left", async () => {
    const calls = [];
    const handleSingleModel = vi.fn(async (_body, model) => {
      calls.push(model);
      return sseResponse([ROLE, EMPTY_STOP, DONE]);
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/first", "b/second"],
      handleSingleModel,
      log,
      comboName: "last-combo",
      comboStrategy: "fallback",
    });

    expect(calls).toEqual(["a/first", "b/second"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"stop"');
  });

  it("clears the smart-router sticky model after an empty generation", async () => {
    const { getStickyComboModel, setStickyComboModel, resetStickyComboStore } = await import("../../open-sse/services/systemoneRouter.js");
    resetStickyComboStore();
    setStickyComboModel("smart-empty", "sess-1", "a/first");

    const empty = sseResponse([ROLE, EMPTY_STOP, DONE]);
    const good = jsonResponse({ choices: [{ message: { role: "assistant", content: "answer" } }] });
    const handleSingleModel = vi.fn(async (_body, model) => (model === "a/first" ? empty : good));

    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/first", "b/second"],
      handleSingleModel,
      log,
      comboName: "smart-empty",
      comboStrategy: "smart",
      sessionId: "sess-1",
      smartPolicy: "strict",
    });

    expect(getStickyComboModel("smart-empty", "sess-1", ["a/first", "b/second"])).toBeNull();
  });
});