import { describe, it, expect } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Antigravity dashboard normalization with weekly quotas", () => {
  const data = {
    quotas: {
      "gemini-pro-agent": {
        displayName: "Gemini 3.1 Pro (High)",
        used: 200,
        total: 1000,
        resetAt: "2026-09-08T00:00:00Z",
        remainingPercentage: 80,
      },
      "claude-opus-4-6-thinking": {
        displayName: "Claude Opus 4.6 (Thinking)",
        used: 100,
        total: 1000,
        resetAt: "2026-09-08T00:00:00Z",
        remainingPercentage: 90,
      },
      gemini_weekly: {
        displayName: "Gemini (Weekly)",
        used: 250,
        total: 1000,
        resetAt: "2026-09-15T00:00:00Z",
        remainingPercentage: 75,
      },
      claude_gpt_weekly: {
        displayName: "Claude & GPT (Weekly)",
        used: 500,
        total: 1000,
        resetAt: "2026-09-14T00:00:00Z",
        remainingPercentage: 50,
      },
    },
  };

  it("includes weekly rows with correct display names", () => {
    const quotas = parseQuotaData("antigravity", data);
    const names = quotas.map((q) => q.name);

    expect(names).toContain("Gemini (Flash / Pro)");
    expect(names).toContain("Claude (Sonnet / Opus)");
    expect(names).toContain("Gemini (Weekly)");
    expect(names).toContain("Claude & GPT (Weekly)");
  });

  it("uses stable modelKey for weekly rows", () => {
    const quotas = parseQuotaData("antigravity", data);
    const keys = quotas.map((q) => q.modelKey);

    expect(keys).toContain("gemini_weekly");
    expect(keys).toContain("claude_gpt_weekly");
  });

  it("weekly rows carry correct quota values", () => {
    const quotas = parseQuotaData("antigravity", data);
    const geminiWeekly = quotas.find((q) => q.modelKey === "gemini_weekly");
    const claudeWeekly = quotas.find((q) => q.modelKey === "claude_gpt_weekly");

    expect(geminiWeekly).toMatchObject({
      used: 250,
      total: 1000,
      remainingPercentage: 75,
      resetAt: "2026-09-15T00:00:00Z",
    });
    expect(claudeWeekly).toMatchObject({
      used: 500,
      total: 1000,
      remainingPercentage: 50,
      resetAt: "2026-09-14T00:00:00Z",
    });
  });

  it("weekly rows do NOT appear as otherModels", () => {
    const quotas = parseQuotaData("antigravity", data);
    const weeklyRows = quotas.filter((q) =>
      q.modelKey === "gemini_weekly" || q.modelKey === "claude_gpt_weekly"
    );
    expect(weeklyRows).toHaveLength(2);
    expect(weeklyRows[0].name).toMatch(/Weekly/);
    expect(weeklyRows[1].name).toMatch(/Weekly/);
  });

  it("order: gemini family, claude family, weekly, then other", () => {
    const quotas = parseQuotaData("antigravity", data);
    const keys = quotas.map((q) => q.modelKey);

    const geminiIdx = keys.indexOf("gemini");
    const claudeIdx = keys.indexOf("claude");
    const geminiWeeklyIdx = keys.indexOf("gemini_weekly");
    const claudeWeeklyIdx = keys.indexOf("claude_gpt_weekly");

    expect(geminiIdx).toBeLessThan(geminiWeeklyIdx);
    expect(claudeIdx).toBeLessThan(claudeWeeklyIdx);
  });

  it("works with no weekly keys present (backward compat)", () => {
    const noWeekly = {
      quotas: {
        "gemini-pro-agent": {
          displayName: "Gemini 3.1 Pro (High)",
          used: 200,
          total: 1000,
          remainingPercentage: 80,
        },
      },
    };
    const quotas = parseQuotaData("antigravity", noWeekly);
    expect(quotas).toHaveLength(1);
    expect(quotas[0].name).toBe("Gemini (Flash / Pro)");
  });

  it("keeps exhausted Argon rows out of the Gemini (Flash / Pro) aggregate", () => {
    const withArgon = {
      quotas: {
        "gemini-4-argon-high": {
          displayName: "Gemini 4 Argon (High)",
          used: 1000,
          total: 1000,
          resetAt: "2026-09-19T00:00:00Z",
          remainingPercentage: 0,
        },
        "gemini-3.8-flash-high": {
          displayName: "Gemini 3.8 Flash (High)",
          used: 100,
          total: 1000,
          resetAt: "2026-09-15T00:00:00Z",
          remainingPercentage: 90,
        },
        gemini_argon_weekly: {
          displayName: "Gemini 4 Argon (Weekly)",
          used: 1000,
          total: 1000,
          resetAt: "2026-09-19T00:00:00Z",
          remainingPercentage: 0,
        },
        gemini_weekly: {
          displayName: "Gemini (Weekly)",
          used: 100,
          total: 1000,
          resetAt: "2026-09-15T00:00:00Z",
          remainingPercentage: 90,
        },
      },
    };

    const quotas = parseQuotaData("antigravity", withArgon);
    const gemini = quotas.find((q) => q.modelKey === "gemini");
    const argonWeekly = quotas.find((q) => q.modelKey === "gemini_argon_weekly");

    expect(gemini.remainingPercentage).toBe(90);
    expect(argonWeekly).toMatchObject({
      name: "Gemini 4 Argon (Weekly)",
      remainingPercentage: 0,
      resetAt: "2026-09-19T00:00:00Z",
    });
    // Argon per-model rows render through their own bucket, never as duplicates.
    expect(quotas.filter((q) => q.modelKey.startsWith("gemini-4-argon"))).toHaveLength(0);
  });
});
