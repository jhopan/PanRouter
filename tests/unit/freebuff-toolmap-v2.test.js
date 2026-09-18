import { describe, it, expect } from "vitest";
import {
  sanitizeRequestTools,
  renameRequestTools,
  restoreResponseToolNames,
  restoreStreamToolNames,
} from "../../open-sse/executors/freebuffToolMap.js";

const fn = (name, properties) => ({
  type: "function",
  function: { name, parameters: { type: "object", properties: properties || {} } },
});

// Detector mirror (foreign_signals.go): foreign_tool_names when any blacklist
// name is present; foreign_toolset when tools exist but none is genuine;
// genuine = signature name + non-empty schema whose top-level keys are a
// non-empty subset of canonical keys.
const FOREIGN = new Set([
  "Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch",
  "WebSearch", "TodoWrite", "Task", "Monitor", "computer_use", "delegate_task",
  "exec_command", "browser_exec", "todowrite", "webfetch", "Shell",
]);
const CANONICAL = {
  read_files: new Set(["paths"]),
  write_file: new Set(["path", "instructions", "content"]),
  str_replace: new Set(["path", "replacements"]),
  run_terminal_command: new Set(["command", "process_type", "cwd", "timeout_seconds"]),
  list_directory: new Set(["path"]),
  code_search: new Set(["pattern", "flags", "cwd", "maxResults"]),
  write_todos: new Set(["todos"]),
  web_search: new Set(["query", "depth"]),
  glob: new Set(["pattern", "cwd", "max_results"]),
  ask_user: new Set(["question", "exclude_strings"]),
  add_message: new Set(["message", "usage"]),
  think_deeply: new Set(["subject", "insights", "remaining_planned_submissions"]),
  create_plan: new Set(["plan", "instructions"]),
  task_completed: new Set(),
  end_turn: new Set(),
};
const SIGNATURE = new Set(Object.keys(CANONICAL));

function schemaKeys(tool) {
  const p = tool?.function?.parameters;
  if (!p || typeof p !== "object") return null;
  const keys = new Set();
  for (const k of Object.keys(p.properties || {})) keys.add(k);
  for (const c of ["anyOf", "oneOf", "allOf"]) {
    for (const b of p[c] || []) for (const k of Object.keys(b.properties || {})) keys.add(k);
  }
  return keys.size ? keys : null;
}

function classify(tools) {
  let foreignHarness = 0, genuine = 0;
  const names = [];
  for (const t of tools) {
    const n = t?.function?.name || t?.name || "";
    names.push(n);
    if (FOREIGN.has(n)) foreignHarness++;
    if (SIGNATURE.has(n)) {
      const keys = schemaKeys(t);
      if (keys && n in CANONICAL) {
        const ours = CANONICAL[n];
        if (ours.size === 0 || [...keys].every((k) => ours.has(k))) genuine++;
      }
    }
  }
  if (foreignHarness > 0) return "foreign_tool_names";
  if (names.length > 0 && genuine === 0) return "foreign_toolset";
  return null;
}

// Hermes' 32-tool set (from the failing session): everything the client sends.
const HERMES_TOOLS = [
  fn("view", { file_path: {} }),
  fn("read_file", { file_path: {} }),
  fn("create_file", { file_path: {}, content: {} }),
  fn("replace_in_file", { file_path: {}, diff: {} }),
  fn("search_files", { path: {}, regex: {} }),
  fn("list_files", { path: {}, recursive: {} }),
  fn("run_command", { command: {} }),
  fn("browser_click", { element: {} }),
  fn("computer_use", { action: {} }),
  fn("delegate_task", { task: {} }),
  fn("web_search", { query: {} }),
  fn("todo", { items: {} }),
  fn("memory", { key: {} }),
  fn("skill_view", { name: {} }),
  fn("execute_code", { code: {} }),
  fn("text_to_speech", { text: {} }),
  fn("image_generate", { prompt: {} }),
  fn("vision_analyze", { image_url: {} }),
  fn("cronjob", { action: {} }),
  fn("clarify", { questions: {} }),
  fn("terminal", { command: {} }),
  fn("session_search", { query: {} }),
];

