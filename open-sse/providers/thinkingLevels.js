// Resolve valid thinking levels per model — drives UI level picker (suffix "model(level)").
// Reuses capabilities.js (thinkingFormat/canDisable) so this file only maps format→levels (DRY).
import { getCapabilitiesForModel } from "./capabilities.js";
import { matchPattern } from "./pricing.js";
import { resolveKiroEffortPath } from "../config/kiroConstants.js";

// Shared level sets (deduped) — verified against provider docs + wire in thinkingUnified.applyFormat.
const L = {
  base: ["none", "low", "medium", "high"],                          // qwen, step, hunyuan, gemini-budget
  onOff: ["none", "thinking"],                                      // zai (binary), minimax (adaptive)
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],    // GPT-5.x / o-series (no "max")
  levelMax: ["none", "low", "medium", "high", "max"],               // claude-adaptive, kimi
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],       // claude-budget
  gemini: ["minimal", "low", "medium", "high"],                     // gemini-3 thinkingLevel (no disable)
  hiMax: ["none", "high", "max"],                                   // deepseek (low/med→high, xhigh→max)
};

// thinkingFormat → valid selectable levels (source of truth for UI options).
const FORMAT_LEVELS = {
  openai: L.openai,
  "claude-adaptive": L.levelMax,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hiMax,
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
  nous: L.base,
};

const CODEX_GPT_5_6_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// Model-name pattern overrides (glob, first match wins) — more precise than format default.
const PATTERN_THINKING = [
  // Gemini 4 (Argon) rejects "minimal" with 400 — LOW is the floor; cannot disable thinking.
  { pattern: "*gemini-4*", levels: ["low", "medium", "high"] },
  { provider: "codex", pattern: "*gpt-6*", levels: CODEX_GPT_5_6_LEVELS },
  { provider: "codex", pattern: "*gpt-5.6-sol*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-terra*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-luna*", levels: CODEX_GPT_5_6_LEVELS },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] }, // codex cannot disable thinking
  // OpenCode Free (oc) MiMo rides the same OpenRouter-backed route as the rest of
  // that lane and takes the full OpenAI effort enum verbatim (probed live: all
  // seven values 200, anything else 400 "Invalid option"), so it owns the entry
  // ahead of the unqualified *mimo*v2.6* one below — that one describes Xiaomi's
  // own API, and its [none..xhigh] set would make max unreachable here (the
  // deepseek wire branch clamps max→high when the declared set lacks it).
  { provider: "opencode", pattern: "*mimo*v2.6*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { pattern: "*mimo*v2.6*", levels: ["none", "low", "medium", "high", "xhigh"] },
  // DeepSeek v4.* (Alibaba MaaS, probed live): effort low|medium|high|xhigh|max
  // all 200 via output_config.effort; "none" is a 400 on the anthropic route
  // (disable thinking instead). none kept for the picker = disable.
  { provider: "codebuddy-cn", pattern: "glm-5.3*",     levels: ["low", "high", "max"] },
  { provider: "codebuddy-cn", pattern: "glm-5.2",      levels: ["high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "deepseek-v4*", levels: ["low", "high", "max"] },
  { provider: "codebuddy-cn", pattern: "hy3*",         levels: ["low", "high"] },
  { provider: "codebuddy-cn", pattern: "hy4*",         levels: ["high"] },
  // OpenCode Zen free tier (oc / ocz) — the free id of the same v4.1-flash model
  // publishes low|high|max as well, and unlike DeepSeek's own API the upstream
  // forwards the level verbatim (no low→high collapse). The generic
  // *deepseek-v4.* glob below would advertise medium/xhigh, which the model does
  // not serve, so this entry MUST stay above it.
  { pattern: "*deepseek-v4.1-flash-free*", levels: ["low", "high", "max"] },
  { pattern: "*deepseek-v4.*", levels: ["none", "low", "medium", "high", "xhigh", "max"] },
  // codebuddy-cn per-model effort sets — the server's product-config payload
  // publishes `reasoning.supportedEfforts` per model. NOTE: the chat endpoint
  // accepts any level you send (probed none/minimal/low/medium/high/xhigh/max
  // → all 200), but values outside a model's supportedEfforts are silently
  // clamped, so the declared set stays authoritative for the picker. Models
  // that publish no supportedEfforts (glm-5.1 / glm-5v-turbo / kimi-k2.x /
  // kimi-k3-1 / minimax-m3) fall through to the openai format default.
];

// OpenAI documents reasoning.effort "max" for GPT-5.6 and GPT-6 (#5186). The codex rows
// above already carry it; an OpenAI Compatible node serving the same ids gets the same
// set, otherwise the "openai" format list (no max) clamps max to xhigh on the wire.
const OPENAI_MAX_EFFORT_MODEL = /(?:^|\/)gpt-(?:5\.6|6)(?:[.-]|$)/i;
const isOpenAICompatibleNode = (provider) => String(provider || "").startsWith("openai-compatible-");

// Returns valid thinking levels for a model, or null when the model has no reasoning.
export function getThinkingLevels(provider, model) {
  if (provider === "kiro" && resolveKiroEffortPath(model) === null) return null;
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  const baseId = String(model || "").replace(/\([^()]+\)\s*$/, "");
  const hit = PATTERN_THINKING.find((entry) =>
    (!entry.provider || entry.provider === provider) && matchPattern(entry.pattern, model)
  );
  let levels = hit?.levels
    || (isOpenAICompatibleNode(provider) && OPENAI_MAX_EFFORT_MODEL.test(baseId) ? CODEX_GPT_5_6_LEVELS : null)
    || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
