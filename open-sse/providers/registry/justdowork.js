export default {
  id: "justdowork",
  priority: 64,
  alias: "jd",
  aliases: ["justdowork", "justwoker"],
  uiAlias: "jd",
  display: {
    name: "JustDoWork",
    icon: "task",
    color: "#8B5CF6",
    textIcon: "JD",
    website: "https://api.justwoker.icu/",
    notice: {
      text: "JustDoWork - Anthropic-compatible (verified live; the OpenAI /v1/chat/completions path is Cloudflare-blocked from some regions, /v1/messages works). API key required.",
      apiKeyUrl: "https://api.justwoker.icu/",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.justwoker.icu/v1/messages",
    format: "claude",
    validateUrl: "https://api.justwoker.icu/v1/models",
    headers: { "anthropic-version": "2023-06-01" },
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  // Single model exposed by this provider (verified live: /v1/messages 200).
  models: [
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
  ],
  serviceKinds: ["llm"],
};
