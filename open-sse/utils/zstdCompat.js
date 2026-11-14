import zlib from "node:zlib";

// undici only wires a zstd decoder when zlib exposes `createZstdDecompress`, an
// export that arrived in Node 22.15. Advertising zstd on an older runtime hands
// back a body undici cannot inflate: `text()` returns raw compressed bytes, so
// JSON.parse fails and SSE frames never parse. That failure is silent — there is
// no throw, just a response that never resolves into anything readable.
//
// Derive the header from the runtime instead of hardcoding it at each call site,
// so a deployment on Node 20.x keeps working when an upstream honours the coding.
export const ACCEPT_ENCODING = typeof zlib.createZstdDecompress === "function"
  ? "gzip, deflate, br, zstd"
  : "gzip, deflate, br";

/** True when this Node runtime can inflate a zstd body. */
export function supportsZstd() {
  return typeof zlib.createZstdDecompress === "function";
}
