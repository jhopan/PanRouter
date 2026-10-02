export default {
  id: "atria",
  priority: 62,
  alias: "at",
  aliases: ["atria", "atria-dawn", "atria-asi"],
  uiAlias: "at",
  display: {
    name: "Atria Dawn",
    icon: "wb_sunny",
    color: "#F97316",
    textIcon: "AD",
    website: "https://api.atria-asi.ai/console",
    notice: {
      text: "Atria Dawn - OpenAI-compatible (chat + Responses API). API key from the console.",
      apiKeyUrl: "https://api.atria-asi.ai/console",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  // Multi-endpoint: chat-completions for openai clients, Responses API for
  // openai-responses clients (both endpoints exist upstream, both key-gated).
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
      validateUrl: "https://api.atria-asi.ai/v1/models",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.atria-asi.ai/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  transport: {
    baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
    validateUrl: "https://api.atria-asi.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "Atria-Dawn-Preview", name: "Atria Dawn Preview" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
