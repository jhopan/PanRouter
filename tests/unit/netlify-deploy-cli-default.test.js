// The API deploy path can report "ready" while the relay function was never
// stored (Netlify returns an empty required_functions list on a fresh site, so
// the upload is skipped). The pool then points at a 404 and the user sees
// "deploy failed" / "via Drop" with a dead relay.
//
// Fix: probe the relay after the deploy is ready, re-upload once if it is not
// serving, and report relayOk so the dashboard can tell the user to retry with
// the CLI method — which is now the default.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const apiRoute = read("../src/app/api/proxy-pools/netlify-deploy-api/route.js");
const page = read("../src/app/(dashboard)/dashboard/proxy-pools/page.js");

describe("netlify API deploy — relay verification", () => {
  it("probes the relay after the deploy reports ready", () => {
    expect(apiRoute).toContain("probeRelay");
    expect(apiRoute).toMatch(/probeStatus = await probeRelay\(\)/);
  });

  it("re-uploads the function when the probe fails", () => {
    expect(apiRoute).toMatch(/if \(probeStatus === 404 \|\| probeStatus === 0\)/);
    expect(apiRoute).toContain("uploadFunction()");
  });

  it("reports relay status so the UI can warn", () => {
    expect(apiRoute).toContain("relayStatus: probeStatus");
    expect(apiRoute).toContain("relayOk: probeStatus === 200");
  });

  it("does not create a pool silently pointing at a dead relay", () => {
    // The probe must run before createProxyPool is called.
    const probeIdx = apiRoute.indexOf("probeStatus = await probeRelay()");
    const poolIdx = apiRoute.indexOf("await createProxyPool(");
    expect(probeIdx).toBeGreaterThan(-1);
    expect(poolIdx).toBeGreaterThan(probeIdx);
  });
});

describe("netlify deploy — CLI is the default", () => {
  it("defaults to the CLI deploy method", () => {
    expect(page).toMatch(/deployMode: "cli"/);
  });

  it("lists CLI first and marks it recommended", () => {
    const cliIdx = page.indexOf('value="cli"');
    const apiIdx = page.indexOf('value="api"');
    expect(cliIdx).toBeGreaterThan(-1);
    expect(apiIdx).toBeGreaterThan(-1);
    expect(cliIdx).toBeLessThan(apiIdx);
    expect(page).toContain("recommended");
  });

  it("warns the user when the API relay is not serving", () => {
    expect(page).toContain("data.relayOk === false");
    expect(page).toMatch(/notify\.warning/);
    expect(page).toContain("Coba deploy ulang dengan metode CLI");
  });
});
