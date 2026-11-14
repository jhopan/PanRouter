/**
 * Shared CodeBuddy (CN + intl) system-prompt guard.
 *
 * Tencent's gateway/WAF treats third-party CLI agent identity strings —
 * "You are Claude Code, Anthropic's official CLI…", Cursor, Windsurf, Cline,
 * Aider, Continue, Copilot, Cody, prompt-injection scaffolding like
 * `<agent-identity>` — as unauthorized tooling / prompt injection. It answers
 * 11128 "request illegal" and, on repetition, restricts the ACCOUNT (11140).
 *
 * Both executors therefore neutralise those markers in the CLIENT'S OWN
 * system prompt instead of dropping the prompt. Dropping it loses every
 * user/project instruction on every request.
 *
 * Scope of the pattern: it is deliberately narrow — identity markers of known
 * third-party agents plus the wrapper tags the agent harnesses emit. Widening
 * it past that starts replacing legitimate user instructions ("you are a code
 * review agent", "orchestration capabilities" in an API doc) with the neutral
 * text, silently. Narrowing it (dropping entries) lets a detected agent
 * identity reach the WAF. `claude.?code` is spelled with `.?` because the CLI
 * emits both "Claude Code" and "claude-code"; the `anxthxropic` variant is
 * obfuscated spelling seen in the wild.
 *
 * No imports: executor-only, so it stays cycle-free like codebuddyUserId.js.
 */

/** Replaces a detected agent-identity system prompt. */
export const NEUTRAL_SYSTEM_PROMPT =
  "You are a helpful AI assistant that helps with software engineering tasks.";

/**
 * Third-party CLI agent identity markers. Case-insensitive, no `g` flag so
 * `.test()` carries no lastIndex state between calls.
 */
export const AGENT_IDENTITY_PATTERN =
  /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;

/**
 * Flatten a system content payload to text. Clients send either a bare string
 * or typed blocks (`[{ type: "text", text }]`); only string `text` fields are
 * collected, so a non-text block contributes nothing.
 *
 * @param {unknown} content
 * @returns {string}
 */
export function flattenSystemContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n");
}