import { describe, it, expect } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

// Envelope taken from the shipped Hub 2.32.1 (captured 2026-11-15 via CDP-driven
// prompt against a local relay):
//   requestType: "agent"
//   requestId:   agent/<cascade_id>/<epoch_ms>/<trajectory_id>/<step>
//   request.labels: cascade_id, last_step_index, request_id ("<trajectory>-<step>"),
//                   root_cascade_id, trajectory_id, used_claude,
//                   used_claude_conservative, used_non_gemini_model (all strings)
//   request.generationConfig.maxOutputTokens: 65536
const ex = new AntigravityExecutor();

const baseBody = (model, overrides = {}) => ({
  model,
  request: {
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    systemInstruction: { role: "user", parts: [{ text: "sys" }] },
    generationConfig: { maxOutputTokens: 200000, thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" } },
    sessionId: "-3750763034362895579",
    ...overrides,
  },
});

describe("Antigravity agent envelope (Hub 2.32.1 capture)", () => {
  it("sends requestType agent with the captured labels bag and id format", () => {
    const out = ex.transformRequest("gemini-3.8-flash-high", baseBody("gemini-3.8-flash-high"), true, { connectionId: "conn-1" });

    expect(out.requestType).toBe("agent");
    expect(out.requestId).toMatch(/^agent\/[^/]+\/\d+\/[^/]+\/\d+$/);

    const [, cascadeId, , trajectoryId, step] = out.requestId.split("/");
    const labels = out.request.labels;
    expect(Object.keys(labels).sort()).toEqual([
      "cascade_id",
      "last_step_index",
      "request_id",
      "root_cascade_id",
      "trajectory_id",
      "used_claude",
      "used_claude_conservative",
      "used_non_gemini_model",
    ]);
    expect(labels.cascade_id).toBe(cascadeId);
    expect(labels.root_cascade_id).toBe(cascadeId);
    expect(labels.trajectory_id).toBe(trajectoryId);
    expect(labels.last_step_index).toBe(String(Number(step) - 1));
    expect(labels.request_id).toBe(`${trajectoryId}-${String(Number(step) - 1)}`);
    expect(labels.used_claude).toBe("false");
    expect(labels.used_claude_conservative).toBe("false");
    expect(labels.used_non_gemini_model).toBe("false");
    // model_enum is the Hub's own placeholder table; we omit instead of guess.
    expect(labels.model_enum).toBeUndefined();
  });

  it("caps output tokens at the Hub's 65536", () => {
    const out = ex.transformRequest("gemini-3.8-flash-high", baseBody("gemini-3.8-flash-high"), true, { connectionId: "conn-1" });
    expect(out.request.generationConfig.maxOutputTokens).toBe(65536);
  });

  it("reuses a client-supplied requestId and derives the labels from it", () => {
    const requestId = "agent/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/1794700382990/11111111-2222-3333-4444-555555555555/3";
    const body = baseBody("gemini-3.8-flash-medium");
    body.requestId = requestId;
    const out = ex.transformRequest("gemini-3.8-flash-medium", body, true, { connectionId: "conn-1" });

    expect(out.requestId).toBe(requestId);
    expect(out.request.labels.cascade_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(out.request.labels.trajectory_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(out.request.labels.last_step_index).toBe("2");
    expect(out.request.labels.request_id).toBe("11111111-2222-3333-4444-555555555555-2");
  });

  it("marks Claude models in the used_* flags", () => {
    const out = ex.transformRequest("claude-sonnet-5-5", baseBody("claude-sonnet-5-5"), true, { connectionId: "conn-1" });
    expect(out.request.labels.used_claude).toBe("true");
    expect(out.request.labels.used_non_gemini_model).toBe("true");
  });
});