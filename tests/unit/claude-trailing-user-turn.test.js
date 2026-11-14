import { describe, expect, it } from "vitest";
import {
  ensureTrailingUserTurn,
  prepareClaudeRequest,
} from "../../open-sse/translator/formats/claude.js";

// Ported from upstream 75834e96. Anthropic rejects a body that ends on an
// assistant turn ("This model does not support assistant message prefill").
// The cleanup pass deletes messages left empty, so an emptied trailing user turn
// silently promoted the previous assistant turn into the last one.
const roles = (messages) => messages.map((m) => m.role);

describe("ensureTrailingUserTurn", () => {
  it("restores a user turn when cleanup left an assistant turn last", () => {
    const out = ensureTrailingUserTurn(
      [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
      "user",                              // the client did end on a user turn
    );

    expect(roles(out)).toEqual(["user", "assistant", "user"]);
    expect(out[2].content[0].text).toBe("Continue.");
  });

  it("respects a client that deliberately ended on assistant (real prefill)", () => {
    const messages = [{ role: "user", content: "hi" }, { role: "assistant", content: "Sure," }];
    expect(ensureTrailingUserTurn(messages, "assistant")).toBe(messages);
  });

  it("does nothing when the last turn is already a user turn", () => {
    const messages = [{ role: "user", content: "hi" }];
    expect(ensureTrailingUserTurn(messages, "user")).toBe(messages);
  });

  it("tolerates a non-array", () => {
    expect(ensureTrailingUserTurn(null, "user")).toBe(null);
  });
});

describe("prepareClaudeRequest keeps a trailing user turn", () => {
  it("appends a user turn when the last client turn was emptied by cleanup", () => {
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
        { role: "user", content: "" },      // emptied → dropped by the cleanup pass
      ],
    };

    prepareClaudeRequest(body, "claude");

    expect(body.messages.at(-1).role).toBe("user");
  });
});