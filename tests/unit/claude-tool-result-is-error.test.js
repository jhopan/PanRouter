import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

// Ported from upstream 7372d38d. Zed's Anthropic wire types (and other strict
// serde parsers) require `is_error` as a non-optional bool on every tool_result.
// Anthropic's own API treats it as optional, so always emitting it is safe.
function toolResults(body) {
  const out = openaiToClaudeRequest("claude-sonnet-4-6", body, false);
  return out.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result");
}

describe("tool_result always carries is_error", () => {
  it("emits is_error:false for a successful role:tool message", () => {
    const [block] = toolResults({
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "Bash", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "t1", content: "done" },
      ],
    });

    expect(block).toBeDefined();
    expect(block).toHaveProperty("is_error");
    expect(block.is_error).toBe(false);
  });

  it("emits is_error:true when the tool call failed", () => {
    const [block] = toolResults({
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "t2", type: "function", function: { name: "Bash", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "t2", content: "boom", status: "error" },
      ],
    });

    expect(block).toBeDefined();
    expect(block.is_error).toBe(true);
  });

  it("reads is_error from a typed user part too", () => {
    const [block] = toolResults({
      messages: [
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: "ok" }] },
      ],
    });

    expect(block).toBeDefined();
    expect(block.is_error).toBe(false);      // present, not omitted
  });
});