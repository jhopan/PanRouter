export default {
  id: "orcarouter",
  priority: 63,
  alias: "orca",
  aliases: ["orcarouter"],
  uiAlias: "orca",
  display: {
    name: "OrcaRouter",
    icon: "sailing",
    color: "#0EA5E9",
    textIcon: "OR",
    website: "https://www.orcarouter.ai/",
    notice: {
      text: "OrcaRouter — Responses-API gateway. Free tier models (-free suffix) plus paid frontier models. Token from the console.",
      apiKeyUrl: "https://www.orcarouter.ai/console/token",
    },
  },
  category: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.orcarouter.ai/v1/responses",
    validateUrl: "https://api.orcarouter.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // Responses API transport (operator-requested). Chat-completions passthrough is
  // NOT declared - add a second transport after live verification if needed.
  models: [
    { id: "deepseek/deepseek-v4-flash-free", name: "DeepSeek V4 Flash (Free)", targetFormat: "openai-responses" },
    { id: "tencent/hy3-free", name: "Tencent Hunyuan 3 (Free)", targetFormat: "openai-responses" },
    { id: "z-ai/glm-5.3-flash-free", name: "GLM 5.3 Flash (Free)", targetFormat: "openai-responses" },
    { id: "orca/orcaverify-text1.0-free", name: "Orca Verify Text 1.0 (Free)", targetFormat: "openai-responses" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
