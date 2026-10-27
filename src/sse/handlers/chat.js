import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { trimMessagesToBudget, estimateTokens } from "open-sse/services/messageTrimmer.js";
import { getSettings } from "@/lib/localDb";
import { checkApiKeyLimits } from "@/lib/apiKeyLimits.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { globalCapacityLimit } from "open-sse/config/quotaWindows.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  // Per-key prepaid pool: model allowlist, token pool, expiry. Runs whenever a
  // key is supplied AND carries a limits blob — legacy keys stay unlimited.
  if (apiKey && modelStr) {
    const limit = await checkApiKeyLimits(apiKey, modelStr);
    if (!limit.ok) {
      log.warn("AUTH", `API key limit: ${limit.code} — ${limit.message}`);
      return errorResponse(limit.status, limit.message);
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const augmentedModels = await augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = await augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: await getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      const augmentedModels = await augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;


  // ── Account rotation safety (CodeBuddy 11140 / "unusual activity") ───────
  // A provider ban is contagious through the request PATTERN, not through the
  // account. Rotating through 20 accounts inside 13 seconds with one
  // conversation id is the pattern the ban is issued for, and every account in
  // the pool gets flagged with it. So:
  //   1. the same account is retried once before rotating (keeps the prompt
  //      cache and the conversation id on one account, and 11128 is often
  //      transient)
  //   2. rotating waits a few seconds, so the traffic is not a burst
  //   3. after N consecutive provider bans the rotation stops, so the remaining
  //      accounts are never touched
  const SAME_ACCOUNT_RETRIES = 1;
  // Rotation delay between accounts. A burst of refusals across the pool in a
  // couple of seconds is exactly what looks like automation — spreading the
  // attempts out keeps the pattern human-shaped.
  const ACCOUNT_ROTATION_DELAY_MS = 3000;
  let sameAccountRetries = 0;
  let consecutiveBans = 0;

  // Admission queue: the model is free but momentarily busy for EVERY key on the
  // provider. Waiting and retrying the SAME account is the only thing that can
  // work — rotating would just take the same queue on every other account.
  const QUEUE_MAX_RETRIES = 2;
  const QUEUE_MAX_WAIT_MS = 45_000;
  let queueRetries = 0;

  // Cold-cache trim: CodeBuddy's prompt cache belongs to the ACCOUNT. When the
  // request lands on a different account than the previous turn, that account
  // has no cache for this conversation and the whole history is uploaded
  // (observed: 412k tokens). A 412k-token upload is the shape most likely to
  // get an account flagged, so the history is trimmed to fit the model window
  // before the request goes out.
  const TRIM_ON_COLD_ACCOUNT = true;
  const TRIM_BUDGET_TOKENS = 200_000;
  let lastAccountId = null;
  let conversationTrimmed = false;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable (or auth returned a structured pin error)
    if (!credentials || credentials.allRateLimited || credentials.__authError) {
      if (credentials?.__authError) {
        log.warn("CHAT", `[${provider}/${model}] ${credentials.__authError}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, credentials.__authError);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (excludeConnectionIds.size === 0) {
        if (credentials?.error) {
          log.warn("CHAT", `[${provider}/${model}] ${credentials.error}`);
          return errorResponse(credentials.status || HTTP_STATUS.NOT_FOUND, credentials.error);
        }
        log.warn("CHAT", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;

    // Cold-account trim (see the state comment above). Only fires when the
    // request lands on a DIFFERENT account than the previous turn, and only
    // once per conversation — trimming again would keep eating history.
    let requestBody = body;
    if (TRIM_ON_COLD_ACCOUNT
        && provider === "codebuddy-intl"
        && !conversationTrimmed
        && lastAccountId
        && lastAccountId !== credentials.connectionId
        && Array.isArray(body?.messages)) {
      const trimmed = trimMessagesToBudget(body.messages, TRIM_BUDGET_TOKENS);
      if (trimmed.removed > 0) {
        conversationTrimmed = true;
        requestBody = { ...body, messages: trimmed.messages };
        log.warn("CHAT", `[${provider}/${model}] cold account (${credentials.connectionId?.slice(0, 8)}) — trimmed ${trimmed.removed} oldest messages, ${trimmed.before} → ${trimmed.after} tokens`);
      }
    }
    lastAccountId = credentials.connectionId;

    const result = await handleChatCore({
      body: { ...requestBody, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      // Per-provider opt-out for the system-prompt injectors. CodeBuddy's
      // gateway compares the message structure against what its official client
      // sends; the CLI never injects an extra system prompt, so CAVEMAN and
      // PONYTAIL make the request look hand-rolled there.
      cavemanEnabled: !!chatSettings.cavemanEnabled
        && !(chatSettings.cavemanDisabledProviders || []).includes(provider),
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled
        && !(chatSettings.ponytailDisabledProviders || []).includes(provider),
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
      }
    });

    if (result.success) return result.response;

    // Antigravity 409/429/403(quota): prefer the exact reset parsed from the error
    // body (quotaResetTimeStamp / RetryInfo) — the quota usage API has no per-model
    // row for free-tier accounts, and running it anyway would trip the strike
    // breaker into a 15m CACHE_BLOCK instead of the true multi-day reset.
    // Only hit the live quota API when the body carried no precise resetAt.
    // 403 "You exceeded your current quota" / "not eligible. Verify your account"
    // is the same quota-class refusal (and surfaces the verification URL via
    // the quota refresh logVerificationHint) — treat it like 429 here.
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    const antigravityQuotaStatus = result.status === 409 || result.status === 429 ||
      (result.status === 403 && /quota|eligible|verify|further action/i.test(result.error || ""));
    if (provider === "antigravity" && antigravityQuotaStatus && !resetsAtMs) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // A request-level rejection (prompt too long, malformed body) is not the
    // account's fault: the identical request fails on every account, so
    // falling back would park all of them in a row. Return immediately.
    if (result.fatal === true) {
      log.warn("CHAT", `[${provider}/${model}] fatal request error (${result.status}): ${String(result.error || "").slice(0, 120)}`);
      return errorResponse(result.status || HTTP_STATUS.BAD_REQUEST, result.error || "Request rejected by upstream");
    }

    // A provider-wide capacity limit is shared by EVERY key, so rotating cannot
    // help: the next account gets the same 429. BazaarLink says so explicitly
    // ("Free models share a limited site-wide capacity ... this is not your
    // personal quota"). Stop here instead of locking all 12 keys in turn.
    const globalLimit = globalCapacityLimit(result.status, result.error);
    if (globalLimit) {
      const retrySec = Math.round(globalLimit.retryAfterMs / 1000);
      log.warn("CHAT", `[${provider}/${model}] provider-wide capacity limit — not rotating accounts, retry in ${retrySec}s`);
      return unavailableResponse(
        HTTP_STATUS.RATE_LIMITED,
        `[${provider}/${model}] ${result.error}`,
        Math.ceil(globalLimit.retryAfterMs / 1000),
        `${retrySec}s`,
        lastHeaders,
      );
    }

    // Admission queue (Qoder 10605 isQueued, serviceAvailable:false,
    // queueCount:0): the capacity is shared by EVERY key on the provider, so
    // the model is free but busy — this is a QUEUE, not an error. The official
    // CLI shows the same thing ("Model request queued (34s)") and succeeds once
    // the queue drains.
    //
    // So the right move is to WAIT and retry the SAME account. Rotating would
    // hit the same queue on every other account and only burn their quota, and
    // locking the account would hide a healthy one. The wait is the provider's
    // own retryAfterSeconds (30s).
    if (result.queueThrottle) {
      if (queueRetries < QUEUE_MAX_RETRIES) {
        queueRetries += 1;
        const waitMs = Math.max(1000, Math.min((result.resetsAtMs || 0) - Date.now(), QUEUE_MAX_WAIT_MS));
        log.warn("CHAT", `[${provider}/${model}] queued upstream (shared model capacity) — waiting ${Math.round(waitMs / 1000)}s and retrying the same account (${queueRetries}/${QUEUE_MAX_RETRIES})`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      // Still queued after the retries: report it, and leave the account
      // untouched (no lock, no rotation) so it stays available.
      const retrySec = Math.max(1, Math.round(((result.resetsAtMs || 0) - Date.now()) / 1000)) || 30;
      log.warn("CHAT", `[${provider}/${model}] still queued after ${QUEUE_MAX_RETRIES} retries — giving up without locking the account`);
      return unavailableResponse(
        HTTP_STATUS.RATE_LIMITED,
        `[${provider}/${model}] queued upstream: ${result.error}`,
        retrySec,
        `queued, retry in ~${retrySec}s`,
        lastHeaders,
      );
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    // Same-account retry: a channel-verification refusal (11128) is often
    // transient, and staying on one account keeps the prompt cache and the
    // conversation id consistent. The retry happens BEFORE the account is
    // locked, because a lock would push the next attempt onto a different
    // account — exactly the rotation the retry is meant to avoid.
    if (result.banned !== true
        && result.fatal !== true
        && sameAccountRetries < SAME_ACCOUNT_RETRIES
        && provider === "codebuddy-intl") {
      sameAccountRetries += 1;
      log.warn("CHAT", `[${provider}/${model}] retrying the same account (${sameAccountRetries}/${SAME_ACCOUNT_RETRIES}) — ${String(result.error || "").slice(0, 80)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }

    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(
          credentials.connectionId,
          result.status,
          result.error,
          provider,
          model,
          resetsAtMs,
          // The executor's own parser already decided the account is banned
          // (CodeBuddy 11140, or "request illegal" with no channel code).
          // Without this the verdict never reached auth.js, and the account
          // got a generic 120s per-model lock instead of a 30-day account ban.
          result.banned === true,
        )).shouldFallback;

    if (shouldFallback) {
      // A provider ban means the account is refused outright. Mark it banned and
      // move on to the next one — but do NOT stop early. The pool is the
      // operator's; every account that is still healthy should get its chance.
      // The burst itself is what looks like automation, so the rotation waits
      // between accounts instead of stopping.
      if (result.banned) {
        consecutiveBans += 1;
        log.warn("CHAT", `[${provider}/${model}] account banned by the provider (#${consecutiveBans}) — banning it and trying the next account`);
      }

      // Rotating to another account: wait first. Several accounts in a couple of
      // seconds looks like automation; the same accounts spread out does not.
      if (excludeConnectionIds.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, ACCOUNT_ROTATION_DELAY_MS));
      }

      log.debug("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      sameAccountRetries = 0;
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      continue;
    }

    return result.response;
  }
}
