export default {
  id: "freeai-vl",
  priority: 63,
  alias: "fai-vl",
  aliases: ["free-ai-vl", "freeai-vision"],
  uiAlias: "fai-vl",
  display: {
    name: "Free.ai Vision",
    icon: "visibility",
    color: "#10B981",
    textIcon: "FV",
    website: "https://free.ai/",
    notice: {
      text: "Free.ai vision models: OpenAI-compatible endpoint (/v1/chat/completions). Same API key as freeai (fai). Chat/code models → use freeai (fai).",
      apiKeyUrl: "https://free.ai/",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    // Node B: /v1/chat/completions (OpenAI-compat path) — only serves vision models.
    // Chat/code models use /v1/chat/ → use provider freeai (fai).
    baseUrl: "https://api.free.ai/v1/chat/completions",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "qwen-vl",   name: "Qwen2.5-VL 7B",    capabilities: { vision: true } },
    { id: "qwen25-vl", name: "Qwen2.5-VL 7B v2",  capabilities: { vision: true } },
    { id: "moondream2",name: "Moondream 2",         capabilities: { vision: true } },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
  features: {
    usage: false,
  },
};
