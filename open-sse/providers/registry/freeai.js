export default {
  id: "freeai",
  priority: 62,
  alias: "fai",
  aliases: ["free-ai", "free.ai"],
  uiAlias: "fai",
  display: {
    name: "Free.ai",
    icon: "all_inclusive",
    color: "#10B981",
    textIcon: "FA",
    website: "https://free.ai/",
    notice: {
      text: "Free.ai: satu node untuk chat + code + vision (qwen-vl, qwen25-vl, moondream2). 60 RPM / 1000 req/month per key, key sekali untuk semua model. Key dari free.ai.",
      apiKeyUrl: "https://free.ai/",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    // Base chat/code path: /v1/chat/ (native). Vision models (qwen-vl,
    // qwen25-vl, moondream2) are routed by FreeAIExecutor to
    // /v1/chat/completions (OpenAI-compat) automatically — satu key, satu node.
    baseUrl: "https://api.free.ai/v1/chat/",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // Verified working via /v1/chat/ (tested, 200 OK):
  // Note: qwen7b + qwen3-8b are aliases to Qwen3-30B on the server side.
  models: [
    // CHAT
    { id: "qwen7b",         name: "Qwen 2.5 7B (→Qwen3-30B)" },
    { id: "qwen3-8b",       name: "Qwen 3 8B (→Qwen3-30B)" },
    { id: "deepseek-r1",    name: "DeepSeek-R1 7B" },
    { id: "deepseek-r1-7b", name: "DeepSeek-R1 7B Distill" },
    { id: "mistral",        name: "Mistral 7B" },
    // CODE
    { id: "qwen-coder",     name: "Qwen 2.5 Coder 7B" },
    { id: "qwen3-coder",    name: "Qwen3-Coder 7B" },
    // VISION (routed to /v1/chat/completions automatically)
    { id: "qwen-vl",   name: "Qwen2.5-VL 7B",    capabilities: { vision: true } },
    { id: "qwen25-vl", name: "Qwen2.5-VL 7B v2",  capabilities: { vision: true } },
    { id: "moondream2", name: "Moondream 2",         capabilities: { vision: true } },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
  features: {
    usage: false,
  },
};
