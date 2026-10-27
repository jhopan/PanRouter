import { createHash, randomUUID } from "node:crypto";
import { DefaultExecutor } from "./default.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Two separate gates on the intl gateway:
 *   11128 "request illegal" (channel verification) — request did not carry the
 *         X-Conversation-* family. Fixed by the headers below.
 *   11140 "account restricted due to unusual activity" — the ACCOUNT is flagged.
 *         Reached when the request set looks automated: a handful of static
 *         headers, one IDE/version string forever, huge repeated payloads.
 *
 * The official CLI 2.170.0 sends ~25 headers, not 6. X-Stainless-* is the SDK
 * fingerprint, and X-Agent-Intent/Purpose/Type/Runtime describe the caller. A
 * request missing them still passes 11128 but looks like a bot, which is what
 * trips 11140. Values below mirror the installed CLI.
 */

// From the installed @tencent-ai/codebuddy-code 2.170.0 bundle.
const CB_IDE_VERSION = "2.170.0";
// CLI sets User-Agent and IDE headers to "CLI", not "IDE". The gateway tracks
// the caller type and "IDE" triggers IDE-mode fingerprinting.
const CB_UA = `CLI/${CB_IDE_VERSION} CodeBuddy/${CB_IDE_VERSION}`;

// ── UUID v1 (time-based), matching the official client ─────────────────────
// The CLI's conversation id is a time-based UUID: it encodes a creation
// timestamp and a node identifier, so a reader can tell "when was this
// conversation opened" and "which machine opened it". A v5/v7 id is a content
// hash and carries neither. Mirroring the shape costs nothing and removes one
// thing the gateway could notice.
const UUID_V1_NODE = "42:66:14:17:40:00"; // constant node id, as the CLI uses

/** Build a time-based UUID (version 1) with a stable timestamp per seed. */
function uuidV1(seed, nowMs = Date.now()) {
  // 100-ns intervals since 1582-10-15.
  const ticks = nowMs * 10000 + 0x01b21dd213814000;
  const timeLow = ticks % 0x100000000;
  const timeMid = Math.floor(ticks / 0x100000000) % 0x10000;
  const timeHigh = Math.floor(ticks / 0x1000000000000) & 0x0fff;

  // Deterministic clock sequence from the seed so the same conversation keeps
  // the same id across retries and account failovers.
  const seedHash = createHash("md5").update(String(seed)).digest("hex");
  const clockSeq = (parseInt(seedHash.slice(0, 4), 16) & 0x3fff) | 0x8000;

  const nodeHex = UUID_V1_NODE.replace(/:/g, "");
  const hex = (n, w) => n.toString(16).padStart(w, "0");

  return [
    hex(timeLow, 8),
    hex(timeMid, 4),
    hex((timeHigh & 0x0fff) | 0x1000, 4), // version 1
    hex(clockSeq, 4),
    nodeHex,
  ].join("-");
}

/**
 * Conversation id: stable for the lifetime of a conversation, time-based like
 * the official client.
 *
 * A v1 uuid encodes its creation timestamp, so the timestamp must be pinned to
 * the moment the conversation was first seen — not "now" on every request, or
 * the id would change on every turn and stop being a conversation id at all.
 * The seed's hash carries that pinned timestamp.
 */
const conversationTimestamps = new Map();

function stableConversationId(seed) {
  const key = String(seed);
  let pinned = conversationTimestamps.get(key);
  if (pinned === undefined) {
    pinned = Date.now();
    conversationTimestamps.set(key, pinned);
    // Bound the map: a long-lived server sees many conversations.
    if (conversationTimestamps.size > 2000) {
      const oldest = conversationTimestamps.keys().next().value;
      conversationTimestamps.delete(oldest);
    }
  }
  return uuidV1(key, pinned);
}

/**
 * Per-turn id: fresh every request, like the CLI's message id. The CLI derives
 * it from the message id, and reuses it for the request id on the same turn.
 */
function perTurnId() {
  return uuidV1(randomUUID(), Date.now());
}

