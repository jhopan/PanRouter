import { describe, expect, it } from "vitest";
import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";

// Ported from upstream ef2af4de. convertGeminiContent() used to `return` on the
// first functionResponse it met, so a turn carrying parallel tool results lost
// every result after the first — and any co-located follow-up text with them.
describe("Gemini → OpenAI: parallel tool results", () => {
  it("keeps every tool result and puts them before the follow-up message", () => {
    const out = geminiToOpenAIRequest("gemini-3.8-flash", {
      contents: [
        {
          role: "user",
          parts: [
            { functionResponse: { name: "a", id: "call_a", response: { result: "r1" } } },
            { functionResponse: { name: "b", id: "call_b", response: { result: "r2" } } },
            { text: "and now continue" },
          ],
        },
      ],
    }, false);

    expect(out.messages).toHaveLength(3);
    expect(out.messages[0]).toMatchObject({ role: "tool", tool_call_id: "call_a" });
    expect(out.messages[1]).toMatchObject({ role: "tool", tool_call_id: "call_b" });
    expect(out.messages[2].role).toBe("user");     // the Gemini content's own role
    expect(out.messages[2].content).toBe("and now continue");
  });

  it("returns only the tool messages when there is no follow-up", () => {
    const out = geminiToOpenAIRequest("gemini-3.8-flash", {
      contents: [
        {
          role: "user",
          parts: [
            { functionResponse: { name: "a", id: "c1", response: { result: "x" } } },
            { functionResponse: { name: "b", id: "c2", response: { result: "y" } } },
          ],
        },
      ],
    }, false);

    expect(out.messages.map((m) => m.role)).toEqual(["tool", "tool"]);
  });

  it("still carries the result payload through", () => {
    const out = geminiToOpenAIRequest("gemini-3.8-flash", {
      contents: [{ role: "user", parts: [{ functionResponse: { name: "a", id: "c9", response: { result: "hello" } } }] }],
    }, false);

    expect(out.messages[0].content).toContain("hello");
  });
});