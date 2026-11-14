// SenseNova international platform (platform.sensenova.ai). Same OpenAI-compatible
// wire as the China entry (sensenova.js), different host: keys are per-site, and
// token.sensenova.cn rejects international keys (401 "Forbidden"), so each site is
// its own provider with its own model catalog — same split as alicode/alicode-intl.
// Its limits also differ (262144 context / 65536 output vs the CN 1M window) —
// see PROVIDER_CAPABILITIES["sensenova-intl"] in providers/capabilities.js.
export default {
  id: "sensenova-intl",
  priority: 68,
  alias: "sensenova-intl",
  display: {
    name: "SenseNova (Intl)",
    icon: "auto_awesome",
    color: "#5B5CE2",
    textIcon: "SN",
    website: "https://platform.sensenova.ai",
    notice: {
      text: "For international accounts (platform.sensenova.ai). China accounts (token.sensenova.cn) use the SenseNova provider.",
      apiKeyUrl: "https://platform.sensenova.ai",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: ["none", "low", "medium", "high", "max"],
    defaultMode: "high",
  },
  transport: {
    baseUrl: "https://token.sensenova.ai/v1/chat/completions",
    validateUrl: "https://token.sensenova.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "sensenova-6.8-flash", name: "SenseNova 6.8 Flash" },
    { id: "sensenova-6.8-flash-lite", name: "SenseNova 6.8 Flash Lite" },
    { id: "sensenova-6.7-flash-lite", name: "SenseNova 6.7 Flash Lite" },
    {
      id: "sensenova-u1.5-lite",
      name: "SenseNova U1.5 Lite",
      capabilities: ["text2img", "edit"],
      params: ["n", "size", "output_format", "response_format", "watermark", "prompt_extend"],
      kind: "image",
    },
    {
      id: "sensenova-u1-fast",
      name: "SenseNova U1 Fast",
      capabilities: ["text2img"],
      params: ["n", "size", "output_format", "response_format", "watermark", "prompt_extend"],
      kind: "image",
    },
  ],
  serviceKinds: ["llm", "image", "imageToText"],
  imageConfig: {
    baseUrl: "https://token.sensenova.ai/v1/images/generations",
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