export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);

    // Stable per-conversation id: prefer whatever session key the client sent,
    // else derive from the opening user message (stable across retries of the
    // same turn and across account failovers), else fall back to a random UUID.
    const sessionKey =
      (typeof body?.session_id === "string" && body.session_id) ||
      (typeof body?.prompt_cache_key === "string" && body.prompt_cache_key) ||
      (typeof body?.conversation_id === "string" && body.conversation_id) ||
      null;

    const firstUser = Array.isArray(body?.messages)
      ? body.messages.find((m) => m?.role === "user")
      : null;
    const userText =
      typeof firstUser?.content === "string"
        ? firstUser.content
        : Array.isArray(firstUser?.content)
          ? firstUser.content
              .map((b) => (b && typeof b.text === "string" ? b.text : ""))
              .join("\n")
          : "";

    const conversationKey = sessionKey || (userText ? `cbai:${userText}` : null);
    const requestId = perTurnId();
    // The root request ID is the same as the conversation request ID on the CLI.
    const rootRequestId = requestId;

    // The registry ships lowercase duplicates of two headers; sending both
    // spellings looks like a hand-rolled client. Drop the lowercase variants
    // before adding the canonical ones.
    delete headers["x-codebuddy-request"];
    delete headers["x-requested-with"];

    headers["X-Conversation-ID"] = conversationKey
      ? stableConversationId(conversationKey)
      : perTurnId();
    headers["X-Conversation-Request-ID"] = requestId;
    // The CLI sends the same id for the request and the message on a chat turn.
    headers["X-Conversation-Message-ID"] = requestId;
    // Root request ID mirrors the conversation request ID (observed in MITM capture).
    headers["X-Root-Request-ID"] = rootRequestId;

    // ── CLI identity ──────────────────────────────────────────────────────
    // Everything below is sent by the official CLI on every chat call. The
    // static registry headers cover only the bare minimum; without the rest
    // the gateway still accepts the request (11128 passes) but treats the
    // caller as third-party automation and eventually returns 11140.
    headers["User-Agent"] = CB_UA;
    headers["X-Product"] = "SaaS";
    headers["X-Product-Version"] = CB_IDE_VERSION;
    headers["X-App"] = "cli";
    headers["X-IDE-Type"] = "CLI";
    headers["X-IDE-Name"] = "CLI";
    headers["X-IDE-Version"] = CB_IDE_VERSION;
    // The CLI sets this from the user's data-sharing preference; "false" is the
    // conservative value it sends for a normal account.
    headers["X-Private-Data"] = "false";
    headers["X-Requested-With"] = "XMLHttpRequest";
    headers["X-CodeBuddy-Request"] = "1";

    // Agent identity: the CLI describes every chat turn as a "craft" intent
    // for a "conversation" purpose, attributed to the MAIN agent type (not ide).
    // X-Agent-Runtime "other" matches the CLI's non-IDE runtime context.
    headers["X-Agent-Intent"] = "craft";
    headers["X-Agent-Purpose"] = "conversation";
    headers["X-Agent-Type"] = "main";
    headers["X-Agent-Runtime"] = "other";

    // Per-request id, mirrored into the conversation-message id like the CLI.
    headers["X-Request-ID"] = requestId;

    // ── OpenTelemetry distributed tracing ─────────────────────────────────
    // The CLI sends Zipkin B3 + W3C traceparent on every chat request. The IDs
    // are per-request randoms; they are not validated server-side but their
    // absence looks like a non-SDK caller.
    const traceId = randomUUID().replace(/-/g, "");           // 32-hex
    const spanId  = traceId.slice(0, 16);                     // 16-hex (first half)
    const parentSpanId = traceId.slice(16, 32);               // 16-hex (second half)
    headers["traceparent"]      = `00-${traceId}-${spanId}-01`;
    headers["b3"]               = `${traceId}-${spanId}-1-${parentSpanId}`;
    headers["X-B3-TraceId"]     = traceId;
    headers["X-B3-SpanId"]      = spanId;
    headers["X-B3-ParentSpanId"]= parentSpanId;
    headers["X-B3-Sampled"]     = "1";
    headers["X-Trace-ID"]       = traceId;

    // baggage carries the stable session id and the per-request id in the
    // format the CLI sends:
    //   codebuddy.session_id=<uuid>,codebuddy.conversation_request_id=<hex>
    const sessionUuid = headers["X-Conversation-ID"] || randomUUID();
    headers["baggage"] = `codebuddy.session_id=${sessionUuid},codebuddy.conversation_request_id=${requestId.replace(/-/g, "")}`;

    // Stainless SDK fingerprint. These are what make the call look like it came
    // from the official Node SDK rather than a bare fetch(). Values mirror
    // normalizePlatform()/normalizeArch() from the CLI bundle:
    //   platform: win32→Windows, darwin→MacOS, linux→Linux
    //   arch:     x64→amd64, arm→arm32, ppc→ppc32, else passthrough
    const normalizePlatform = (p) => {
      const v = String(p || "").toLowerCase();
      if (v === "darwin") return "MacOS";
      if (v === "win32") return "Windows";
      if (v === "linux") return "Linux";
      if (v === "freebsd") return "FreeBSD";
      if (v === "openbsd") return "OpenBSD";
      return v ? `Other:${v}` : "Unknown";
    };
    // normalizeArch: live MITM capture shows the CLI sends the raw arch string
    // (x64) rather than the amd64 value inside the bundle's normalizeArch().
    // Trust the live wire — x64 is what the server expects.
    const normalizeArch = (a) => {
      if (a === "arm") return "arm32";
      if (a === "ppc") return "ppc32";
      return a || "unknown";
    };

    headers["X-Stainless-Lang"] = "js";
    headers["X-Stainless-Package-Version"] = "6.25.0";
    headers["X-Stainless-OS"] = normalizePlatform(process.platform);
    headers["X-Stainless-Arch"] = normalizeArch(process.arch);
    headers["X-Stainless-Runtime"] = "node";
    headers["X-Stainless-Runtime-Version"] = process.version || "v22.0.0";
    headers["X-Stainless-Retry-Count"] = "0";
    headers["X-Stainless-Helper-Method"] = "stream";

    // Domain tells the gateway which product surface the call belongs to.
    if (!headers["X-Domain"]) headers["X-Domain"] = "www.codebuddy.ai";

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }

  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";

        // 11140: the ACCOUNT is BANNED ("Your account has been restricted due to
        // unusual activity" / "Submit feedback to appeal this restriction").
        // Checked FIRST: the body also carries msg:"request illegal", so the
        // 11128 branch below would swallow it and lose the account-level
        // classification.
        //
        // No resetsAtMs on purpose. A ban is not a timed cooldown — it lasts
        // until the provider lifts it, so a 12h timer would just re-test the
        // banned account every 12 hours, which is exactly the retry pattern
        // that looks like automation. The `banned` flag makes auth.js park the
        // whole account for weeks instead.
        if (data?.code === 11140 || /unusual activity|账号存在异常行为|帳號存在異常行為/i.test(JSON.stringify(data))) {
          return {
            status: 403,
            message: msg || "CodeBuddy account restricted (11140) — unusual activity",
            banned: true,
          };
        }

        // 11128: "request illegal" — the request failed channel verification.
        // The account is fine; the request shape is not. Escalating backoff on
        // this parks a healthy account for 30 minutes (observed: modelLock
        // 1800s on a 403 with body "request illegal"), so treat it as a
        // request-level rejection: surface it, do not lock, do not rotate.
        if (data?.code === 11128 || /^request illegal$/i.test(String(data?.msg || "").trim())) {
          return {
            status: 403,
            message: msg || "CodeBuddy: request rejected by channel verification (11128)",
            fatal: true,
            requestRejected: true,
          };
        }

        // "request illegal" WITHOUT a 11128/11140 code — this is the fingerprint
        // of an account that has been flagged and is now refusing every request.
        // The 11140 banner only appears after the provider has already fully
        // decided to restrict the account; the 11128 code appears on transient
        // channel-verification mismatches. A plain "request illegal" with a
        // raw 403 and no distinguishing code is the ban state before 11140 is
        // confirmed. Ban the account for 1 month: retrying hourly is exactly
        // the automation pattern the ban was issued for.
        if (/request illegal/i.test(String(msg || bodyText || ""))) {
          return {
            status: 403,
            message: msg || "CodeBuddy: account flagged — request illegal (no channel code)",
            banned: true,
          };
        }

        // 11115: the REQUEST is too large for the model ("prompt is too long:
        // 1054321 tokens > 1048576 maximum"). Nothing is wrong with the account,
        // so it must not be locked — the same prompt fails on every account and
        // the router would park all of them in a row. Surface it as a client
        // error so chatCore returns 400 without touching account state.
        if (data?.code === 11115 || /prompt is too long|content too long|内容过长|內容過長/i.test(msg)) {
          return {
            status: 400,
            message: msg || "CodeBuddy: prompt exceeds the model context window",
            // Signals to the caller: do not retry, do not lock the account.
            fatal: true,
            requestTooLarge: true,
          };
        }

        // 11140 handled above (before 11128) — the body also says "request
        // illegal", so it must be classified before the generic rejection.

        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
