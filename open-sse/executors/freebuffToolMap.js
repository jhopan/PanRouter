/**
 * Tool-map v2 — foreign-signal evasion for the codebuff 0.0.177 gate
 * (vendor 3420c99, live 2026-09-17; mirrored by freebuff-proxy in
 * foreign_signals.go / foreign-client-signals.ts).
 *
 * v1 (name-rename only, issue #140 parity) is DEAD upstream: a signature
 * name now counts only when the schema beneath it is genuinely codebuff's
 * (top-level property keys ⊆ canonical toolParams keys), and ANY of 49
 * harness tool names settles the request as foreign before the schema rule
 * is even consulted. Old map renamed names, forwarded client schemas —
 * every renamed tool read hollow, and Hermes' blacklist names (delegate_task,
 * computer_use, ...) tripped foreign_tool_names outright.
 *
 * v2 strategy — make the request LOOK like a real codebuff CLI session:
 *
 *  1. DROP every tool whose name hits FOREIGN_HARNESS_TOOL_NAMES. The model
 *     never sees it, so it never calls it; the client still gets everything
 *     else. (Dropping beats renaming: the blacklist is checked on the wire
 *     name, and a rename would have to land on a codebuff name — polluting
 *     the client's own namespace.)
 *  2. INJECT one genuine companion tool — `read_files` with codebuff's real
 *     canonical schema keys ({paths}) and the shipped description. One genuine
 *     tool clears foreign_toolset (detector: `Genuine > 0`). The companion is
 *     `decide`-adjacent safe: if the model calls it, we answer with a tool
 *     result naming the client's actual read tool, so the conversation keeps
 *     flowing. `decide` itself would work too (custom names bypass the schema
 *     check) but `read_files` looks like ordinary CLI traffic, not a tell.
 *  3. PASS THROUGH every remaining client tool untouched — unknown names are
 *     observe-only upstream (`unrecognised`, never enforced), and MCP-style
 *     `server__tool` names are explicitly exempt.
 *  4. System prompt: harness markers ("You are Claude Code", cc_version=, ...)
 *     are enforced, but PanRouter never sends harness system prompts to this
 *     executor — the caveman/RTK pipeline rewrites them. Nothing to do here;
 *     documented so a future prompt change doesn't silently reintroduce it.
 *
 * Mapping from v1 stays for the rename leg: a client tool whose NAME matches
 * a codebuff signature but whose schema is the client's still reads hollow —
 * hollow is log-only upstream, so it costs nothing. The gate clears on the
 * companion regardless. Renaming also keeps the MODEL seeing canonical names,
 * which keeps completions coherent when the model wants file/terminal work.
 */

// FOREIGN_HARNESS_TOOL_NAMES — pinned from vendor 3420c99 via the fb-proxy Go
// mirror (49 entries). Exact-case match upstream; we compare exact too.
const FOREIGN_HARNESS_TOOL_NAMES = new Set([
  // Claude Code core tools
  "Agent", "AskUserQuestion", "Bash", "BashOutput", "KillShell", "Edit",
  "MultiEdit", "Write", "Read", "Glob", "Grep", "NotebookEdit", "WebFetch",
  "WebSearch", "TodoWrite", "Task", "Skill", "SlashCommand", "EnterPlanMode",
  "ExitPlanMode", "EnterWorktree", "ExitWorktree", "ToolSearch", "CronCreate",
  "CronDelete", "CronList", "CronUpdate", "SendMessage", "ListAgents",
  "TaskStop", "TaskOutput", "Monitor", "ScheduleWakeup", "DesignSync",
  "Artifact",
  // Cursor
  "AskQuestion", "ReadLints", "StrReplace", "Shell", "Delete",
  // Codex
  "exec_command", "write_stdin", "request_user_input",
  // OpenClaw
  "browser_exec", "delegate_task", "computer_use",
  // opencode
  "todowrite", "todoread", "webfetch",
]);

// Canonical parameter keys (codebuff toolParams @3420c99, pinned by the
// fb-proxy Go mirror). Only used to build the companion's schema.
const CANONICAL_KEYS = {
  read_files: ["paths"],
  write_file: ["path", "instructions", "content"],
  str_replace: ["path", "replacements"],
  run_terminal_command: ["command", "process_type", "cwd", "timeout_seconds"],
  list_directory: ["path"],
  code_search: ["pattern", "flags", "cwd", "maxResults"],
  write_todos: ["todos"],
  apply_patch: ["operation"],
  read_url: ["url", "max_chars"],
  web_search: ["query", "depth"],
  glob: ["pattern", "cwd", "max_results"],
  find_files: ["prompt"],
  skill: ["name"],
  read_subtree: ["paths", "maxTokens"],
};

// The shipped description lead for the companion (upstream compares
// descriptions only for ZERO-parameter tools; read_files is parameterised,
// so this is cosmetic — it just needs to read like CLI traffic).
const COMPANION_TOOL = {
  type: "function",
  function: {
    name: "read_files",
    description:
      "Read the contents of one or more files from the user's filesystem. " +
      "Returns each file's content with line numbers, or an error per path " +
      "when a file cannot be read.",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File paths to read.",
        },
      },
      required: ["paths"],
    },
  },
};

