// CodeBuddy Intl Auto-Ping (Daily Check-in / Activity Keeper)
// Sends one tiny chat request per day on the cheapest model (fast-model)
// at a randomized daily daylight slot to keep the daily sign-in / activity active.

import { getProviderConnections, updateProviderConnection, getSettings } from "@/lib/localDb";
import { CODEBUDDY_AUTOPING_CONFIG as C } from "@/shared/constants/config";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";

// Survive Next.js hot reload; one scheduler per server process.
const g = (global.__codebuddyAutoPing ??= {
  interval: null,
  running: false,
  failureCache: {},
  slots: {},
  lastTouch: {},
  immediateNextTick: false,
});

/**
 * Day key (Asia/Jakarta / WIB) for a timestamp, aligned to 08:00 WIB daily reset boundary.
 * 08:01 WIB today to 07:58 WIB tomorrow belong to the same cycle key.
 */
export function dailySlotKey(nowMs = Date.now(), resetHour = C.resetHourWIB ?? 8) {
  const shiftedMs = nowMs - (resetHour * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(shiftedMs));
}

/**
 * Deterministic-but-daily slot in the 24-hour cycle.
 * Randomly spreads connections across 08:01 WIB (min 1) to 07:58 WIB next day (min 1438).
 */
export function slotMinuteOfDay(connectionId, dKey, startArg = C.slotStartMin ?? 1, endArg = C.slotEndMin ?? 1438) {
  const s = `${connectionId}::${dKey}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 131) + s.charCodeAt(i)) >>> 0;
  // If arguments <= 24, treat as hours for backward compatibility
  const startMin = startArg <= 24 && endArg <= 24 ? startArg * 60 : startArg;
  const endMin = startArg <= 24 && endArg <= 24 ? endArg * 60 : endArg;
  const span = Math.max(1, endMin - startMin);
  return startMin + (h % span);
}

/** Minutes elapsed in current 08:00 WIB cycle (0..1439). */
export function cycleMinuteElapsed(nowMs = Date.now(), resetHour = C.resetHourWIB ?? 8) {
  const wib = new Date(nowMs + 7 * 3600 * 1000); // shift to UTC+7 (WIB)
  const minuteOfDay = wib.getUTCHours() * 60 + wib.getUTCMinutes();
  return (minuteOfDay - resetHour * 60 + 1440) % 1440;
}

function shouldSkipAfterFailure(connectionId, nowMs = Date.now()) {
  const at = g.failureCache[connectionId];
  return at && nowMs - at < C.failureCooldownMs;
}

/** Has this connection already been pinged today? */
function pingedToday(connection, dKey) {
  if (connection.lastAutoPingDayKey === dKey) return true;
  if (connection.lastAutoPingAt && dailySlotKey(new Date(connection.lastAutoPingAt).getTime()) === dKey) return true;
  return false;
}

async function runPingForConnection(conn, proxyOptions) {
  const dKey = dailySlotKey();
  const connId = conn.id;

  if (pingedToday(conn, dKey)) {
    return { skipped: true, reason: "already pinged today" };
  }

  let connection = conn;
  // If connection has OAuth tokens, ensure they are fresh before pinging.
  try {
    const r = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    if (r?.connection) connection = r.connection;
  } catch (e) {
    // Non-fatal: try with existing token
  }

  const executor = getExecutor("codebuddy-intl");
  const model = C.pingModel || "gpt-5.6-luna";

  const { response } = await executor.execute({
    model,
    stream: true,
    credentials: {
      accessToken: connection.accessToken,
      apiKey: connection.apiKey,
      connectionId: connId,
      providerSpecificData: connection.providerSpecificData,
    },
    proxyOptions,
    log: console,
    body: {
      model,
      stream: true,
      max_tokens: C.pingMaxTokens || 16,
      messages: [{ role: "user", content: C.pingText || "hi" }],
    },
  });

  if (!response?.ok) {
    const text = await response?.text?.().catch(() => "");
    // If upstream returns 429 Credits exhausted, mark failure cache so we don't spam.
    if (response?.status === 429) {
      g.failureCache[connId] = Date.now();
      return { skipped: true, reason: `upstream 429 credits exhausted: ${text.slice(0, 100)}` };
    }
    throw new Error(`codebuddy-intl ping failed (${response?.status}): ${text.slice(0, 160)}`);
  }

  // Drain response body cleanly
  await response?.text?.().catch(() => {});

  delete g.failureCache[connId];
  await updateProviderConnection(connId, {
    lastAutoPingDayKey: dKey,
    lastAutoPingAt: new Date().toISOString(),
    lastAutoPingModel: model,
    updatedAt: new Date().toISOString(),
  });

  return { skipped: false, model };
}

/** Minutes-of-day in WIB (UTC+7) for a given timestamp. */
function wibMinuteOfDay(nowMs = Date.now()) {
  const wib = new Date(nowMs + 7 * 3600 * 1000); // shift to UTC+7
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

async function processConnections(now = new Date()) {
  const settings = await getSettings();
  const cfg = settings?.codebuddyIntlAutoPing || {};
  if (cfg.enabled !== true && !Object.values(cfg.connections || {}).some(Boolean)) return;

  const conns = await getProviderConnections({ provider: "codebuddy-intl", isActive: true });
  const enabledIds = Object.entries(cfg.connections || {})
    .filter(([, on]) => on === true)
    .map(([id]) => id);
  if (enabledIds.length === 0) return;

  const isImmediate = g.immediateNextTick;
  g.immediateNextTick = false;

  const dKey = dailySlotKey(now.getTime());
  const minutesInCycle = cycleMinuteElapsed(now.getTime());

  for (const conn of conns) {
    if (!enabledIds.includes(conn.id)) continue;
    if (shouldSkipAfterFailure(conn.id)) continue;

    const lastMs = g.lastTouch[conn.id] || (conn.lastAutoPingAt ? new Date(conn.lastAutoPingAt).getTime() : 0);
    if (lastMs && now.getTime() - lastMs < C.touchThrottleMs) continue;

    const slot = slotMinuteOfDay(conn.id, dKey);
    // When freshly enabled, or if connection has never been pinged before: fire immediately!
    // Otherwise, wait until its randomized slot in the 08:01 - 07:58 WIB cycle is reached.
    const isNew = !conn.lastAutoPingAt;
    if (!isImmediate && !isNew && minutesInCycle < slot) continue;

    const proxyCfg = await resolveConnectionProxyConfig(conn.providerSpecificData).catch(() => ({}));
    const proxyOptions = {
      connectionProxyEnabled: proxyCfg.connectionProxyEnabled === true,
      connectionProxyUrl: proxyCfg.connectionProxyUrl || "",
      connectionNoProxy: proxyCfg.connectionNoProxy || "",
      vercelRelayUrl: proxyCfg.vercelRelayUrl || "",
      strictProxy: false,
    };

    try {
      const r = await runPingForConnection(conn, proxyOptions);
      if (r.skipped) {
        console.log(`[CB_PING] ${conn.displayName || conn.name || conn.id}: skip — ${r.reason}`);
      } else {
        console.log(`[CB_PING] ${conn.displayName || conn.name || conn.id}: ping ok (${r.model})`);
        g.lastTouch[conn.id] = now.getTime();
      }
    } catch (e) {
      g.failureCache[conn.id] = Date.now();
      console.warn(`[CB_PING] ${conn.displayName || conn.name || conn.id}: failed — ${e.message}`);
    }
  }
}

export async function runCodebuddyAutoPingTick() {
  if (g.running) return;
  g.running = true;
  try {
    await processConnections();
  } catch (e) {
    console.warn("[CB_PING] tick error:", e.message);
  } finally {
    g.running = false;
  }
}

export function startCodebuddyAutoPing() {
  if (g.interval) return;
  console.log("[CB_PING] scheduler started");
  g.immediateNextTick = true;
  runCodebuddyAutoPingTick().catch(() => {});
  g.interval = setInterval(() => runCodebuddyAutoPingTick().catch(() => {}), C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}

export function stopCodebuddyAutoPing() {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[CB_PING] scheduler stopped");
}

export async function configureCodebuddyAutoPing(settings) {
  const cfg = settings?.codebuddyIntlAutoPing || {};
  const enabled = cfg.enabled === true || Object.values(cfg.connections || {}).some(Boolean);
  if (enabled) {
    g.immediateNextTick = true;
    startCodebuddyAutoPing();
    if (g.interval) {
      runCodebuddyAutoPingTick().catch(() => {});
    }
  } else {
    stopCodebuddyAutoPing();
  }
}
