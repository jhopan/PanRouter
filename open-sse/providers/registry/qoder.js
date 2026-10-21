export default {
  id: "qoder",
  priority: 30,
  alias: "qd",
  uiAlias: "qd",
  display: {
    name: "Qoder",
    icon: "water_drop",
    color: "#EC4899",
    website: "https://qoder.com",
    notice: {
      signupUrl: "https://qoder.com",
    },
  },
  category: "oauth",
  refreshLeadMs: 259200000, // 3 days — refresh dt-... token before 30-day expiry
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  authHint: "Personal Access Token (pt-...) từ https://qoder.com/account/integrations",
  transport: {
    baseUrl: "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation",
    headers: {},
    timeoutMs: 120000,
    stallTimeoutMs: 120000,
    usage: {
      url: "https://openapi.qoder.sh/api/v2/quota/usage",
    },
  },
  // Mirrors the CN catalog. Qoder's signed live catalog is still used for
  // model_config (wire parameters), but it is never the UI/API model source —
  // these entries are. Order runs cheap/fast first, premium last.
  models: [
    { id: "auto", name: "Auto" },
    { id: "lite", name: "Lite" },
    { id: "efficient", name: "Efficient" },
    { id: "performance", name: "Performance" },
    { id: "ultimate", name: "Ultimate" },
    { id: "qfmodel", name: "Qwen3.8-Flash (Free)" },
    { id: "qmodel", name: "Qwen3.7-Plus" },
    { id: "qmodel_latest", name: "Qwen3.7-Max" },
    { id: "qmodel_38max", name: "Qwen3.8-Max" },
    // DeepSeek's official release (DeepSeek-V4.1-Flash-1017), free on Qoder.
    { id: "dfmodel_v41", name: "DeepSeek-Flash (Free)" },
    { id: "dfmodel", name: "DeepSeek-V4-Flash" },
    { id: "dmodel", name: "DeepSeek-V4-Pro" },
    { id: "kmodel", name: "Kimi-K2.7-Code" },
    { id: "kmodel_latest", name: "Kimi-K3" },
    { id: "gmodel", name: "GLM-5.3" },
    { id: "gfmodel", name: "GLM-5.3-Flash" },
    { id: "mmodel", name: "MiniMax-M3" },
  ],
  oauth: {
    openApiBaseUrl: "https://openapi.qoder.sh",
    centerBaseUrl: "https://center.qoder.sh",
    chatBaseUrl: "https://api3.qoder.sh",
    deviceTokenUrl: "https://openapi.qoder.sh/api/v1/deviceToken/poll",
    refreshUrl: "https://center.qoder.sh/algo/api/v3/user/refresh_token",
    userInfoUrl: "https://openapi.qoder.sh/api/v1/userinfo",
    quotaUsageUrl: "https://openapi.qoder.sh/api/v2/quota/usage",
    loginUrl: "https://qoder.com/device/selectAccounts",
  },
  features: {
    usage: true,
    // PAT (apikey) connections also carry quota usage (via job-token exchange).
    usageApikey: true,
  },
};
