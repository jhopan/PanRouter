// Three fixes surfaced while testing the API deploy path:
//
//  1. "Salin Link Pengaturan" copied `undefined` — the route returned only
//     deployUrl while the modal reads accessUrl/siteName.
//  2. "Site name is taken" aborted the deploy — Netlify answers 422 for a
//     duplicate name; it now retries with a random suffix.
//  3. Proxy "Test" reported failed on a healthy relay — it probed httpbin.org
//     (slow/flaky) with a 10s cap. Now api.ipify.org with 20s.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const apiRoute = read("../src/app/api/proxy-pools/netlify-deploy-api/route.js");
const testRouteRaw = read("../src/app/api/proxy-pools/[id]/test/route.js");
// Strip comments: the code explains WHY httpbin was dropped, and that prose
// must not satisfy a "does the code still call it" assertion.
const testRoute = testRouteRaw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const page = read("../src/app/(dashboard)/dashboard/proxy-pools/page.js");

describe("netlify API deploy — response shape", () => {
  it("returns accessUrl so the settings-link copy is not undefined", () => {
    expect(apiRoute).toContain("accessUrl:");
    expect(apiRoute).toMatch(/app\.netlify\.com\/projects\/\$\{usedName\}\/overview/);
  });

  it("returns siteName and adminUrl too", () => {
    expect(apiRoute).toContain("siteName: usedName");
    expect(apiRoute).toContain("adminUrl:");
  });

  it("the modal receives every field it renders", () => {
    expect(page).toContain("accessUrl: data.accessUrl");
    expect(page).toContain("siteName: data.siteName");
    expect(page).toContain("adminUrl: data.adminUrl");
  });
});

describe("netlify API deploy — taken site name", () => {
  it("retries with a unique suffix on 422", () => {
    expect(apiRoute).toContain("withUniqueSuffix");
    expect(apiRoute).toMatch(/res\.status === 422/);
  });

  it("does NOT retry on auth/server errors", () => {
    // Only a name collision (422) is retryable.
    expect(apiRoute).toMatch(/for \(let i = 0; i < 3 && !created && res\.status === 422/);
  });

  it("uses the generated name for the pool and the URLs", () => {
    expect(apiRoute).toContain("name: usedName");
  });
});

describe("proxy pool test — reliable probe", () => {
  it("no longer probes httpbin.org", () => {
    expect(testRoute).not.toContain("httpbin.org");
  });

  it("probes a fast, reliable endpoint", () => {
    expect(testRoute).toContain("api.ipify.org");
  });

  it("allows enough time for a digest-deployed relay", () => {
    expect(testRoute).toMatch(/timeoutMs = 20000/);
  });

  it("reports the actual timeout in the error message", () => {
    expect(testRoute).toContain("Relay test timed out after");
  });
});

describe("netlify relay — deploy provenance", () => {
  it("uploads an index.html so the site is not an empty 'Netlify Drop'", () => {
    // A digest deploy with no index.html shows "Last deployed from Netlify
    // Drop" in the Netlify UI and serves a directory listing.
    expect(apiRoute).toContain('"/index.html": sha1');
  });
});
