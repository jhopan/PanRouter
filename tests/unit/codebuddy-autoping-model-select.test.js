// The daily CodeBuddy auto-ping model is user-selectable: ONE global choice in
// the Auto-ping settings that applies to every enabled account, falling back to
// the built-in default.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const service = read("../src/shared/services/codebuddyAutoPing.js");
const page = read("../src/app/(dashboard)/dashboard/providers/[id]/page.js");

describe("CodeBuddy auto-ping model selection (UI)", () => {
  it("reads the global model from settings", () => {
    expect(service).toContain("cfg.model");
    expect(service).toContain("runPingForConnection(conn, proxyOptions, cfg.model || null)");
  });

  it("uses ONE global model for every account (no per-connection pin)", () => {
    // The user asked for a single setting that applies to all accounts.
    expect(service).not.toContain("conn.autoPingModel");
    expect(service).toMatch(/const preferred = typeof modelOverride === "string"/);
  });

  it("keeps the fallback chain after the chosen model", () => {
    expect(service).toMatch(/preferred \|\| C\.pingModel \|\| "fast-model"/);
    expect(service).toContain("pingModelFallbacks");
  });

  it("exposes a model dropdown in the provider page", () => {
    expect(page).toContain("autoPing.model");
    expect(page).toContain("Auto-ping: default (fast-model)");
    expect(page).toContain('saveAutoPing({ ...autoPing, model: e.target.value })');
  });

  it("persists model in the autoPing state shape", () => {
    expect(page).toContain('useState({ enabled: false, connections: {}, model: "" })');
    expect(page).toContain("model: apCfg.model || \"\"");
  });

  it("only shows the dropdown for providers that support auto-ping", () => {
    expect(page).toContain("AUTO_PING_SETTINGS_KEYS[providerId] && (");
  });
});
