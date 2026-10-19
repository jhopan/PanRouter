// A5 (cases #7/#9/#10): lock hardcode->config no-op values.
import { describe, it, expect } from "vitest";
import {
  OPENAI_COMPAT_BASE,
  ANTHROPIC_COMPAT_BASE,
  ANTHROPIC_API_VERSION,
} from "../../open-sse/providers/shared.js";
import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../open-sse/config/runtimeConfig.js";
import mimoFree from "../../open-sse/providers/registry/mimo-free.js";
import opencode from "../../open-sse/providers/registry/opencode.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

describe("compat base URLs / version", () => {
  it("OPENAI_COMPAT_BASE", () => {
    expect(OPENAI_COMPAT_BASE).toBe("https://api.openai.com/v1");
  });
  it("ANTHROPIC_COMPAT_BASE", () => {
    expect(ANTHROPIC_COMPAT_BASE).toBe("https://api.anthropic.com/v1");
  });
  it("ANTHROPIC_API_VERSION", () => {
    expect(ANTHROPIC_API_VERSION).toBe("2023-06-01");
  });
});

describe("default token limits", () => {
  it("max/min", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(64000);
    expect(DEFAULT_MIN_TOKENS).toBe(32000);
  });
});

describe("provider baseUrl const (full path, no trailing slash)", () => {
  it("mimo-free full path", () => {
    expect(mimoFree.transport.baseUrl).toBe("https://api.xiaomimimo.com/api/free-ai/openai/chat");
  });
  it("opencode no trailing slash", () => {
    expect(opencode.transport.baseUrl).toBe("https://opencode.ai");
  });
});

describe("antigravity retry (429=6 was proposed but never landed; current = 3)", () => {
  // A "429 → 6 attempts" change was written into this test but never shipped:
  // open-sse/providers/registry/antigravity.js (and upstream master) both still
  // set attempts: 3 for 429/500/503. Assert the real values instead of an
  // unimplemented intention — raising 429 retries would also mean more traffic
  // against a rate-limited account.
  it("429 attempts = 3", () => {
    expect(antigravity.transport.retry["429"].attempts).toBe(3);
  });
  it("503 attempts = 3", () => {
    expect(antigravity.transport.retry["503"].attempts).toBe(3);
  });
  it("500 attempts = 3", () => {
    expect(antigravity.transport.retry["500"].attempts).toBe(3);
  });
});

describe("OpenCode Free endpoint routing", () => {
  it("declares no transport-wide format (every catalog model is chat)", () => {
    expect(opencode.transport.format).toBeUndefined();
    // The muse-spark contributor models that needed targetFormat
    // "openai-responses" were retired upstream (410 ModelDeprecated,
    // 2026-10-19) and dropped from the catalog.
    expect(opencode.models.some((m) => m.targetFormat)).toBe(false);
  });

  it("routes every catalog model to the v2 /inference/v1/chat/completions", () => {
    const executor = new OpenCodeExecutor();
    for (const model of opencode.models) {
      expect(executor.buildUrl(model.id)).toBe("https://opencode.ai/inference/v1/chat/completions");
    }
    // isMuseSparkModel() still routes a passthrough id to /responses, so an
    // upstream revival of the family keeps working without a code change.
    expect(executor.buildUrl("muse-spark-2.0-contributor-free(xhigh)"))
      .toBe("https://opencode.ai/inference/v1/responses");
  });

  it("normalizes Chat token/thinking fields only for the Responses model", () => {
    const executor = new OpenCodeExecutor();
    // Passthrough muse-spark id — the family is retired from the catalog but
    // isMuseSparkModel() still routes it, so the Responses normalization must
    // keep working if upstream revives it.
    const muse = { max_tokens: 4096, reasoning_effort: "high" };
    executor.transformRequest("muse-spark-2.0-contributor-free", muse, true, {});
    expect(muse.max_output_tokens).toBe(4096);
    expect(muse.max_tokens).toBeUndefined();
    expect(muse.reasoning).toEqual({ effort: "high", summary: "auto" });

    const chat = { max_tokens: 4096, reasoning_effort: "high" };
    executor.transformRequest("big-pickle", chat, true, {});
    expect(chat.max_tokens).toBe(4096);
    expect(chat.max_output_tokens).toBeUndefined();
    expect(chat.reasoning_effort).toBe("high");
  });
});
