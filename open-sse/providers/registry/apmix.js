export default {
  id: "apmix",
  priority: 63,
  alias: "am",
  aliases: ["apmix", "apmix-ai"],
  uiAlias: "am",
  display: {
    name: "APIMIX.AI",
    icon: "blend",
    color: "#06B6D4",
    textIcon: "AM",
    website: "https://apmix.ai/",
    notice: {
      text: "APIMIX.AI - OpenAI chat-completions transport. API key from the dashboard.",
      apiKeyUrl: "https://apmix.ai/dashboard/keys",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.apmix.ai/v1/chat/completions",
    validateUrl: "https://api.apmix.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "stealth/space-bunny-free", name: "Space Bunny (Free)" },
    { id: "deepseek/deepseek-v4-flash-free", name: "DeepSeek V4 Flash (Free)" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
