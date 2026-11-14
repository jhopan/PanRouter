// SenseNova China platform (token.sensenova.cn). Keys are per-site: an
// international key is rejected here with 401 {"error":{"code":16,"message":"Forbidden"}},
// so the international platform lives in its own entry (sensenova-intl.js) —
// same split as alicode/alicode-intl.
export default {
  id: "sensenova",
  priority: 67,
  alias: "sensenova",
  display: {
    name: "SenseNova",
    icon: "auto_awesome",
    color: "#5B5CE2",
    textIcon: "SN",
    website: "https://token.sensenova.cn",
    notice: {
      text: "For China accounts (token.sensenova.cn). International accounts (platform.sensenova.ai) use SenseNova (Intl).",
      apiKeyUrl: "https://token.sensenova.cn",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: ["none", "low", "medium", "high", "max"],
    defaultMode: "high",
  },
  transport: {
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    validateUrl: "https://token.sensenova.cn/v1/models",
    // Explicit (registry default would be unwired): the registry-driven API-key
    // probe in /api/providers/[id]/test keys off transport.auth + validateUrl.
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "sensenova-6.8-flash", name: "SenseNova 6.8 Flash" },
    { id: "sensenova-6.8-flash-lite", name: "SenseNova 6.8 Flash Lite" },
    {
      id: "sensenova-u1.5-lite",
      name: "SenseNova U1.5 Lite",
      capabilities: ["text2img", "edit"],
      params: ["n", "size", "output_format", "response_format", "watermark", "prompt_extend"],
      kind: "image",
    },
    {
      id: "sensenova-u1.5-fast",
      name: "SenseNova U1.5 Fast",
      capabilities: ["text2img"],
      params: ["n", "size", "output_format", "response_format", "watermark", "prompt_extend"],
      kind: "image",
    },
    { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "kimi-k3", name: "Kimi K3" },
  ],
  serviceKinds: ["llm", "image", "imageToText"],
  imageConfig: {
    baseUrl: "https://token.sensenova.cn/v1/images/generations",
    bodyFields: [
      "model",
      "prompt",
      "n",
      "size",
      "output_format",
      "response_format",
      "watermark",
      "prompt_extend",
    ],
  },
};