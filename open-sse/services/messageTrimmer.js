/**
 * Trim a conversation to fit a model's context window.
 *
 * Why this exists: CodeBuddy's prompt cache is bound to the ACCOUNT. When the
 * router rotates to a different account, that account has no cache for this
 * conversation, so the FULL history is uploaded — 412k tokens in one request.
 * That is the payload shape most likely to get an account flagged, and it is
 * also what makes a cold account slower than a warm one.
 *
 * So: when the request goes to a different account than the one that ran the
 * previous turn, the oldest messages are dropped until the estimated token
 * count fits a budget. The conversation stays coherent (the system prompt and
 * the recent turns are kept) and the cold request is no longer a 412k-token
 * upload.
 *
 * The estimate is deliberately crude — characters/4 is close enough to decide
 * whether to trim, and it never touches the body when nothing needs trimming.
 */

/** Rough characters-per-token ratio for mixed prose + code. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the token count of a message list.
 * @param {Array} messages
 * @returns {number}
 */
export function estimateTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const content = m.content;
    if (typeof content === "string") chars += content.length;
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === "string") chars += part.length;
        else if (part && typeof part === "object") {
          if (typeof part.text === "string") chars += part.text.length;
          // A base64 image is far more than its JSON length in tokens, but we
          // cannot know the real cost without decoding it; count the payload
          // so a history full of images is trimmed as well.
          else if (part.image_url || part.image) chars += 4000;
        }
      }
    }
    if (typeof m.tool_call_id === "string") chars += m.tool_call_id.length;
    if (m.tool_calls) chars += 400;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Drop the oldest non-system messages until the history fits `budgetTokens`.
 *
 * The system prompt (and any leading system/developer turns) is always kept —
 * it carries the instructions. Then whole user/assistant pairs are removed from
 * the front, so the conversation does not start mid-tool-call.
 *
 * @param {Array} messages
 * @param {number} budgetTokens
 * @returns {{ messages: Array, removed: number, before: number, after: number }}
 */
export function trimMessagesToBudget(messages, budgetTokens) {
  const list = Array.isArray(messages) ? messages : [];
  const before = estimateTokens(list);
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0 || before <= budgetTokens) {
    return { messages: list, removed: 0, before, after: before };
  }

  // Keep the leading system/developer block.
  let head = 0;
  while (head < list.length && list[head] && ["system", "developer"].includes(list[head].role)) head += 1;
  const systemPart = list.slice(0, head);
  const rest = list.slice(head);

  // Drop from the front, in pairs, so a tool call never loses its answer.
  let start = 0;
  let chars = 0;
  const budgetChars = budgetTokens * CHARS_PER_TOKEN;
  for (const m of rest) {
    if (typeof m?.content === "string") chars += m.content.length;
    else if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (typeof part === "string") chars += part.length;
        else if (part && typeof part === "object") chars += typeof part.text === "string" ? part.text.length : 4000;
      }
    }
    if (m?.tool_calls) chars += 400;
  }
  let used = chars;
  while (start < rest.length - 1 && used > budgetChars) {
    const dropped = rest[start];
    let dropChars = 0;
    if (typeof dropped?.content === "string") dropChars = dropped.content.length;
    else if (Array.isArray(dropped?.content)) {
      for (const part of dropped.content) {
        if (typeof part === "string") dropChars += part.length;
        else if (part && typeof part === "object") dropChars += typeof part.text === "string" ? part.text.length : 4000;
      }
    }
    if (dropped?.tool_calls) dropChars += 400;
    used -= dropChars;
    start += 1;
    // Never leave a dangling assistant tool_call without its tool result.
    while (start < rest.length && rest[start]?.role === "tool") {
      used -= 100;
      start += 1;
    }
  }

  const kept = rest.slice(start);
  const messages2 = [...systemPart, ...kept];
  return {
    messages: messages2,
    removed: rest.length - kept.length,
    before,
    after: estimateTokens(messages2),
  };
}
