// Netlify relay: two deploy paths, two relay-function variants.
//
//   Deploy  "api" — Netlify REST API + hand-built stored ZIP (zero deps, ~5s)
//           "cli" — spawn netlify-cli (installs ~1200 packages on first run)
//   Relay   "upstream"  — 9router: buffers the response, no guards
//           "panrouter" — adds CORS preflight, SSRF guard, 9s timeout
//
// Both create a proxy pool with type:"netlify", which is what the request path
// keys on to pick relay mode over HTTP-proxy mode.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { inflateRawSync } from "zlib";
import {
  NETLIFY_API,
  NETLIFY_FUNCTION_NAME,
  NETLIFY_FUNCTION_PATH,
  NETLIFY_RELAY_FUNCTION_CODE,
  NETLIFY_RELAY_STREAM_FUNCTION_CODE,
  buildStoredZip,
  buildRelayFunctionZip,
  buildIndexFile,
  buildRelayUrl,
  crc32,
  sha1Hex,
  sha256Hex,
} from "../../src/lib/network/netlifyRelay.js";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

/** Minimal ZIP reader for a single stored (uncompressed) entry. */
function readStoredZip(buf) {
  const sig = buf.readUInt32LE(0);
  expect(sig).toBe(0x04034b50);
  const method = buf.readUInt16LE(8);
  const crc = buf.readUInt32LE(14);
  const size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.subarray(30, 30 + nameLen).toString("utf8");
  const dataStart = 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + size);
  return { method, crc, size, name, data };
}

describe("netlifyRelay — ZIP builder", () => {
  it("writes a valid stored (uncompressed) entry", () => {
    const content = "exports.handler = async () => {};";
    const zip = buildStoredZip([{ name: "relay.js", data: content }]);
    const entry = readStoredZip(zip);
    expect(entry.method).toBe(0); // stored, no compression
    expect(entry.name).toBe("relay.js");
    expect(entry.data.toString("utf8")).toBe(content);
    expect(entry.crc).toBe(crc32(new TextEncoder().encode(content)));
  });

  it("ends with a valid end-of-central-directory record", () => {
    const zip = buildStoredZip([{ name: "a.js", data: "x" }]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 8)).toBe(1); // entries on disk
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(1); // entries total
  });

  it("produces the relay bundle Netlify expects (relay.js, runtime=js)", () => {
    const { zip, sha256 } = buildRelayFunctionZip("upstream");
    const entry = readStoredZip(zip);
    expect(entry.name).toBe(`${NETLIFY_FUNCTION_NAME}.js`);
    expect(entry.size).toBe(new TextEncoder().encode(NETLIFY_RELAY_FUNCTION_CODE).length);
    expect(sha256).toBe(sha256Hex(zip));
  });
});

describe("netlifyRelay — variants", () => {
  it("upstream variant buffers the body (documented Lambda constraint)", () => {
    expect(NETLIFY_RELAY_FUNCTION_CODE).toContain("arrayBuffer()");
    expect(NETLIFY_RELAY_FUNCTION_CODE).toContain("isBase64Encoded");
    // Upstream ships no SSRF guard and no CORS handling.
    expect(NETLIFY_RELAY_FUNCTION_CODE).not.toContain("access-control-allow-origin");
    expect(NETLIFY_RELAY_FUNCTION_CODE).not.toContain("Target not allowed");
  });

  it("panrouter variant adds CORS preflight", () => {
    expect(NETLIFY_RELAY_STREAM_FUNCTION_CODE).toContain("OPTIONS");
    expect(NETLIFY_RELAY_STREAM_FUNCTION_CODE).toContain("access-control-allow-origin");
  });

  it("panrouter variant refuses loopback / private / metadata targets", () => {
    const code = NETLIFY_RELAY_STREAM_FUNCTION_CODE;
    expect(code).toContain("169.254.");
    expect(code).toContain("127.");
    expect(code).toContain("192.168.");
    expect(code).toContain("Target not allowed");
  });

  it("panrouter variant sets an explicit upstream timeout", () => {
    expect(NETLIFY_RELAY_STREAM_FUNCTION_CODE).toContain("AbortSignal.timeout(9000)");
  });

  it("both variants strip the relay headers before forwarding", () => {
    for (const code of [NETLIFY_RELAY_FUNCTION_CODE, NETLIFY_RELAY_STREAM_FUNCTION_CODE]) {
      expect(code).toContain("x-relay-target");
      expect(code).toContain("x-relay-path");
    }
  });

  it("picks the right bundle per variant", () => {
    const up = buildRelayFunctionZip("upstream");
    const pr = buildRelayFunctionZip("panrouter");
    expect(up.sha256).not.toBe(pr.sha256);
    expect(readStoredZip(up.zip).data.toString()).toContain("arrayBuffer()");
    expect(readStoredZip(pr.zip).data.toString()).toContain("Target not allowed");
  });
});

describe("netlifyRelay — plumbing", () => {
  it("builds the function URL on the site origin", () => {
    expect(buildRelayUrl("https://x.netlify.app")).toBe(`https://x.netlify.app${NETLIFY_FUNCTION_PATH}`);
    expect(buildRelayUrl("https://x.netlify.app/")).toBe(`https://x.netlify.app${NETLIFY_FUNCTION_PATH}`);
    expect(NETLIFY_API).toBe("https://api.netlify.com/api/v1");
  });

  it("hashes index.html with SHA1 (Netlify file digests)", () => {
    const { content, sha1 } = buildIndexFile();
    expect(sha1).toBe(sha1Hex(content));
    expect(sha1).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("deploy routes are separate", () => {
  it("API route uses the Netlify REST API, not a subprocess", () => {
    const api = read("../src/app/api/proxy-pools/netlify-deploy-api/route.js");
    expect(api).toContain("netlifyRelay.js");
    expect(api).toContain("pollDeployReady");
    expect(api).not.toContain("child_process");
    expect(api).not.toContain("spawn(");
  });

  it("CLI route still exists and still spawns netlify-cli", () => {
    const cli = read("../src/app/api/proxy-pools/netlify-deploy/route.js");
    expect(cli).toContain("spawn");
    expect(cli).toContain("netlify-cli");
  });

  it("both create a type:netlify pool so the request path picks relay mode", () => {
    const api = read("../src/app/api/proxy-pools/netlify-deploy-api/route.js");
    expect(api).toMatch(/type:\s*"netlify"/);
    const cli = read("../src/app/api/proxy-pools/netlify-deploy/route.js");
    expect(cli).toMatch(/type:\s*"netlify"/);
  });
});
