/**
 * SQLite binds TEXT as a NUL-terminated C string, so a bound string that
 * contains an embedded NUL cannot survive the round trip:
 *
 *  - better-sqlite3 rejects it outright: "TypeError: String contains null byte"
 *  - node:sqlite accepts it and silently keeps only the prefix before the NUL
 *
 * Telemetry routinely carries values that can contain one — a model id or
 * endpoint taken straight from the request, tool output, a diff. On
 * better-sqlite3 the write aborts (and can take the background flush worker with
 * it); on node:sqlite the tail is lost with no trace at all.
 *
 * Stripping the NUL bytes keeps the text readable and the write alive. JSON
 * columns need no special handling: JSON.stringify escapes control characters,
 * so a serialised payload never carries a literal NUL.
 *
 * Non-string values pass through untouched — numbers, null and undefined are
 * not text, and Buffers / TypedArrays are bound as BLOBs, which have an
 * explicit length and store binary fine.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripNullBytes(value) {
  if (typeof value !== "string") return value;
  if (!value.includes("\0")) return value;
  return value.replace(/\0/g, "");
}
