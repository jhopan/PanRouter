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

    // The official CLI (1.4.8) reads `ineligibleTiers` from this response and
    // STOPS — it never sends the chat request. PanRouter used to ignore the
    // field entirely, so a flagged account kept serving traffic.
    const eligibility = parseAntigravityEligibility(subscriptionInfo);
    if (eligibility && eligibility.eligible === false) {
      console.warn(`[AG_QUOTA] ACCOUNT VERIFICATION REQUIRED\n${formatEligibilityLog({
        reasonCode: eligibility.reasonCode || "VALIDATION_REQUIRED",
        validationUrl: eligibility.validationUrl,
      })}`);
    }

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
      // The quota endpoint can refuse with VALIDATION_REQUIRED — Google wants
      // the account verified in a browser. Read the reason out of the body so
      // the caller can park the account instead of retrying it.
      let quotaEligibility = null;
      try {
        const body = await response.json();
        quotaEligibility = parseAntigravityQuotaEligibility(body);
      } catch { /* body may be empty */ }
      return {
        message: quotaEligibility
          ? `Antigravity account needs verification: ${quotaEligibility.reasonCode || "VALIDATION_REQUIRED"}`
          : "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {},
        ...(quotaEligibility ? { ineligible: quotaEligibility } : {}),
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
      // Surface the eligibility verdict so the caller can park a flagged
      // account. `eligible: true` means the account is fine; `null` means the
      // payload carried no eligibility information (no opinion).
      ...(eligibility ? { ineligible: eligibility } : {}),
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
 * Scan an Antigravity API payload for account verification / eligibility gates
 * and print the verification URL to the console when found. Fail-open: any
 * parse hiccup is ignored. Google's message is usually:
 *   "Eligibility check failed: Your current account is not eligible for
 *    Antigravity. Verify your account to continue." + accounts.google.com URL.
 */
export function formatEligibilityLog({ reasonCode = "VALIDATION_REQUIRED", validationUrl }) {
  return JSON.stringify({
    eligibility: {
      eligible: false,
      reasonCode,
      validationUrl,
    },
  }, null, 2);
}

/**
 * Extract the account-eligibility gate from a loadCodeAssist / loadProject
 * response.
 *
 * Live MITM capture of the official CLI 1.4.8 (2026-10-27, account
 * ayuantini63) shows the shape:
 *
 *   {
 *     "allowedTiers": [ { "id": "standard-tier", "name": "Antigravity", ... } ],
 *     "ineligibleTiers": [
 *       {
 *         "reasonCode": "VALIDATION_REQUIRED",
 *         "reasonMessage": "Your current account is not eligible for Antigravity...",
 *         "tierId": "free-tier",
 *         "tierName": "Antigravity",
 *         "validationErrorMessage": "Verify your account to continue.",
 *         "validationUrlLinkText": "Verify your account",
 *         "validationUrl": "https://accounts.google.com/v3/signin/continue?...",
 *         "validationLearnMoreLinkText": "Learn more",
 *         "validationLearnMoreUrl": "https://support.google.com/accounts?p=al_alert"
 *       }
 *     ]
 *   }
 *
 * The official CLI stops there — it never sends the chat request. PanRouter
 * used to ignore `ineligibleTiers` entirely and only regex-scanned the payload
 * for the word "verify", so a flagged account kept serving traffic.
 *
 * @param {object} payload - parsed JSON body
 * @returns {{eligible: boolean, reasonCode: string|null, reasonMessage: string|null,
 *            validationUrl: string|null, tierId: string|null}|null}
 *   null when the payload carries no eligibility information at all.
 */
export function parseAntigravityEligibility(payload) {
  if (!payload || typeof payload !== "object") return null;

  const tiers = Array.isArray(payload.ineligibleTiers) ? payload.ineligibleTiers : [];
  if (tiers.length === 0) {
    // No ineligible tiers → the account is fine, unless there is no allowed
    // tier either (an account with neither is not usable).
    const allowed = Array.isArray(payload.allowedTiers) ? payload.allowedTiers : [];
    if (allowed.length > 0) return { eligible: true, reasonCode: null, reasonMessage: null, validationUrl: null, tierId: null };
    return null;
  }

  // Prefer the tier that names a validation reason; the first tier is not
  // necessarily the blocking one.
  const tier = tiers.find((t) => t && (t.reasonCode || t.validationUrl || t.reasonMessage)) || tiers[0] || {};
  const reasonCode = tier.reasonCode || null;
  const validationUrl = tier.validationUrl || null;

  return {
    eligible: false,
    reasonCode,
    reasonMessage: tier.reasonMessage || tier.validationErrorMessage || null,
    validationUrl,
    tierId: tier.tierId || null,
  };
}

/**
 * Extract the eligibility gate from a retrieveUserQuotaSummary 403 body.
 *
 *   {
 *     "error": {
 *       "code": 403, "status": "PERMISSION_DENIED",
 *       "message": "Verify your account to continue.",
 *       "details": [
 *         { "@type": ".../google.rpc.ErrorInfo",
 *           "reason": "VALIDATION_REQUIRED",
 *           "metadata": { "validation_url": "https://accounts.google.com/..." } },
 *         { "@type": ".../google.rpc.Help", "links": [ { "url": "..." } ] }
 *       ]
 *     }
 *   }
 *
 * @param {object} payload - parsed JSON body
 * @returns {{eligible: boolean, reasonCode: string|null, reasonMessage: string|null,
 *            validationUrl: string|null, tierId: string|null}|null}
 */
export function parseAntigravityQuotaEligibility(payload) {
  if (!payload || typeof payload !== "object") return null;
  const error = payload.error;
  if (!error || typeof error !== "object") return null;

  const details = Array.isArray(error.details) ? error.details : [];
  // The ErrorInfo detail carries the reason code and the metadata; the Help
  // detail carries only the link. Either alone is enough to act on.
  const info = details.find((d) => d && (d.reason || d.metadata?.validation_url));
  const help = details.find((d) => d && d.links && Array.isArray(d.links));
  const helpUrl = help?.links?.find((l) => l?.url?.includes("accounts.google.com"))?.url || null;

  if (!info && !helpUrl) return null;

  const reasonCode = info?.reason || null;
  const metadata = info?.metadata || {};
  const validationUrl = metadata.validation_url || helpUrl || null;

  return {
    eligible: false,
    reasonCode,
    reasonMessage: metadata.validation_error_message || error.message || null,
    validationUrl,
    tierId: null,
  };
}

