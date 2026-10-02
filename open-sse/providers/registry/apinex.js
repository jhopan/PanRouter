export default {
  id: "apinex",
  priority: 64,
  alias: "apinex",
  aliases: ["apn"],
  uiAlias: "apinex",
  display: {
    name: "APInex",
    icon: "hub",
    color: "#8B5CF6",
    textIcon: "AP",
    website: "https://apinex.bond/",
    notice: {
      text: "APInex gateway - OpenAI chat-completions transport. Free-tier models use the free/ prefix. Key from the keys page.",
      apiKeyUrl: "https://apinex.bond/keys",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.apinex.bond/v1/chat/completions",
    validateUrl: "https://api.apinex.bond/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // OpenAI chat-completions transport (operator-requested). Free models live
  // under the free/ vendor prefix; pin known-good ids, passthrough covers rest.
  models: [
    { id: "free/glm-5.3-flash", name: "GLM 5.3 Flash (Free)" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
