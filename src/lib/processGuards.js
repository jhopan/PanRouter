/**
 * Process-level safety net for the standalone server.
 *
 * Why this exists: the CLI spawns the server as a child process and treats any
 * non-zero exit as a crash — it restarts the server and dumps the whole stderr
 * tail as a "crash log". Without a process-level handler, a SINGLE dropped
 * client connection terminates the whole router:
 *
 *   Error: aborted
 *       at abortIncoming (node:_http_server:796:17)
 *       at socketOnClose (node:_http_server:790:3)
 *       at Socket.emit (node:events:536:35)
 *
 * `abortIncoming` is Node's internal path for "the client closed the socket
 * while the request body was still arriving". Browsers do this constantly
 * (navigation away, tab close, aborted fetch, SSE stream cancelled), and so do
 * clients that hit a timeout. It is normal traffic, not a defect in the router.
 *
 * Policy:
 *   - Benign socket/abort errors are logged once (deduped) and swallowed.
 *   - Anything else is logged with its stack so it is still diagnosable, and the
 *     process keeps running. A router that dies on an unhandled promise is worse
 *     than one that logs and continues: every other in-flight request dies too.
 *
 * This is deliberately fail-open. Do NOT turn it into a rethrow.
 */

// Error codes that mean "the other side went away", not "the server is broken".
const BENIGN_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
  "ERR_HTTP_HEADERS_SENT",
  "ERR_HTTP_INVALID_HEADER_VALUE",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "ABORT_ERR",
]);

// Message/stack fragments from Node's HTTP internals for the same situation.
// `abortIncoming` / `socketOnClose` are the exact frames seen in the field.
const BENIGN_PATTERNS = [
  /abortIncoming/i,
  /socketOnClose/i,
  /\bError: aborted\b/i,
  /aborted by the client/i,
  /request aborted/i,
  /premature close/i,
  /socket hang up/i,
  /write after end/i,
  /headers already sent/i,
  /cancell?ed/i,
  /The operation was aborted/i,
  /BodyStreamBuffer was aborted/i,
  /Cannot enqueue (?:Query|Bind|Execute) after invoking quit/i,
];

/**
 * Is this error just a disconnected client / aborted stream?
 * @param {unknown} err
 * @returns {boolean}
 */
export function isBenignDisconnect(err) {
  if (!err) return false;
  const code = typeof err === "object" ? String(err.code || "") : "";
  if (code && BENIGN_CODES.has(code)) return true;

  const text = [
    typeof err === "string" ? err : "",
    typeof err === "object" ? String(err.message || "") : "",
    typeof err === "object" ? String(err.stack || "") : "",
  ].join(" ");

  if (!text) return false;
  return BENIGN_PATTERNS.some((re) => re.test(text));
}

/** Dedupe so a burst of 200 aborted sockets prints one line, not 200. */
function makeDeduper(windowMs = 60_000) {
  const seen = new Map();
  return (key) => {
    const now = Date.now();
    const last = seen.get(key) || 0;
    if (now - last < windowMs) return false;
    seen.set(key, now);
    // Bound the map: a pathological client could send endless distinct keys.
    if (seen.size > 200) {
      for (const [k, t] of seen) if (now - t >= windowMs) seen.delete(k);
    }
    return true;
  };
}

let installed = false;

/**
 * Install the guards. Idempotent — safe to call from instrumentation and from
 * tests. Returns an uninstall function for test isolation.
 */
export function installProcessGuards({ logger = console } = {}) {
  if (installed) return () => {};
  installed = true;

  const shouldLog = makeDeduper();
  const benignSeen = new Set();

  const describe = (err) => {
    if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`;
    if (typeof err === "object" && err) return JSON.stringify(err).slice(0, 500);
    return String(err);
  };

  const onRejection = (reason) => {
    if (isBenignDisconnect(reason)) {
      const code = (reason && reason.code) || "aborted";
      if (shouldLog(`rej:${code}`)) {
        logger.warn?.(`[GUARD] ignored client disconnect (unhandledRejection: ${code})`);
      }
      return;
    }
    // Not a disconnect: still keep the process alive, but make it visible.
    logger.error?.(`[GUARD] unhandledRejection kept server alive:\n${describe(reason)}`);
  };

  const onException = (err) => {
    if (isBenignDisconnect(err)) {
      const code = (err && err.code) || "aborted";
      if (shouldLog(`exc:${code}`)) {
        logger.warn?.(`[GUARD] ignored client disconnect (uncaughtException: ${code})`);
      }
      return;
    }
    // Keeping the process up is intentional: the alternative is killing every
    // in-flight request over one failure. The stack is logged for diagnosis.
    logger.error?.(`[GUARD] uncaughtException kept server alive:\n${describe(err)}`);
  };

  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);

  return () => {
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
    installed = false;
    benignSeen.clear();
  };
}
