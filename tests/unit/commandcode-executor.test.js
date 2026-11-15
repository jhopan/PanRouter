import { describe, it, expect, vi } from "vitest";
import {
  parseCommandCodeError,
  inspectAndWrapCommandCodeResponse,
  CommandCodeExecutor,
} from "../../open-sse/executors/commandcode.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

function createNdjsonStream(lines) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(typeof line === "string" ? line : JSON.stringify(line) + "\n"));
      }
      controller.close();
    },
  });
}

describe("parseCommandCodeError", () => {
  it("parses user exact error payload with statusCode 503 and isRetryable", () => {
    const event = {
      type: "error",
      error: {
        type: "server_error",
        message: "Service temporarily unavailable. Please try again shortly.",
        statusCode: 503,
        isRetryable: true,
      },
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(503);
    expect(parsed.message).toBe("Service temporarily unavailable. Please try again shortly.");
    expect(parsed.type).toBe("server_error");
  });

  it("handles string error message", () => {
    const event = {
      type: "error",
      message: "Rate limit exceeded. Please wait 30s.",
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.message).toBe("Rate limit exceeded. Please wait 30s.");
  });

  it("handles plain error string in error property", () => {
    const event = {
      type: "error",
      error: "Unauthorized access",
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(401);
    expect(parsed.message).toBe("Unauthorized access");
  });
});

describe("inspectAndWrapCommandCodeResponse", () => {
  it("converts initial upstream 200 with error event to 503 Response", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({
        type: "error",
        error: {
          type: "server_error",
          message: "Service temporarily unavailable. Please try again shortly.",
          statusCode: 503,
          isRetryable: true,
        },
      }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);

    const body = await result.json();
    expect(body.error.message).toContain("Service temporarily unavailable");
    expect(body.error.code).toBe(503);
  });

  it("converts initial upstream 200 with start/start-step followed by error to 503 Response", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({ type: "start" }) + "\n",
      JSON.stringify({ type: "start-step" }) + "\n",
      JSON.stringify({
        type: "error",
        error: {
          type: "server_error",
          message: "Service temporarily unavailable. Please try again shortly.",
          statusCode: 503,
          isRetryable: true,
        },
      }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);

    const body = await result.json();
    expect(body.error.message).toContain("Service temporarily unavailable");
  });

  it("streams successful responses when content is emitted", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({ type: "start" }) + "\n",
      JSON.stringify({ type: "text-delta", text: "Hello from Laguna" }) + "\n",
      JSON.stringify({ type: "finish" }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);

    const text = await result.text();
    expect(text).toContain("Hello from Laguna");
    expect(text).toContain("data: [DONE]");
  });

  it("preserves all lines in a multi-line packet when inspecting tool-input-start", async () => {
    const packet = [
      JSON.stringify({ type: "start" }),
      JSON.stringify({ type: "start-step" }),
      JSON.stringify({ type: "tool-input-start", id: "call_1", toolName: "terminal" }),
      JSON.stringify({ type: "tool-input-delta", id: "call_1", delta: '{"command": "ls"}' }),
      JSON.stringify({ type: "finish-step", finishReason: "tool-calls" }),
      JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
    ].join("\n") + "\n";

    const ndjsonBody = createNdjsonStream([packet]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "cmc/deepseek/deepseek-v4.1-flash");
    expect(result.ok).toBe(true);
    const text = await result.text();
    expect(text).toContain('"name":"terminal"');
    expect(text).toContain('"arguments":"{\\"command\\": \\"ls\\"}"');
  });

  it("retries a transient in-stream error and succeeds on the next attempt", async () => {
    const executor = new CommandCodeExecutor();
    const ndjson = (events) =>
      new Response(createNdjsonStream(events.map((e) => JSON.stringify(e) + "\n")), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

    let callCount = 0;
    const spy = vi.spyOn(BaseExecutor.prototype, "execute").mockImplementation(async () => {
      callCount++;
      return {
        response:
          callCount === 1
            ? ndjson([{ type: "error", error: { statusCode: 503, message: "Network connection lost." } }])
            : ndjson([
                { type: "start" },
                { type: "text-delta", text: "Recovered from lost connection" },
                { type: "finish" },
              ]),
      };
    });

    try {
      const res = await executor.execute({
        model: "deepseek/deepseek-v4.1-flash",
        log: { debug: vi.fn() },
      });
      expect(callCount).toBe(2);
      expect(res.response.ok).toBe(true);
      const text = await res.response.text();
      expect(text).toContain("Recovered from lost connection");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not retry a non-transient upstream error", async () => {
    const executor = new CommandCodeExecutor();
    let callCount = 0;
    const spy = vi.spyOn(BaseExecutor.prototype, "execute").mockImplementation(async () => {
      callCount++;
      return {
        response: new Response(
          createNdjsonStream([JSON.stringify({ type: "error", error: { statusCode: 401, message: "Invalid API key" } }) + "\n"]),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      };
    });

    try {
      const res = await executor.execute({ model: "deepseek/deepseek-v4.1-flash", log: { debug: vi.fn() } });
      expect(callCount).toBe(1);
      expect(res.response.status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("CommandCode in Combo Fallback", () => {
  it("automatically falls back to next model when commandcode returns 503 error", async () => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const handleSingleModel = vi.fn(async (body, modelStr) => {
      if (modelStr === "commandcode/poolside/laguna-s-2.1-free") {
        // Simulated failed CommandCode response
        return new Response(
          JSON.stringify({
            error: {
              message: "Service temporarily unavailable. Please try again shortly.",
              type: "server_error",
              code: 503,
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }

      if (modelStr === "openai/gpt-4o-mini") {
        // Fallback model succeeds
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            choices: [{ message: { role: "assistant", content: "Fallback success!" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const comboResponse = await handleComboChat({
      body: { messages: [{ role: "user", content: "Hello" }] },
      models: ["commandcode/poolside/laguna-s-2.1-free", "openai/gpt-4o-mini"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(comboResponse.ok).toBe(true);
    expect(comboResponse.status).toBe(200);

    const data = await comboResponse.json();
    expect(data.choices[0].message.content).toBe("Fallback success!");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(handleSingleModel).toHaveBeenNthCalledWith(1, expect.anything(), "commandcode/poolside/laguna-s-2.1-free");
    expect(handleSingleModel).toHaveBeenNthCalledWith(2, expect.anything(), "openai/gpt-4o-mini");
  });
});
