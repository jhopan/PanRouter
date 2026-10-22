// Netlify deploy is CLI-only.
//
// The REST-API path was removed: it kept producing a pool that pointed at a
// relay Netlify never actually stored (empty required_functions on a fresh
// site), so the deploy looked successful but the relay was a 404. The CLI path
// is the only one that reliably lands a working function.
//
// Before Deploy is clicked the dashboard now checks whether netlify-cli is
// installed, so a missing CLI is surfaced immediately with the manual command
// and a link to the official install guide.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const page = read("../src/app/(dashboard)/dashboard/proxy-pools/page.js");
const statusRoute = read("../src/app/api/proxy-pools/netlify-cli-status/route.js");

describe("netlify deploy — CLI only", () => {
  it("no longer exposes the REST-API deploy route", () => {
    const apiDir = path.resolve("../src/app/api/proxy-pools/netlify-deploy-api");
    expect(fs.existsSync(apiDir)).toBe(false);
  });

  it("no longer ships the API relay helper", () => {
    expect(fs.existsSync(path.resolve("../src/lib/network/netlifyRelay.js"))).toBe(false);
  });

  it("the dashboard has no deploy-method switch or API references", () => {
    expect(page).not.toContain("deployMode");
    expect(page).not.toContain("netlify-deploy-api");
  });

  it("the CLI deploy route still exists", () => {
    expect(fs.existsSync(path.resolve("../src/app/api/proxy-pools/netlify-deploy/route.js"))).toBe(true);
  });
});

describe("netlify-cli pre-flight check", () => {
  it("exposes a status endpoint", () => {
    expect(statusRoute).toContain("export async function GET");
  });

  it("looks in every location the deploy route uses", () => {
    expect(statusRoute).toContain("netlify-cli/bin/run.js");
    expect(statusRoute).toContain("runtime");
    expect(statusRoute).toContain("netlify.cmd");
  });

  it("returns the manual install command when missing", () => {
    expect(statusRoute).toContain("npm i -g netlify-cli");
    expect(statusRoute).toContain("available: false");
  });

  it("links to the official install guide", () => {
    expect(statusRoute).toContain("installUrl");
    expect(statusRoute).toContain("docs.netlify.com");
  });

  it("the modal fetches the status when it opens", () => {
    expect(page).toContain("/api/proxy-pools/netlify-cli-status");
    expect(page).toContain("setNetlifyCli");
  });

  it("shows three states: checking, installed, missing", () => {
    expect(page).toContain("Memeriksa netlify-cli");
    expect(page).toContain("netlify-cli terpasang");
    expect(page).toContain("netlify-cli belum terpasang");
  });

  it("offers copy + install-guide actions when missing", () => {
    expect(page).toContain("Salin");
    expect(page).toContain("Panduan install");
  });
});
