// Port of upstream 3ca04639 — "fix(codebuddy-intl): preserve client system
// prompts and sanitize CLI agent identity".
//
// Before this, transformRequest threw the whole conversation's system prompt
// away and forced `You are CodeBuddy Code.`, so every user/project prompt was
// lost on every intl request. The gateway still needs exactly ONE leading
// system message (11128 otherwise), so the client's system/developer messages
// are folded into it — neutralising only third-party CLI agent identity
// markers, which is what Tencent's WAF reads as unauthorized tooling.
//
// NOTE: unit tests only. The pattern's behaviour against the live WAF (does a
// neutralised prompt still trip 11128/11140?) needs a real intl account.
import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const NEUTRAL = "You are a helpful AI assistant that helps with software engineering tasks.";

const exec = new CodeBuddyIntlExecutor();
const run = (messages, body = {}) =>
  exec.transformRequest("deepseek-v4.1-flash", { ...body, messages }, false, {});

describe("codebuddy-intl — client system prompts are preserved", () => {
  it("forwards a user system prompt verbatim and keeps typed user blocks", () => {
    const out = run([
      { role: "system", content: "You are a professional translator. Answer in Thai." },
      { role: "user", content: "Translate this text." },
    ]);

    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are a professional translator. Answer in Thai.",
    });
    expect(out.messages[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Translate this text." }],
    });
    expect(out.stream).toBe(true);
  });

  it("leaves a long, non-identity system prompt untouched (no length catch-all)", () => {
    // The CN executor replaces prompts over 2000 chars as a heuristic. The intl
    // executor must NOT: a project instruction file is legitimately huge.
    const long = `Project rules:\n${"Always run focused tests. ".repeat(200)}`;
    const out = run([
      { role: "system", content: long },
      { role: "user", content: "go" },
    ]);

    expect(out.messages[0].content).toBe(long);
  });

  it("neutralises a third-party agent identity prompt", () => {
    const out = run([
      { role: "system", content: "You are Claude Code, Anthropic's official CLI for coding." },
      { role: "user", content: "Fix this bug" },
    ]);

    expect(out.messages[0]).toEqual({ role: "system", content: NEUTRAL });
  });

  it("keeps user content even when the system prompt was neutralised", () => {
    const out = run([
      { role: "system", content: "You are Cline, an AI coding agent." },
      { role: "user", content: "Refactor src/app.js" },
      { role: "assistant", content: "Sure." },
      { role: "user", content: "Now add tests." },
    ]);

    expect(out.messages[0].content).toBe(NEUTRAL);
    expect(out.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(out.messages[1].content).toEqual([{ type: "text", text: "Refactor src/app.js" }]);
    expect(out.messages[2].content).toBe("Sure.");
    expect(out.messages[3].content).toEqual([{ type: "text", text: "Now add tests." }]);
  });

  it("does not neutralise agent names that appear only in user content", () => {
    const out = run([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Why does Claude Code print that banner?" },
    ]);

    expect(out.messages[0].content).toBe("Be concise.");
    expect(out.messages[1].content).toEqual([
      { type: "text", text: "Why does Claude Code print that banner?" },
    ]);
  });
});

describe("codebuddy-intl — fallback and shape handling", () => {
  it("falls back to the CodeBuddy default when the client sent no system prompt", () => {
    const out = run([{ role: "user", content: "Hello" }]);

    expect(out.messages[0]).toEqual({ role: "system", content: "You are CodeBuddy Code." });
    expect(out.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "Hello" }] });
  });

  it("falls back when the client's system message is empty", () => {
    const out = run([
      { role: "system", content: "" },
      { role: "user", content: "Hello" },
    ]);

    expect(out.messages[0].content).toBe("You are CodeBuddy Code.");
  });

  it("flattens block-array system content into the single leading prompt", () => {
    const out = run([
      {
        role: "system",
        content: [
          { type: "text", text: "You are reviewing a TypeScript service." },
          { type: "image", source: {} },
          { type: "text", text: "Prefer small diffs." },
        ],
      },
      { role: "user", content: "Review it" },
    ]);

    // Upstream joins every block with "\n"; a non-text block contributes an
    // empty segment, hence the blank line. Only string `text` fields reach the
    // prompt — block payloads (image sources etc.) never do.
    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are reviewing a TypeScript service.\n\nPrefer small diffs.",
    });
  });

  it("treats developer role like system and folds them in order", () => {
    const out = run([
      { role: "system", content: "System: answer in German." },
      { role: "developer", content: [{ type: "text", text: "Developer: use metric units." }] },
      { role: "user", content: "Wie hoch ist der Turm?" },
    ]);

    expect(out.messages).toHaveLength(2);
    expect(out.messages[0]).toEqual({
      role: "system",
      content: "System: answer in German.\n\nDeveloper: use metric units.",
    });
    expect(out.messages[1].role).toBe("user");
  });

  it("keeps the reasoning-effort handling intact", () => {
    const on = run([{ role: "user", content: "hi" }], { reasoning_effort: "high" });
    expect(on.reasoning_summary).toBe("auto");
    expect(on.reasoning_effort).toBe("high");

    const off = run([{ role: "user", content: "hi" }], { reasoning_effort: "none" });
    expect(off.reasoning_effort).toBeUndefined();
    expect(off.reasoning_summary).toBeUndefined();
  });
});