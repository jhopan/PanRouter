export default {
  id: "vyceai",
  priority: 66,
  alias: "vy",
  aliases: ["vyceai"],
  uiAlias: "vy",
  display: {
    name: "VYCEAI",
    icon: "bolt",
    color: "#10B981",
    textIcon: "VY",
    website: "https://vyceai.com/",
    notice: {
      text: "VYCEAI - OpenAI chat-completions transport. API key required.",
      apiKeyUrl: "https://vyceai.com/",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://vyceai.com/v1/chat/completions",
    validateUrl: "https://vyceai.com/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "agnes-3.0-flash", name: "Agnes 3.0 Flash" },
    { id: "deepseek-v4.1", name: "DeepSeek V4.1" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