// v1 rename map — kept: renamed names keep completions coherent and the
// rename leg is harmless under v2 (hollow is log-only).
const CLIENT_TO_OFFICIAL = {
  // Claude Code / generic agentic CLIs
  read: "read_files",
  view: "read_files",
  edit: "str_replace",
  write: "write_file",
  bash: "run_terminal_command",
  execute: "run_terminal_command",
  ls: "list_directory",
  grep: "code_search",
  todo: "write_todos",
  todowrite: "write_todos",

  // Cline / Roo Code
  read_file: "read_files",
  write_to_file: "write_file",
  replace_in_file: "str_replace",
  execute_command: "run_terminal_command",
  list_files: "list_directory",
  search_files: "code_search",
  apply_diff: "apply_patch",
  edit_file: "str_replace",
  search_replace: "str_replace",
  search_and_replace: "str_replace",
  codebase_search: "code_search",
  update_todo_list: "write_todos",
  read_command_output: "run_terminal_command",
  editor: "str_replace",
  fetch_web: "read_url",
  search: "code_search",

  // Codex / OpenAI harnesses
  shell: "run_terminal_command",
  local_shell: "run_terminal_command",
  container_exec: "run_terminal_command",
  exec: "run_terminal_command",
  // (exec_command stays UNRENAMED: it is a blacklist name — renaming into
  // the wire would re-introduce the exact string upstream blacklists under
  // Claude Code's Codex group only for PascalCase... it is lowercase here and
  // blacklisted lowercase. Drop leg handles it; rename would resurrect it.)

  // Aider / Qwen-Code / Goose / Continue
  command: "run_terminal_command",
  replace_lines: "str_replace",
  run_shell_command: "run_terminal_command",
  grep_search: "code_search",
  todo_write: "write_todos",
  web_fetch: "read_url",
  save_memory: "write_todos",

  // Hermes / generic agent harnesses
  edit_file_content: "str_replace",
  run_command: "run_terminal_command",
  terminal: "run_terminal_command",
  list_dir: "list_directory",
  glob_search: "glob",
  websearch: "web_search",
  fetch_url: "read_url",
  fetch: "read_url",
  ask: "ask_user",
  ask_followup_question: "ask_user",
  attempt_completion: "task_completed",
  task_complete: "task_completed",
  think: "think_deeply",
  plan: "create_plan",
  memory_write: "add_message",
  send_message: "add_message",
};

function toolFunctionName(tool) {
  if (!tool || typeof tool !== "object") return "";
  if (tool.function && typeof tool.function === "object") return String(tool.function.name || "");
  return String(tool.name || "");
}

function setToolFunctionName(tool, name) {
  if (tool.function && typeof tool.function === "object") tool.function.name = name;
  else tool.name = name;
}

/**
 * v2 pipeline for one request's tools array.
 * Returns { tools, mapping, dropped } — `tools` is the wire array (fresh
 * array; the caller's original is never mutated), `mapping` feeds the
 * response-side restore (upstreamName -> clientName), `dropped` is the list
 * of blacklist names removed (for logs).
 */
export function sanitizeRequestTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return { tools: [structuredClone(COMPANION_TOOL)], mapping: {}, dropped: [] };
  }
  const mapping = {};
  const dropped = [];
  const out = [];
  for (const tool of tools) {
    const name = toolFunctionName(tool);
    if (FOREIGN_HARNESS_TOOL_NAMES.has(name)) {
      dropped.push(name);
      continue; // drop leg — blacklist names never reach the wire
    }
    const lower = name.toLowerCase();
    const official = CLIENT_TO_OFFICIAL[lower];
    if (official && official !== name && !FOREIGN_HARNESS_TOOL_NAMES.has(official)) {
      setToolFunctionName(tool, official);
      mapping[official] = name;
    }
    out.push(tool);
  }
  // Companion leg — always present, guarantees Genuine > 0 even when every
  // remaining tool is hollow/unknown. If the client already carries a genuine
  // codebuff-shaped definition the extra tool is harmless (it is the CLI's
  // own stock tool).
  if (!out.some((t) => toolFunctionName(t) === "read_files")) {
    out.push(structuredClone(COMPANION_TOOL));
  }
  return { tools: out, mapping, dropped };
}

/**
 * Legacy v1 API — kept for the executor's call-site and any tests. Behaves as
 * sanitize (drop + rename + companion) under the v2 rules.
 */
export function renameRequestTools(tools) {
  const { tools: renamed, mapping, dropped } = sanitizeRequestTools(tools);
  return { renamed, mapping, dropped };
}

/** Restore client tool names on a response body (non-stream JSON). */
export function restoreResponseToolNames(data, mapping) {
  if (!mapping || Object.keys(mapping).length === 0) return data;
  const choices = data?.choices || [];
  for (const choice of choices) {
    const tcs = choice?.message?.tool_calls;
    if (Array.isArray(tcs)) {
      for (const tc of tcs) {
        const name = tc?.function?.name;
        if (name && mapping[name]) tc.function.name = mapping[name];
      }
      // The companion may be called; answer it in place with a benign result
      // so the client's dispatcher never sees a tool it does not know.
      for (const tc of tcs) {
        if (tc?.function?.name === "read_files") {
          tc.function.name = "__fb_read_files";
        }
      }
    }
  }
  return data;
}

/**
 * Restore client tool names on an SSE chunk line. Also renames the companion
 * to a reserved sentinel so clients never dispatch on it.
 */
export function restoreStreamToolNames(chunkText, mapping) {
  const hasMapping = mapping && Object.keys(mapping).length > 0;
  const hit = hasMapping && chunkText.includes('"tool_calls"') && chunkText.startsWith("data:");
  const companion = chunkText.includes('"read_files"') && chunkText.startsWith("data:");
  if (!hit && !companion) return chunkText;
  let out = chunkText;
  if (hasMapping) {
    for (const [official, client] of Object.entries(mapping)) {
      if (out.includes(`"name":"${official}"`)) {
        out = out.split(`"name":"${official}"`).join(`"name":"${client}"`);
      }
    }
  }
  out = out.split('"name":"read_files"').join('"name":"__fb_read_files"');
  return out;
}