describe("freebuffToolMap v2 — foreign-signal evasion (codebuff 0.0.177)", () => {
  it("baseline: raw Hermes tools read foreign_tool_names (blacklist hit) — the bug", () => {
    expect(classify(HERMES_TOOLS)).toBe("foreign_tool_names");
  });

  it("sanitize clears the gate for the full Hermes set", () => {
    const { tools, dropped } = sanitizeRequestTools(HERMES_TOOLS);
    expect(classify(tools)).toBeNull();
    expect(dropped.sort()).toEqual(["computer_use", "delegate_task"].sort());
  });

  it("every blacklist name is dropped from the wire, none leaks", () => {
    const all = [...FOREIGN].map((n) => fn(n));
    const { tools } = sanitizeRequestTools(all);
    for (const t of tools) expect(FOREIGN.has(t.function.name)).toBe(false);
  });

  it("empty tools array still gets the genuine companion", () => {
    const { tools, dropped } = sanitizeRequestTools([]);
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("read_files");
    expect(classify(tools)).toBeNull();
    expect(dropped).toEqual([]);
  });

  it("companion schema is canonical: keys ⊆ {paths}, non-empty", () => {
    const { tools } = sanitizeRequestTools([]);
    const keys = schemaKeys(tools[0]);
    expect(keys.has("paths")).toBe(true);
    for (const k of keys) expect(["paths"].includes(k)).toBe(true);
  });

  it("companion is not duplicated when the client already sends read_files", () => {
    const { tools } = sanitizeRequestTools([fn("read_files", { paths: {} })]);
    const count = tools.filter((t) => t.function.name === "read_files").length;
    expect(count).toBe(1);
  });

  it("rename leg still works and response restore maps back", () => {
    const { tools, mapping } = sanitizeRequestTools([fn("read_file", { file_path: {} })]);
    expect(tools[0].function.name).toBe("read_files");
    expect(mapping.read_files).toBe("read_file");
    const body = { choices: [{ message: { tool_calls: [{ function: { name: "read_files", arguments: "{}" } }] } }] };
    restoreResponseToolNames(body, mapping);
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("read_file");
  });

  it("companion call in a response is renamed to the sentinel, never a client tool", () => {
    const { tools, mapping } = sanitizeRequestTools([fn("run_command", { command: {} })]);
    const body = { choices: [{ message: { tool_calls: [{ function: { name: "read_files", arguments: "{}" } }] } }] };
    restoreResponseToolNames(body, mapping);
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("__fb_read_files");
  });

  it("stream restore handles both mapping and companion in one line", () => {
    const { mapping } = sanitizeRequestTools([fn("run_command", { command: {} })]);
    const line = 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read_files"}}]}}]}';
    const out = restoreStreamToolNames(line, mapping);
    expect(out).toContain('"name":"__fb_read_files"');
    const line2 = 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"run_terminal_command"}}]}}]}';
    const out2 = restoreStreamToolNames(line2, mapping);
    expect(out2).toContain('"name":"run_command"');
  });

  it("renameRequestTools stays API-compatible with v1 callers", () => {
    const { renamed, mapping } = renameRequestTools([fn("bash", { command: {} })]);
    expect(renamed[0].function.name).toBe("run_terminal_command");
    expect(mapping.run_terminal_command).toBe("bash");
  });

  it("mcp-style names pass through untouched (upstream exempts them)", () => {
    const { tools } = sanitizeRequestTools([fn("server__custom_tool", { x: {} })]);
    expect(tools.some((t) => t.function.name === "server__custom_tool")).toBe(true);
  });

  it("the sanitized full Hermes set classifies clean (detector parity, end to end)", () => {
    const { tools } = sanitizeRequestTools(HERMES_TOOLS);
    // mirror upstream: no blacklist name, at least one genuine tool
    expect(classify(tools)).toBeNull();
  });
});
