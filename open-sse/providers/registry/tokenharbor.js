export default {
  id: "tokenharbor",
  priority: 65,
  alias: "th",
  aliases: ["tokenharbor"],
  uiAlias: "th",
  display: {
    name: "TokenHarbor",
    icon: "anchor",
    color: "#F59E0B",
    textIcon: "TH",
    website: "https://tokenharbor.ai/",
    notice: {
      text: "TokenHarbor - OpenAI chat-completions transport. Free models use the :free suffix. Key from the dashboard.",
      apiKeyUrl: "https://tokenharbor.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://tokenharbor.ai/v1/chat/completions",
    validateUrl: "https://tokenharbor.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // OpenAI chat-completions transport (operator-requested). :free suffix models
  // pinned first; passthrough covers paid models.
  models: [
    { id: "deepseek-v4.1-flash:free", name: "DeepSeek V4.1 Flash (Free)" },
    { id: "deepseek-v4-flash:free", name: "DeepSeek V4 Flash (Free)" },
    { id: "mimo-v2.5:free", name: "MiMo 2.5 (Free)" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
