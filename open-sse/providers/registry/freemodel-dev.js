export default {
  id: "freemodel-dev",
  priority: 62,
  alias: "fmd",
  aliases: ["freemodel"],
  uiAlias: "fmd",
  display: {
    name: "FreeModel.dev",
    icon: "rocket_launch",
    color: "#10B981",
    textIcon: "FM",
    website: "https://freemodel.dev/",
    notice: {
      text: "FreeModel.dev — one-time initial free credits (GPT-5.x family, 400k context). Key from freemodel.dev. one-time-initial budget: not recurring.",
      apiKeyUrl: "https://freemodel.dev/",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.freemodel.dev/v1/chat/completions",
    validateUrl: "https://api.freemodel.dev/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // OmniRoute parity (registry freemodel-dev). Live /v1/models (2026-09-19):
  // gpt-5.6-luna/sol/terra — pin those + the OmniRoute-known 5.x ids;
  // passthrough covers future additions.
  models: [
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
