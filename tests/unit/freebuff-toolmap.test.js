import { describe, it, expect } from "vitest";
import { renameRequestTools, restoreResponseToolNames, restoreStreamToolNames } from "../../open-sse/executors/freebuffToolMap.js";

const fn = (name) => ({ type: "function", function: { name, parameters: { type: "object", properties: {} } } });

describe("renameRequestTools", () => {
  it("renames harness tool names to signature equivalents and records mapping", () => {
    const tools = [fn("bash"), fn("read_file"), fn("write_to_file")];
    const { renamed, mapping } = renameRequestTools(tools);
    // v2: exec_* blacklist names never reach the wire; bash renames to
    // run_terminal_command; read_file renames to read_files (companion
    // suppressed — a genuine-shaped read_files already present).
    expect(renamed.map((t) => t.function.name)).toEqual([
      "run_terminal_command", "read_files", "write_file",
    ]);
    expect(mapping).toEqual({ run_terminal_command: "bash", read_files: "read_file", write_file: "write_to_file" });
  });

  it("leaves known-mapped tools renamed; genuine signature tool keeps everything clear", () => {
    const tools = [fn("bash"), fn("think_deeply")];
    const { renamed, mapping } = renameRequestTools(tools);
    // v2 changed the early-exit: mapping is applied even alongside signature
    // tools (rename is harmless — hollow is log-only upstream). The
    // read_files companion is appended by sanitize; renameRequestTools keeps
    // parity with the sanitize pipeline.
    expect(renamed.map((t) => t.function.name)).toEqual(["run_terminal_command", "think_deeply", "read_files"]);
    expect(mapping).toEqual({ run_terminal_command: "bash" });
  });

  it("ignores unknown custom tools (mcp_*, project tools)", () => {
    const tools = [fn("mcp_vps_exec"), fn("calc")];
    const { renamed, mapping } = renameRequestTools(tools);
    // mcp_/unknown names pass through (observe-only upstream) + companion
    expect(renamed.map((t) => t.function.name)).toEqual(["mcp_vps_exec", "calc", "read_files"]);
    expect(mapping).toEqual({});
  });

  it("handles OpenAI-shaped and flat tools", () => {
    const flat = [{ name: "local_shell", parameters: { properties: { command: {} } } }];
    const { renamed, mapping } = renameRequestTools(flat);
    expect(renamed[0].name).toBe("run_terminal_command");
    expect(mapping.run_terminal_command).toBe("local_shell");
  });

  it("empty tools → companion only (foreign_toolset still clears)", () => {
    const { renamed, mapping } = renameRequestTools([]);
    expect(renamed).toHaveLength(1);
    expect(renamed[0].function.name).toBe("read_files");
    expect(mapping).toEqual({});
  });
});

describe("restoreResponseToolNames", () => {
  it("restores names in JSON choices[].message.tool_calls", () => {
    const mapping = { run_terminal_command: "bash" };
    const data = { choices: [{ message: { role: "assistant", tool_calls: [{ id: "1", function: { name: "run_terminal_command", arguments: "{}" } }] } }] };
    restoreResponseToolNames(data, mapping);
    expect(data.choices[0].message.tool_calls[0].function.name).toBe("bash");
  });

  it("no mapping → untouched", () => {
    const data = { choices: [{ message: { tool_calls: [{ function: { name: "bash" } }] } }] };
    restoreResponseToolNames(data, {});
    expect(data.choices[0].message.tool_calls[0].function.name).toBe("bash");
  });
});

describe("restoreStreamToolNames", () => {
  it("rewrites SSE data lines containing renamed tool calls", () => {
    const mapping = { run_terminal_command: "bash" };
    const line = 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"run_terminal_command","arguments":"{\\"command\\":\\"ls\\"}"}}]}}]}';
    const out = restoreStreamToolNames(line, mapping);
    expect(out).toContain('"name":"bash"');
    expect(out).not.toContain('"name":"run_terminal_command"');
  });

  it("passes through lines without tool_calls or non-data lines", () => {
    const mapping = { run_terminal_command: "bash" };
    expect(restoreStreamToolNames("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}", mapping)).not.toContain("bash");
    expect(restoreStreamToolNames(": connected", mapping)).toBe(": connected");
  });
});
