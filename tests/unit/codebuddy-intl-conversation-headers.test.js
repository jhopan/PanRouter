// #4892 — the intl gateway added "channel verification": requests without the
// X-Conversation-* header family are rejected with HTTP 400 code 11128
// "request illegal". The official IDE sends a conversation id derived
// stably from the session key plus fresh per-request/per-message UUIDs.
import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("CodeBuddyIntlExecutor sends the X-Conversation-* family (#4892)", () => {
  const exec = new CodeBuddyIntlExecutor();
  const creds = { accessToken: "test-token" };

  it("always sets the three headers", () => {
    const h = exec.buildHeaders(creds, true, "https://www.codebuddy.ai/v2/chat/completions", "deepseek-v4.1-flash", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(h["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(h["X-Conversation-Message-ID"]).toMatch(UUID_RE);
  });

  it("keeps the conversation id stable across retries of the same turn", () => {
    const body = { messages: [{ role: "user", content: "same opening message" }] };
    const a = exec.buildHeaders(creds, true, "u", "m", body);
    const b = exec.buildHeaders(creds, true, "u", "m", body);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
    // per-request ids must stay fresh
    expect(a["X-Conversation-Request-ID"]).not.toBe(b["X-Conversation-Request-ID"]);
    expect(a["X-Conversation-Message-ID"]).not.toBe(b["X-Conversation-Message-ID"]);
  });

  it("prefers an explicit session_id over message-derived key", () => {
    const body = {
      session_id: "sess-123",
      messages: [{ role: "user", content: "hi" }],
    };
    const a = exec.buildHeaders(creds, true, "u", "m", body);
    const b = exec.buildHeaders(creds, true, "u", "m", body);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
    const c = exec.buildHeaders(creds, true, "u", "m", {
      session_id: "sess-456",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(c["X-Conversation-ID"]).not.toBe(a["X-Conversation-ID"]);
  });

  it("derives conversation id from typed-block user content", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "hello world" }] }],
    };
    const a = exec.buildHeaders(creds, true, "u", "m", body);
    const b = exec.buildHeaders(creds, true, "u", "m", body);
    expect(a["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
  });

  it("falls back to a random UUID when there is no session key or messages", () => {
    const a = exec.buildHeaders(creds, true, "u", "m", null);
    const b = exec.buildHeaders(creds, true, "u", "m", null);
    expect(a["X-Conversation-ID"]).toMatch(UUID_RE);
    // random fallback — different each time
    expect(a["X-Conversation-ID"]).not.toBe(b["X-Conversation-ID"]);
  });
});

// ── UUID v1, matching the official client ──────────────────────────────────
// The CLI's conversation id is time-based: it encodes a creation timestamp and
// a node id, so a reader can tell when the conversation opened and which
// machine opened it. A v5/v7 content hash carries neither.
describe("CodeBuddyIntlExecutor — v1 time-based ids", () => {
  const exec = new CodeBuddyIntlExecutor();
  const creds = { accessToken: "test-token" };
  const body = { session_id: "sess-v1", messages: [{ role: "user", content: "hi" }] };

  it("uses UUID version 1 for the conversation id", () => {
    const h = exec.buildHeaders(creds, true, "u", "m", body);
    expect(h["X-Conversation-ID"][14]).toBe("1");
  });

  it("uses UUID version 1 for the per-turn ids", () => {
    const h = exec.buildHeaders(creds, true, "u", "m", body);
    expect(h["X-Conversation-Message-ID"][14]).toBe("1");
    expect(h["X-Conversation-Request-ID"][14]).toBe("1");
    expect(h["X-Request-ID"][14]).toBe("1");
  });

  it("carries the RFC-4122 variant bits", () => {
    const h = exec.buildHeaders(creds, true, "u", "m", body);
    expect(h["X-Conversation-ID"][19]).toMatch(/[89ab]/);
  });

  it("pins the node id like the official client", () => {
    const h = exec.buildHeaders(creds, true, "u", "m", body);
    expect(h["X-Conversation-ID"].endsWith("426614174000")).toBe(true);
    expect(h["X-Conversation-Message-ID"].endsWith("426614174000")).toBe(true);
  });

  it("keeps the conversation id stable while the per-turn id rotates", () => {
    const a = exec.buildHeaders(creds, true, "u", "m", body);
    const b = exec.buildHeaders(creds, true, "u", "m", body);
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
    expect(a["X-Conversation-Message-ID"]).not.toBe(b["X-Conversation-Message-ID"]);
  });
});
