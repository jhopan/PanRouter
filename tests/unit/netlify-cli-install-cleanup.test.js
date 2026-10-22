// A killed netlify-cli install (OOM, 10-minute timeout, Ctrl-C) leaves a partial
// node_modules tree plus a .package-lock.json that disagrees with disk. The next
// `npm install --prefix` then fails in confusing ways, so the deploy route now
// wipes the debris before reinstalling and again after a failure.
import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const route = read("../src/app/api/proxy-pools/netlify-deploy/route.js");
const statusRoute = read("../src/app/api/proxy-pools/netlify-cli-status/route.js");
const page = read("../src/app/(dashboard)/dashboard/proxy-pools/page.js");

describe("netlify-cli install cleanup", () => {
  it("defines a cleanup helper that removes the whole runtime dir", () => {
    expect(route).toContain("function cleanupFailedInstall");
    expect(route).toMatch(/fs\.rmSync\(lazyDir, \{ recursive: true, force: true/);
  });

  it("cleanup is best-effort and never throws", () => {
    const fn = route.slice(route.indexOf("function cleanupFailedInstall"));
    const body = fn.slice(0, 500);
    expect(body).toContain("try {");
    expect(body).toContain("catch {");
  });

  it("wipes stale debris BEFORE installing", () => {
    // The pre-install cleanup must appear before the spawn() call.
    const cleanupIdx = route.indexOf("Membersihkan sisa instalasi");
    const spawnIdx = route.indexOf('spawn(npmCmd, ["install"');
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(-1);
    expect(cleanupIdx).toBeLessThan(spawnIdx);
  });

  it("wipes debris AFTER a failed install", () => {
    const catchIdx = route.indexOf("Install netlify-cli gagal:");
    const cleanupCall = route.indexOf("const cleaned = cleanupFailedInstall(lazyDir)");
    expect(cleanupCall).toBeGreaterThan(-1);
    expect(cleanupCall).toBeLessThan(catchIdx);
  });

  it("treats a missing binary as failure even when npm exits 0", () => {
    expect(route).toContain("function hasUsableLazyInstall");
    expect(route).toMatch(/fs\.statSync\(lazyRun\)\.size > 0/);
    // and cleans up in that branch too
    const branch = route.slice(route.indexOf("npm can exit 0"));
    expect(branch.slice(0, 400)).toContain("cleanupFailedInstall");
  });

  it("tells the user the debris was removed", () => {
    expect(route).toContain("Sisa instalasi sudah dibersihkan");
  });
});

describe("netlify-cli status — stale install reporting", () => {
  it("reports staleInstall when the runtime dir exists without a binary", () => {
    expect(statusRoute).toContain("staleInstall");
  });

  it("the dashboard surfaces that to the user", () => {
    expect(page).toContain("netlifyCli.staleInstall");
    expect(page).toContain("sisa instalasi sebelumnya yang gagal");
  });
});
