export default {
  id: "kilocode",
  priority: 70,
  alias: "kc",
  uiAlias: "kc",
  display: {
    name: "Kilo Code",
    icon: "code",
    color: "#FF6B35",
    textIcon: "KC",
    website: "https://kilocode.ai",
    notice: {
      signupUrl: "https://kilocode.ai",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.kilo.ai/api/openrouter/chat/completions",
    headers: {},
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "kilocodeOrg",
      ],
    },
  },
  models: [
    { id: "kilo-auto/free", name: "Auto Free" },
    { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "NVIDIA: Nemotron 3 Super (free)" },
    { id: "poolside/laguna-xs-2.1:free", name: "Poolside: Laguna XS 2.1 (free)" },
    { id: "cohere/north-mini-code:free", name: "Cohere: North Mini Code (free)" },
    { id: "openrouter/free", name: "OpenRouter Free Models Router" },
    { id: "poolside/laguna-s-2.1:free", name: "Poolside: Laguna S 2.1 (free)" },
    { id: "dots-studio/dots-3-note-preview:free", name: "Dots Studio: Dots3-Note Preview (free)" },
    { id: "stealth/space-bunny-alpha", name: "Space Bunny Alpha" },
    { id: "inclusionai/ling-3.1-flash", name: "inclusionAI: Ling 3.1 Flash (new)" },
    { id: "stepfun/step-3.7-flash:free", name: "StepFun: Step 3.7 Flash (free)" },
    { id: "apodex/apodex-1.1-mini:free", name: "Apodex: Apodex 1.1 Mini (free)" },
    { id: "inclusionai/ling-3.0-flash-sante:free", name: "inclusionAI: Ling 3.0 Flash Sante (free)" },
    { id: "qwen/qwen3.8-27b:free", name: "Qwen: Qwen3.8 27B (free)" },
    { id: "liquid/lfm-2.5-2.6b:free", name: "LiquidAI: LFM2.5-2.6B (free)" },
    { id: "nvidia/nemotron-3.5-content-safety:free", name: "NVIDIA: Nemotron 3.5 Content Safety (free)" },
  ],
  // Kilo Code proxies the OpenRouter catalog (334 models at time of writing),
  // so the hardcoded list above is only a fallback. Surfacing the full catalog
  // requires a fetcher + passthroughModels, matching how openrouter.js is set up.
  // Without these, only the 8 hardcoded models appear in the combo model picker,
  // hiding dynamic models like cohere/north-mini-code:free and poolside/laguna-m.1:free.
  modelsFetcher: { url: "https://api.kilo.ai/api/gateway/models", type: "openrouter-free" },
  passthroughModels: true,
  oauth: {
    apiBaseUrl: "https://api.kilo.ai",
    initiateUrl: "https://api.kilo.ai/api/device-auth/codes",
    pollUrlBase: "https://api.kilo.ai/api/device-auth/codes",
  },
};
