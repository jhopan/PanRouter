export default {
  id: "freebuff",
  priority: 60,
  alias: "freebuff",
  aliases: ["fb", "FB"],
  uiAlias: "fb",
  display: {
    name: "FreeBuff",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "FB",
    website: "https://codebuff.com",
    notice: {
      apiKeyUrl: "https://codebuff.com",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    validateUrl: "https://www.codebuff.com/api/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // FreeBuff/Codebuff free-tier coding models (upstream agent mapping lives in
  // executors/freebuff.js). Quota is per-account daily sessions; multi-account
  // is handled by 9router connections (fallback drain — NEVER round-robin).
  models: [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (Early Access)" },
    { id: "deepseek/deepseek-v4.1-pro", name: "DeepSeek V4.1 Pro (Early Access)" },
    { id: "z-ai/glm-5.3", name: "GLM 5.3 (Early Access)" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "z-ai/glm-5.2", name: "GLM 5.2" },
    { id: "mimo/mimo-v2.5", name: "MiMo 2.5" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "upstage/solar-pro4", name: "Solar Pro 4" },
    { id: "meta/muse-spark-1.3-contributor", name: "Muse Spark 1.3 (Contributor)" },
    { id: "meta/muse-spark-1.2-contributor", name: "Muse Spark 1.2 (Contributor)" },
    { id: "anthropic/claude-fable-5", name: "Claude Fable 5" },
    { id: "stealth/ox-alpha", name: "Ox Alpha" },
    { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
  // usage: GET /api/v1/freebuff/session probe (zero freebucks) feeds the
  // Usage tab with freebucks balance/spent/prices/active instance.
  features: { usage: true },
  // Browser login flow (mirrors the official CLI: POST /api/auth/cli/code with a
  // fresh fingerprintId → open loginUrl on ANY device → poll /api/auth/cli/status
  // until user.authToken arrives). Consumed by src/lib/oauth/providers/freebuff.js.
  oauth: {
    baseUrl: "https://www.codebuff.com",
    codeUrl: "https://www.codebuff.com/api/auth/cli/code",
    statusUrl: "https://www.codebuff.com/api/auth/cli/status",
    userAgent: "Bun/1.3.14",
    pollInterval: 5000,
    timeoutMs: 300000,
  },
};
