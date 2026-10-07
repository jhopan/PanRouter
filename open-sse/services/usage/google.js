/**
 * Google usage handlers (Gemini CLI + Antigravity)
 */

import { CLIENT_METADATA } from "../../config/appConstants.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, ANTIGRAVITY_OAUTH_CLIENT } from "../../providers/shared.js";
import { U, parseResetTime, normalizeCloudCodeProjectId, fetchWithTimeout } from "./shared.js";
import { fetchAntigravityWeeklyQuota } from "./antigravity-weekly.js";

// Antigravity API config (from Quotio) — urls from registry, oauth client + dynamic UA kept here
const ANTIGRAVITY_CONFIG = {
  ...U("antigravity"),
  ...ANTIGRAVITY_OAUTH_CLIENT,
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

/**
 * Gemini CLI Usage — fetch per-model quota via Cloud Code Assist API.
 * Uses retrieveUserQuota (same endpoint as `gemini /stats`) returning
 * per-model buckets with remainingFraction + resetTime.
 */
export async function getGeminiUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    // Resolve project id: prefer connection-stored id, else loadCodeAssist lookup.
    // #1271: OAuth save stores projectId on the connection, not providerSpecificData.
    let projectId = normalizeCloudCodeProjectId(providerSpecificData?.projectId);
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(accessToken, proxyOptions);
      projectId = normalizeCloudCodeProjectId(subInfo?.cloudaicompanionProject);
      plan = subInfo?.currentTier?.name || plan;
    }

    if (!projectId) {
      return {
        plan,
        message: "Gemini CLI project ID not available. Reconnect Gemini CLI, or configure a Google Cloud project with Gemini Code Assist access before checking quota.",
      };
    }

    const response = await fetchWithTimeout(
      U("gemini-cli").quotaUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project: projectId }),
      },
      10000,
      proxyOptions
    );

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000; // Normalized base, matches antigravity convention
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Gemini CLI error: ${error.message}` };
  }
}

/**
 * Get Gemini CLI subscription info via loadCodeAssist
 */
async function getGeminiSubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(
      U("gemini-cli").loadCodeAssistUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ metadata: CLIENT_METADATA }),
      },
      10000,
      proxyOptions
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API
 */
export async function getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    // Fetch subscription info once — reuse for both projectId and plan
    const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, proxyOptions);
    const projectId = subscriptionInfo?.cloudaicompanionProject || null;

    // Surface REAL account-level eligibility gates (ineligibleTiers[] +
        // validationUrl), deduped 30 min per account, full URL. No keyword guessing.
        logEligibilityOnce(subscriptionInfo, accessToken);

    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.quotaApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
        "X-Client-Name": "antigravity",
        "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
      },
      body: JSON.stringify({
        ...(projectId ? { project: projectId } : {})
      }),
    }, 10000, proxyOptions);

    if (response.status === 403) {
      return {
        message: "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {}
      };
    }

    if (response.status === 401) {
      return {
        message: "Antigravity quota API authentication expired. Chat may still work.",
        quotas: {}
      };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();
    const quotas = {};

    // Detect tier: free-tier accounts only have weekly quotas (no separate 5h window).
    // On free-tier, fetchAvailableModels returns misleading per-model quota info
    // (missing remainingFraction defaults to 0, or reflects the weekly limit not a 5h window).
    const paidTierId = subscriptionInfo?.paidTier?.id;
    const isFreeTier = !paidTierId || paidTierId === "free-tier";

    // Parse model quotas only for paid-tier accounts.
    // Free-tier accounts skip this — their only meaningful quota is the weekly limit.
    if (!isFreeTier && data.models) {
      // Filter only recommended/important models (must match PROVIDER_MODELS ag ids)
      const importantModels = [
        'gemini-3.8-flash-high',
        'gemini-3.8-flash-medium',
        'gemini-3.8-flash-low',
        'gemini-3.7-flash-high',
        'gemini-3.7-flash-medium',
        'gemini-3.7-flash-low',
        'gemini-3.6-flash-high',
        'gemini-3.6-flash-medium',
        'gemini-3.6-flash-low',
        'gemini-3.5-flash-low',
        'gemini-3.5-flash-extra-low',
        'gemini-pro-agent',
        'gemini-3.1-pro-low',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
        // Image generation models
        'gemini-3.1-flash-image',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        // Skip models without quota info
        if (!info.quotaInfo) {
          continue;
        }

        // Skip internal models and non-important models
        if (info.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const remainingPercentage = remainingFraction * 100;

        // Convert percentage to used/total for UI compatibility
        const total = 1000; // Normalized base
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        // Use modelKey as key (matches PROVIDER_MODELS id)
        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: info.displayName || modelKey,
        };
      }
    }

    // Best-effort weekly quota overlay — never blocks or breaks per-model results
    try {
      const weeklyQuotas = await fetchAntigravityWeeklyQuota(
        accessToken,
        projectId,
        proxyOptions
      );

      // Reconcile weekly quota against model family status:
      // If every model in a family is locked/exhausted (remainingPercentage === 0)
      // until a future reset time, the weekly limit cannot be 100% available.
      // On Google's Free Starter tier, retrieveUserQuotaSummary buggily reports
      // remainingFraction: 1 even after the starter quota is depleted and all models 429.
      const entries = Object.entries(quotas);
      const geminiModels = entries.filter(([k]) => k.startsWith("gemini-") && !k.includes("image"));
      const claudeModels = entries.filter(([k]) => k.startsWith("claude-"));

      if (weeklyQuotas.gemini_weekly && geminiModels.length > 0) {
        const allGeminiExhausted = geminiModels.every(([, q]) => (q.remainingPercentage ?? 0) === 0);
        if (allGeminiExhausted && weeklyQuotas.gemini_weekly.remainingPercentage > 0) {
          const maxResetAt = geminiModels.reduce((max, [, q]) =>
            !max || (q.resetAt && new Date(q.resetAt) > new Date(max)) ? q.resetAt : max, null
          );
          weeklyQuotas.gemini_weekly.used = weeklyQuotas.gemini_weekly.total;
          weeklyQuotas.gemini_weekly.remainingPercentage = 0;
          if (maxResetAt) {
            weeklyQuotas.gemini_weekly.resetAt = maxResetAt;
          }
        }
      }

      if (weeklyQuotas.claude_gpt_weekly && claudeModels.length > 0) {
        const allClaudeExhausted = claudeModels.every(([, q]) => (q.remainingPercentage ?? 0) === 0);
        if (allClaudeExhausted && weeklyQuotas.claude_gpt_weekly.remainingPercentage > 0) {
          const maxResetAt = claudeModels.reduce((max, [, q]) =>
            !max || (q.resetAt && new Date(q.resetAt) > new Date(max)) ? q.resetAt : max, null
          );
          weeklyQuotas.claude_gpt_weekly.used = weeklyQuotas.claude_gpt_weekly.total;
          weeklyQuotas.claude_gpt_weekly.remainingPercentage = 0;
          if (maxResetAt) {
            weeklyQuotas.claude_gpt_weekly.resetAt = maxResetAt;
          }
        }
      }

      Object.assign(quotas, weeklyQuotas);
    } catch {
      // Silently ignore — weekly is best-effort
    }

    return {
      plan: subscriptionInfo?.currentTier?.name || "Unknown",
      quotas,
      subscriptionInfo,
    };
  } catch (error) {
    console.error("[Antigravity Usage] Error:", error.message, error.cause);
    return { message: `Antigravity error: ${error.message}` };
  }
}

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
    }, 10000, proxyOptions);

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  }
}

/**
 * Parse Google's eligibility verdict from a loadCodeAssist/loadProject payload.
 * Authoritative field: `ineligibleTiers[]` — eligible accounts simply omit it.
 * @returns {object} { eligible:boolean, reasonCode?, reasonMessage?, validationUrl?, tierName? }
 */
export function parseEligibility(payload) {
  try {
    const inel = Array.isArray(payload?.ineligibleTiers) ? payload.ineligibleTiers : [];
    if (inel.length === 0) return { eligible: true };
    const first = inel[0] || {};
    return {
      eligible: false,
      reasonCode: first.reasonCode || "INELIGIBLE",
      reasonMessage: first.reasonMessage || "",
      validationUrl: first.validationUrl || "",
      learnMoreUrl: first.validationLearnMoreUrl || "",
      tierName: first.tierName || first.tierId || "",
    };
  } catch {
    return { eligible: true }; // fail-open: unknown state must never block
  }
}

// Dedup: one verification warning per account/URL per 30 minutes max.
const verificationWarnedAt = new Map();
const VERIFICATION_WARN_TTL_MS = 30 * 60 * 1000;

/**
 * Log a real ineligible (validation-required) account ONCE per 30min with the
 * FULL verification URL — no keyword guessing, no truncation. Fail-open.
 */
function logEligibilityOnce(payload, accessToken = "") {
  try {
    const info = parseEligibility(payload);
    if (info.eligible) return;
    const url = info.validationUrl || "(URL not returned by API)";
    const urlKey = info.validationUrl || accessToken.slice(0, 12);
    const last = verificationWarnedAt.get(urlKey) || 0;
    if (Date.now() - last < VERIFICATION_WARN_TTL_MS) return;
    verificationWarnedAt.set(urlKey, Date.now());
    console.warn(
      `[AG_QUOTA] AKUN TIDAK ELIGIBLE (${info.reasonCode || "INELIGIBLE"}) — ${info.tierName ? "tier " + info.tierName + " " : ""}\n` +
      `  pesan: ${(info.reasonMessage || "").slice(0, 300)}\n` +
      `  buka link verifikasi lengkap berikut di browser akun tersebut:\n  ${url}\n` +
      `  (sama seperti prompt "Further action is required to use Antigravity" di CLI agy)`
    );
  } catch {
    // never break quota refresh because of logging
  }
}

// Short-lived eligibility cache (5m) so test/usage calls don't hammer loadCodeAssist.
const eligibilityCache = new Map();
const ELIGIBILITY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Public helper: real eligibility verdict for an Antigravity connection.
 * Cached 5 minutes, fail-open (eligible when unknown).
 * @returns {Promise<{eligible:boolean, reasonCode?:string, reasonMessage?:string, validationUrl?:string}>}
 */
export async function getAntigravityEligibility(accessToken, providerSpecificData, proxyOptions = null) {
  const cacheKey = String(accessToken || "").slice(-24);
  const cached = eligibilityCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.info;

  const info = parseEligibility(await getAntigravitySubscriptionInfo(accessToken, proxyOptions));
  eligibilityCache.set(cacheKey, { info, expiresAt: Date.now() + ELIGIBILITY_CACHE_TTL_MS });
  return info;
}

/** Pull eligibility out of an already-fetched usage object (no extra network). */
export function eligibilityFromUsage(usage) {
  return parseEligibility(usage?.subscriptionInfo);
}
