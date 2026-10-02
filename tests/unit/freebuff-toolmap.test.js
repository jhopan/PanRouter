import { describe, it, expect } from "vitest";
import { renameRequestTools, sanitizeRequestTools, restoreResponseToolNames, restoreStreamToolNames } from "../../open-sse/executors/freebuffToolMap.js";

const fn = (name) => ({ type: "function", function: { name, parameters: { type: "object", properties: {} } } });

// v2.1: rename leg DISABLED (live matrix 2026-09-19 — hollow is enforced
// upstream when no genuine tool exists, and rename manufactured hollows while
// suppressing the genuine companion). Pipeline now: DROP blacklist names →
// PASS THROUGH everything else → APPEND genuine read_files companion.
describe("renameRequestTools (v2.1 pipeline)", () => {
  it("drops blacklist names, keeps client names, appends companion", () => {
    const tools = [fn("bash"), fn("read_file"), fn("computer_use"), fn("delegate_task")];
    const { renamed, mapping, dropped } = renameRequestTools(tools);
    expect(renamed.map((t) => t.function.name).sort()).toEqual(["bash", "read_file", "read_files"].sort());
    expect(dropped.sort()).toEqual(["computer_use", "delegate_task"].sort());
    expect(mapping).toEqual({});
  });

  it("unknown custom tools (mcp_*, project tools) pass through", () => {
    const tools = [fn("mcp_vps_exec"), fn("calc")];
    const { renamed, mapping } = renameRequestTools(tools);
    expect(renamed.map((t) => t.function.name).sort()).toEqual(["calc", "mcp_vps_exec", "read_files"].sort());
    expect(mapping).toEqual({});
  });

  it("companion suppressed when a genuine-shaped read_files already present", () => {
    const genuine = { type: "function", function: { name: "read_files", parameters: { type: "object", properties: { paths: { type: "array", items: { type: "string" } } }, required: ["paths"] } } };
    const { renamed } = renameRequestTools([genuine]);
    expect(renamed.filter((t) => t.function.name === "read_files")).toHaveLength(1);
  });

  it("empty tools → companion only (foreign_toolset still clears)", () => {
    const { renamed, mapping } = renameRequestTools([]);
    expect(renamed).toHaveLength(1);
    expect(renamed[0].function.name).toBe("read_files");
    expect(mapping).toEqual({});
  });
});

describe("restore paths", () => {
  it("restores names in JSON choices[].message.tool_calls", () => {
    const mapping = { read_files: "read_file" };
    const data = { choices: [{ message: { role: "assistant", tool_calls: [{ id: "1", function: { name: "read_files", arguments: "{}" } }] } }] };
    restoreResponseToolNames(data, mapping);
    expect(data.choices[0].message.tool_calls[0].function.name).toBe("read_file");
  });

  it("no mapping → untouched", () => {
    const data = { choices: [{ message: { tool_calls: [{ function: { name: "bash" } }] } }] };
    restoreResponseToolNames(data, {});
    expect(data.choices[0].message.tool_calls[0].function.name).toBe("bash");
  });

  it("companion renamed to sentinel in JSON (mapping empty)", () => {
    const data = { choices: [{ message: { tool_calls: [{ function: { name: "read_files", arguments: "{}" } }] } }] };
    restoreResponseToolNames(data, {});
    expect(data.choices[0].message.tool_calls[0].function.name).toBe("__fb_read_files");
  });

  it("stream: companion → sentinel; client names untouched when no mapping", () => {
    const line = 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read_files"}}]}}]}';
    expect(restoreStreamToolNames(line, {})).toContain('"name":"__fb_read_files"');
    const line2 = 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"bash"}}]}}]}';
    expect(restoreStreamToolNames(line2, {})).toContain('"name":"bash"');
  });

  it("stream: mapping entries still restored (legacy fixtures)", () => {
    const mapping = { read_files: "read_file" };
    const line = 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read_files"}}]}}]}';
    const out = restoreStreamToolNames(line, mapping);
    // mapping restore wins for mapped names; sentinel applies only to the
    // bare companion (same name — mapping restored first by design)
    expect(out).toContain('"name":"read_file"');
  });
});

describe("sanitizeRequestTools (direct v2 API)", () => {
  it("drops blacklist + companion, keeps passthrough", () => {
    const { tools, dropped } = sanitizeRequestTools([fn("view"), fn("Monitor"), fn("browser_exec")]);
    expect(dropped.sort()).toEqual(["Monitor", "browser_exec"].sort());
    expect(tools.map((t) => t.function.name).sort()).toEqual(["read_files", "view"].sort());
  });
});
