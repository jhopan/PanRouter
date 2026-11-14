import { describe, expect, it } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

// Ported from upstream ced0cf6e. NVIDIA NIM treats `reasoning` and
// `reasoning_content` as aliases for the SAME field, so an assistant message
// carrying both makes its deserializer fail with a duplicate-field 400.
describe("nvidia reasoning alias on assistant history", () => {
  const history = (extra) => [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello", ...extra },
  ];

  it("renames reasoning to reasoning_content", () => {
    const body = { messages: history({ reasoning: "because" }) };
    stripUnsupportedParams("nvidia", "nemotron-3-ultra", body);

    expect(body.messages[1].reasoning).toBeUndefined();
    expect(body.messages[1].reasoning_content).toBe("because");
  });

  it("keeps an existing non-empty reasoning_content", () => {
    const body = { messages: history({ reasoning: "old", reasoning_content: "canonical" }) };
    stripUnsupportedParams("nvidia", "nemotron-3-ultra", body);

    expect(body.messages[1].reasoning_content).toBe("canonical");
    expect(body.messages[1].reasoning).toBeUndefined();
  });

  it("fills in when the existing value is blank", () => {
    const body = { messages: history({ reasoning: "real", reasoning_content: "   " }) };
    stripUnsupportedParams("nvidia", "nemotron-3-ultra", body);

    expect(body.messages[1].reasoning_content).toBe("real");
  });

  it("does not touch other providers", () => {
    const body = { messages: history({ reasoning: "because" }) };
    stripUnsupportedParams("openrouter", "some/model", body);

    expect(body.messages[1].reasoning).toBe("because");
  });

  it("leaves user messages alone", () => {
    const body = { messages: [{ role: "user", content: "hi", reasoning: "keep" }] };
    stripUnsupportedParams("nvidia", "nemotron-3-ultra", body);

    expect(body.messages[0].reasoning).toBe("keep");
  });
});