export default {
  id: "agnes",
  priority: 61,
  alias: "agnes",
  aliases: ["agnes-ai", "agnesai"],
  uiAlias: "agnes",
  display: {
    name: "Agnes AI",
    icon: "auto_awesome",
    color: "#F97316",
    textIcon: "AG",
    website: "https://agnes-ai.com/",
    notice: {
      text: "Agnes AI free tier: multimodal (text/image/video), OpenAI-compatible, no credit card. Free plan: 20 RPM text (30 RPM with token plan). Key from platform.agnes-ai.com.",
      apiKeyUrl: "https://platform.agnes-ai.com/",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // OpenAI-compatible; OmniRoute parity (registry agnes): 1.5/2.0/2.5 Flash.
  // Catalog is dynamic upstream — known-good ids pinned, passthrough covers rest.
  models: [
    { id: "agnes-1.5-flash", name: "Agnes 1.5 Flash" },
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash" },
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
