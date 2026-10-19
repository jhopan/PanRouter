export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "cli",
    },
    forceStream: true,
    noAuth: true,
    // Zen rejects replayed assistant turns without reasoning_content.
    reasoningInject: {
      scope: "all",
    },
    // Muse Spark only accepts tool_choice "auto". The family is retired from the
    // catalog, but the quirk stays wired so a passthrough id keeps working.
    quirks: {
      forceAutoToolChoiceModels: ["muse-spark-1.3-contributor-free"],
    },
  },
  // Live catalog probed 2026-10-19 from GET /zen/v1/models. Every id here is a
  // currently-served free-tier model; `muse-spark-1.2/1.3-contributor-free` and
  // `union-alpha` were retired upstream (410 ModelDeprecated) and are gone.
  // `test` is excluded on purpose — it is an upstream fixture, not a model.
  models: [
    { id: "big-pickle", name: "Big Pickle" },
    { id: "space-bunny-free", name: "Space Bunny Free" },
    { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free" },
    { id: "glm-5.3-flash-free", name: "GLM 5.3 Flash Free" },
    { id: "mimo-v2.6-flash-free", name: "MiMo V2.6 Flash Free" },
    { id: "longcat-2.5-preview-free", name: "LongCat 2.5 Preview Free" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" },
    { id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL Free" },
    { id: "jev-1.13-free", name: "Jev 1.13 Free" },
    { id: "beam-free", name: "Beam Free" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
