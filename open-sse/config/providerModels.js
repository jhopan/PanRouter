import { PROVIDERS } from "./providers.js";
import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat, modelSupportedFormats, normalizeModelId } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX, isMuseSparkModel } from "../providers/models/helpers.js";
import { FORMATS } from "../translator/formats.js";
export { PROVIDER_MODELS };


// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

// Providers whose registry uses dots in version numbers (e.g. "claude-sonnet-4.5").
// For these, we tolerate clients sending dashes ("claude-sonnet-4-5") by normalizing
// digit-hyphen-digit to digit-dot-digit before lookup. Other providers are left untouched.
const DOT_VERSION_PROVIDERS = new Set(["kr", "kiro"]);

// Find a registry entry by id. For Kiro models, tolerates dash/dot version separators
// ("claude-sonnet-4-5" ~= "claude-sonnet-4.5"). Other providers use exact match only.
function findModel(models, modelId, aliasOrId) {
  if (!models) return undefined;
  const found = models.find(m => m.id === modelId);
  if (found) return found;
  if (!DOT_VERSION_PROVIDERS.has(aliasOrId)) return undefined;
  const normalized = normalizeModelId(modelId);
  if (normalized === modelId) return undefined;
  return models.find(m => m.id === normalized);
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return !!findModel(models, modelId, aliasOrId);
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = findModel(models, modelId, aliasOrId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  if ((!aliasOrId || aliasOrId === "oc" || aliasOrId === "opencode" || aliasOrId === "ocg" || aliasOrId === "opencode-go" || aliasOrId === "ocz" || aliasOrId === "opencode-zen") && isMuseSparkModel(modelId)) {
    return FORMATS.OPENAI_RESPONSES;
  }
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  return modelTargetFormat(findModel(models, modelId, aliasOrId));
}

// Declared upstream formats for a model (registry `supportedFormats`). Drives the
// per-model guard on the sourceFormat-matched transport; null when undeclared.
export function getModelSupportedFormats(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  // A trailing "(level)" is a thinking selector, not part of the model id — the
  // same strip getModelUpstreamId does, so glm-5.2(max) still resolves its
  // supportedFormats and the chatCore transport guard can fire for it.
  const baseId = typeof modelId === "string" ? modelId.replace(/\([^()]+\)\s*$/, "").trim() : modelId;
  return modelSupportedFormats(findModel(models, baseId, aliasOrId));
}

export function getModelType(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  return found?.kind || found?.type || null;
}

// Raw registry entry for a model (suffix-aware) — executor lookups of per-model hints (e.g. defaultLocation).
export function getModelMeta(aliasOrId, modelId) {
  return findModel(PROVIDER_MODELS[aliasOrId], modelId, aliasOrId) || null;
}

// Collapse a requested level onto a tier name the registry may declare.
// xhigh/max are wire aliases for high; minimal is the wire alias for low.
function normalizeTier(raw) {
  if (typeof raw !== "string") return "";
  const level = raw.toLowerCase().trim();
  if (!level) return "";
  if (level === "xhigh" || level === "max") return "high";
  if (level === "minimal") return "low";
  return level;
}

// Thinking level the client asked for, read from the unified request shapes:
// OpenAI reasoning_effort, Claude output_config.effort, Claude/Gemini thinking budget.
function tierFromBody(clientBody) {
  if (!clientBody || typeof clientBody !== "object") return "";
  const effort = clientBody.reasoning_effort || clientBody.output_config?.effort;
  if (typeof effort === "string" && effort) return normalizeTier(effort);
  const thinking = clientBody.thinking;
  if (thinking && typeof thinking === "object") {
    const budget = Number(thinking.budget_tokens);
    if (Number.isFinite(budget) && budget > 0) {
      return budget > 16384 ? "high" : budget <= 4096 ? "low" : "medium";
    }
  }
  return "";
}

export function getModelUpstreamId(aliasOrId, modelId, clientBody = null) {
  // Split off thinking suffix "(level)" so lookup hits the base id; re-append it to
  // the result so downstream applyThinking still sees the suffix (body.model is stripped separately).
  const sufMatch = typeof modelId === "string" ? modelId.match(/\([^()]+\)\s*$/) : null;
  const suffix = sufMatch ? sufMatch[0] : "";
  const baseId = suffix ? modelId.slice(0, sufMatch.index).trim() : modelId;
  const models = PROVIDER_MODELS[aliasOrId];

  // Explicit "(level)" suffix wins over the client body. The tiered variant is used
  // ONLY when the registry declares it — an id this provider does not publish is
  // never synthesised, so resolution falls back to the base id unchanged.
  const tier = normalizeTier(suffix ? suffix.slice(1, -1) : "") || tierFromBody(clientBody);
  const found = (tier ? findModel(models, `${baseId}-${tier}`, aliasOrId) : undefined) || findModel(models, baseId, aliasOrId);
  const resolvedId = found?.upstreamModelId || found?.id;
  if (resolvedId) {
    const presetMatch = resolvedId.match(/\([^()]+\)\s*$/);
    const presetSuffix = presetMatch?.[0] || "";
    const resolvedBase = presetSuffix ? resolvedId.slice(0, presetMatch.index).trim() : resolvedId;
    return resolvedBase + (suffix || presetSuffix);
  }
  if (aliasOrId === "cx" && typeof baseId === "string" && baseId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return baseId.slice(0, -CODEX_REVIEW_SUFFIX.length) + suffix;
  }
  return baseId + suffix;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return modelQuotaFamily(findModel(models, modelId, aliasOrId));
}

// OAuth short aliases — derived from registry `alias` (single source). everything else: alias = id.
// vertex/vertex-partner keep alias=id (kept via the `|| id` fallback in consumers).
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

// Derived from PROVIDERS — no need to maintain manually
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  Object.keys(PROVIDERS).map(id => [id, OAUTH_ALIASES[id] || id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  return modelStrip(findModel(PROVIDER_MODELS[alias], modelId, alias));
}
