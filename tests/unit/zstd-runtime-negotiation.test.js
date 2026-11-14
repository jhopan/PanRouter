import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import zlib from "node:zlib";
import { ACCEPT_ENCODING, supportsZstd } from "../../open-sse/utils/zstdCompat.js";

const REPO = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".next", ".next-cli-build", "coverage"].includes(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("Accept-Encoding is derived from what the runtime can decode", () => {
  it("reports the runtime's zstd capability honestly", () => {
    expect(typeof supportsZstd()).toBe("boolean");
    expect(supportsZstd()).toBe(typeof zlib.createZstdDecompress === "function");
  });

  it("advertises zstd only when the decoder exists", () => {
    // Node < 22.15 has no createZstdDecompress. undici leaves its zstd decoder
    // unwired there, so an upstream that honours the coding returns raw
    // compressed bytes: JSON.parse fails, SSE frames never parse, and nothing
    // throws. The header has to follow the runtime, not a constant.
    expect(ACCEPT_ENCODING).toBe(supportsZstd() ? "gzip, deflate, br, zstd" : "gzip, deflate, br");
  });

  it("never advertises a coding the runtime cannot inflate", () => {
    if (!supportsZstd()) {
      expect(ACCEPT_ENCODING).not.toContain("zstd");
    } else {
      expect(ACCEPT_ENCODING).toContain("zstd");
    }
  });

  it("is the only place that names zstd in an Accept-Encoding value", () => {
    // Guard against a future call site re-hardcoding the literal. This is the
    // bug the module exists to prevent: the header lived in three files and
    // each one had to be found and fixed by hand.
    const offenders = [];
    for (const file of walk(join(REPO, "open-sse")).concat(walk(join(REPO, "src")))) {
      if (file.endsWith("zstdCompat.js")) continue;
      const text = readFileSync(file, "utf8");
      if (/Accept-Encoding["']?\s*:\s*["'][^"']*zstd/i.test(text)) {
        offenders.push(relative(REPO, file));
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000); // walks every .js in open-sse/ and src/ — can exceed the 5s default under parallel load
});
