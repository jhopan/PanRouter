// Console log noise control.
//
// Background token refresh fires on every tick and buries the request lines you
// actually want to read. Two layers of control:
//   - server: LOG_SUPPRESS_TAGS / LOG_ONLY_TAGS env vars in the logger
//   - UI: the "Hide refresh logs" checkbox, tag filter, text filter, and pause
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");

const logger = read("../src/sse/utils/logger.js");
const client = read("../src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js");

describe("logger — tag suppression", () => {
  it("suppresses token-refresh tags by default", () => {
    expect(logger).toMatch(/new Set\(\["TOKEN_REFRESH", "BG_TOKEN_REFRESH"\]\)/);
  });

  it("reads LOG_SUPPRESS_TAGS and LOG_ONLY_TAGS", () => {
    expect(logger).toContain("LOG_SUPPRESS_TAGS");
    expect(logger).toContain("LOG_ONLY_TAGS");
  });

  it("applies the filter to line/debug/info/warn", () => {
    expect(logger).toMatch(/line\(tag, symbol, message\)[\s\S]{0,200}tagAllowed\(tag\)/);
    expect(logger).toMatch(/LEVEL <= LOG_LEVELS\.DEBUG && tagAllowed\(tag\)/);
    expect(logger).toMatch(/LEVEL <= LOG_LEVELS\.INFO && tagAllowed\(tag\)/);
    expect(logger).toMatch(/LEVEL <= LOG_LEVELS\.WARN && tagAllowed\(tag\)/);
  });

  it("never filters errors", () => {
    // An error must always reach the operator, whatever the tag lists say.
    const errorFn = logger.slice(logger.indexOf("export function error("));
    const body = errorFn.slice(0, 200);
    expect(body).not.toContain("tagAllowed");
  });
});

describe("console-log UI — readability controls", () => {
  it("has a pause/resume control that buffers while paused", () => {
    expect(client).toContain("pausedRef");
    expect(client).toContain("bufferRef");
    expect(client).toMatch(/paused \? "Resume" : "Pause"/);
  });

  it("hides refresh logs by default", () => {
    expect(client).toMatch(/useState\(true\)/);
    expect(client).toContain("Hide refresh logs");
    expect(client).toContain('NOISY_TAGS = ["TOKEN_REFRESH", "BG_TOKEN_REFRESH"]');
  });

  it("offers a tag filter and a free-text filter", () => {
    expect(client).toContain("All tags");
    expect(client).toContain("tagFilter");
    expect(client).toContain("Filter text");
  });

  it("stops auto-scrolling while paused", () => {
    expect(client).toMatch(/if \(paused \|\| !logRef\.current\) return;/);
  });

  it("reports how many lines are hidden", () => {
    expect(client).toContain("hiddenCount");
    expect(client).toContain("hidden");
  });
});
