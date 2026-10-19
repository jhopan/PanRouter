import { describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => "" } })),
}));

// Break caught: opencode/muse-spark-1.3-contributor-free 400 vì upstream
// chỉ nhận tool_choice "auto"; named/required/none phải demote sang "auto".
//
// The muse-spark contributor family was retired upstream (410 ModelDeprecated,
// 2026-10-19) and is no longer in the catalog, but the quirk stays wired so a
// passthrough id keeps the same wire contract if upstream revives it.
const FREE_13 = "muse-spark-1.3-contributor-free";
const CREDS = { connectionId: "opencode-free-tool-choice-test" };
const INPUT = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];
const TOOLS = [{ type: "function", name: "get_weather", description: "w", parameters: { type: "object", properties: {} } }];

// transformRequest injects the free-tier fingerprint (v2 contract: the CLI's
// own `read` and `shell` definitions, verbatim — see open-sse/utils/
// opencodeFingerprint.js). The v1 bash/glob/grep/read quartet is gone.
const FINGERPRINT_NAMES = ["read", "shell"];
const TOOLS_WITH_FINGERPRINT_NAMES = [...TOOLS.map((t) => t.name), ...FINGERPRINT_NAMES];

function responsesBody(model, tool_choice) {
  const body = { model, input: structuredClone(INPUT), tools: structuredClone(TOOLS) };
  if (tool_choice !== undefined) body.tool_choice = tool_choice;
  return body;
}

describe("opencode Free 1.3 tool_choice auto-only", () => {
  it("khai quirk đúng model 1.3-Free trong registry", () => {
    expect(PROVIDERS.opencode.quirks?.forceAutoToolChoiceModels).toEqual([FREE_13]);
  });

  it.each([
    ["Responses named", { type: "function", name: "get_weather" }],
    ["Chat function named", { type: "function", function: { name: "get_weather" } }],
    ["Claude tool named", { type: "tool", name: "get_weather" }],
    ["required", "required"],
    ["none", "none"],
  ])("demote %s sang auto (plain và max)", (_label, choice) => {
    for (const model of [FREE_13, `${FREE_13}(max)`]) {
      const body = responsesBody(model, structuredClone(choice));
      const out = new OpenCodeExecutor().transformRequest(model, body, true, CREDS);
      expect(out.tool_choice).toBe("auto");
      expect(out.tools.map((t) => t.name)).toEqual(TOOLS_WITH_FINGERPRINT_NAMES);
      expect(out.input).toEqual(INPUT);
    }
  });

  it("giữ auto và absent; tools/input nguyên vẹn", () => {
    const autoOut = new OpenCodeExecutor().transformRequest(
      FREE_13, responsesBody(FREE_13, "auto"), true, CREDS,
    );
    expect(autoOut.tool_choice).toBe("auto");
    expect(autoOut.tools.map((t) => t.name)).toEqual(TOOLS_WITH_FINGERPRINT_NAMES);
    expect(autoOut.input).toEqual(INPUT);

    const absentOut = new OpenCodeExecutor().transformRequest(
      FREE_13, responsesBody(FREE_13, undefined), true, CREDS,
    );
    // Fingerprint leg supplies decoys on Responses → tool_choice defaults to auto.
    expect(absentOut.tool_choice).toBe("auto");
    expect(absentOut.tools.map((t) => t.name)).toEqual(TOOLS_WITH_FINGERPRINT_NAMES);
    expect(absentOut.input).toEqual(INPUT);
  });

  it.each([
    ["1.2-Free", "muse-spark-1.2-contributor-free"],
    ["future 1.4-Free", "muse-spark-1.4-contributor-free"],
    ["Go id", "muse-spark-1.3-contributor"],
    ["non-Muse", "big-pickle"],
  ])("không đổi tool_choice của %s", (_label, model) => {
    const choice = { type: "function", name: "get_weather" };
    const body = responsesBody(model, structuredClone(choice));
    const out = new OpenCodeExecutor().transformRequest(model, body, true, CREDS);
    expect(out.tool_choice).toEqual(choice);
  });

  it("wire: execute gửi choice auto tới /zen/v1/responses", async () => {
    proxyAwareFetch.mockClear();
    const ex = new OpenCodeExecutor();
    const body = responsesBody(FREE_13, { type: "function", name: "get_weather" });
    const { url, transformedBody } = await ex.execute({
      model: FREE_13, body, stream: true, credentials: CREDS,
    });
    expect(url).toBe("https://opencode.ai/inference/v1/responses");
    expect(transformedBody.tool_choice).toBe("auto");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [actualUrl, actualInit] = proxyAwareFetch.mock.calls[0];
    expect(actualUrl).toBe("https://opencode.ai/inference/v1/responses");
    const sent = JSON.parse(actualInit.body);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.model).toBe(FREE_13);
    expect(sent.tools.map((t) => t.name)).toEqual(TOOLS_WITH_FINGERPRINT_NAMES); //TH_FINGERPRINT);
    expect(sent.input).toEqual(INPUT);
  });
});
