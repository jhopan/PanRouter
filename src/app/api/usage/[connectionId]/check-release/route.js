// POST /api/usage/[connectionId]/check-release
//
// "Check & release": read the provider's live quota and, if the account is no
// longer exhausted, lift the block so the account is usable again.
//
// Why this exists: a MiniMax plan block lasts 24 hours, so a top-up (or a
// daily check-in that refills the plan) would otherwise leave the account
// unusable for the rest of the day even though the provider is serving it
// again. The tracker already knows the truth — this endpoint reads it and acts
// on it.
//
// It is deliberately NOT "unblock on demand": the quota is verified first, so
// the button cannot be used to force a request against an exhausted account.
// The provider's own answer decides.
//
// Fail-open by contract: a tracker error leaves the block in place and reports
// the error, because releasing an exhausted account would only produce another
// 429.
import { NextResponse } from "next/server";

import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { clearMiniMaxCap, recordMiniMaxUsage, shouldSkipMiniMaxAccount } from "open-sse/services/minimaxCapCache.js";
import { clearBanFields } from "open-sse/services/bannedAccounts.js";

const MODEL_LOCK_PREFIX = "modelLock_";

/**
 * Read the provider quota and decide whether the account is usable again.
 * @returns {Promise<{released: boolean, reason: string, usage?: object}>}
 */
async function checkAndRelease(connection) {
  const provider = connection.provider;

  // ── MiniMax Code ─────────────────────────────────────────────────────────
  if (provider === "minimax-code" || provider === "minimax-code-global") {
    const usage = await getUsageForProvider(connection);
    if (!usage || usage.error || usage.message) {
      return {
        released: false,
        reason: usage?.message || "Usage API unavailable — the block was left in place",
      };
    }
    if (!usage.quotas || Object.keys(usage.quotas).length === 0) {
      return { released: false, reason: "The tracker returned no quota rows" };
    }

    // Feed the reading first: a healthy plan clears the cached block.
    recordMiniMaxUsage(connection.id, usage);
    const stillBlocked = shouldSkipMiniMaxAccount(connection.id);
    if (stillBlocked.skip) {
      return {
        released: false,
        reason: stillBlocked.until
          ? `The plan is still exhausted — it resets at ${new Date(stillBlocked.until).toISOString()}`
          : "The plan is still exhausted (credit balance empty)",
        usage,
      };
    }

    // The provider is serving this account again — lift every block.
    const lockKeys = Object.keys(connection).filter((k) => k.startsWith(MODEL_LOCK_PREFIX));
    const clearLocks = {};
    for (const key of lockKeys) clearLocks[key] = null;
    await updateProviderConnection(connection.id, {
      ...clearLocks,
      ...clearBanFields(),
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      errorCode: null,
      quotaExhaustedUntil: null,
      backoffLevel: 0,
    });
    clearMiniMaxCap(connection.id);
    return { released: true, reason: "The plan has quota again — the account is usable", usage };
  }

  // ── Generic path: any provider with a usage API ──────────────────────────
  const usage = await getUsageForProvider(connection);
  if (!usage || usage.error || usage.message) {
    return {
      released: false,
      reason: usage?.message || "Usage API not implemented for this provider",
    };
  }

  const rows = Object.values(usage.quotas || {});
  const exhausted = rows.some((q) => {
    if (!q || typeof q !== "object") return false;
    if (q.isCreditBalance) return Number(q.total) <= 0;
    const pct = Number(q.remainingPercentage ?? q.remaining);
    return Number.isFinite(pct) && pct <= 0;
  });

  if (exhausted) {
    return { released: false, reason: "The provider still reports this account as exhausted", usage };
  }

  const lockKeys = Object.keys(connection).filter((k) => k.startsWith(MODEL_LOCK_PREFIX));
  const clearLocks = {};
  for (const key of lockKeys) clearLocks[key] = null;
  await updateProviderConnection(connection.id, {
    ...clearLocks,
    ...clearBanFields(),
    testStatus: "active",
    lastError: null,
    lastErrorAt: null,
    errorCode: null,
    quotaExhaustedUntil: null,
    backoffLevel: 0,
  });
  return { released: true, reason: "The provider reports quota available — the account is usable", usage };
}

export async function POST(request, { params }) {
  try {
    const { connectionId } = await params;
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const result = await checkAndRelease(connection);
    return NextResponse.json({
      released: result.released,
      reason: result.reason,
      quotas: result.usage?.quotas ?? null,
    });
  } catch (error) {
    console.error("[CHECK_RELEASE] failed:", error);
    return NextResponse.json(
      { error: `Check failed: ${error?.message || "unknown error"}` },
      { status: 500 },
    );
  }
}
