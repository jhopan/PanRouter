// The auto-ping sends one chat to every CodeBuddy Intl connection every day.
// That daily burst is what got the accounts flagged with 11140 "request
// illegal", so the whole feature is off unless it is switched on explicitly.
//
// The switch used to read `!== "0"`, which defaults to ON: the operator never
// asked for it, the scheduler started anyway, and it kept pinging accounts
// that were already restricted. The switch has to require an explicit "1".
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("../src/shared/services/codebuddyAutoPing.js");
const read = () => fs.readFileSync(SRC, "utf8");

describe("codebuddy auto-ping master switch", () => {
  it("is off unless the environment variable says 1", () => {
    const src = read();
    expect(src).toMatch(/CB_AUTOPING_MASTER_ENABLED\s*=\s*process\.env\.CODEBUDDY_AUTOPING_ENABLED\s*===\s*"1"/);
    // The old form defaulted to ON.
    expect(src).not.toMatch(/CODEBUDDY_AUTOPING_ENABLED\s*!==\s*"0"/);
  });

  it("gates the scheduler itself, not only the configure path", () => {
    const src = read();
    const startFn = src.slice(src.indexOf("export function startCodebuddyAutoPing"));
    expect(startFn).toMatch(/CB_AUTOPING_MASTER_ENABLED/);
  });

  it("warns instead of starting when the switch is off", () => {
    // Importing the module pulls in the DB layer, so the switch is checked by
    // reading the source rather than by calling into it.
    const src = read();
    const startFn = src.slice(src.indexOf("export function startCodebuddyAutoPing"));
    expect(startFn).toMatch(/CODEBUDDY_AUTOPING_ENABLED\s*!==\s*\"1\"|!CB_AUTOPING_MASTER_ENABLED/);
    expect(startFn).toMatch(/scheduler not started/);
  });

  it("does not let a leftover per-connection flag start the feature", () => {
    // `enabled: false` with some connections still set to true used to start
    // the scheduler, because the check OR-ed the connection map into the
    // enabled flag. The per-connection map says WHICH connections ping, not
    // WHETHER the feature runs.
    const src = read();
    const cfg = src.slice(src.indexOf("export async function configureCodebuddyAutoPing"));
    expect(cfg).toMatch(/const enabled = cfg\.enabled === true;/);
    expect(cfg).not.toMatch(/Object\.values\(cfg\.connections/);
  });

  it("stops the scheduler when configure sees the switch off", () => {
    const src = read();
    const cfg = src.slice(src.indexOf("export async function configureCodebuddyAutoPing"));
    expect(cfg).toMatch(/!CB_AUTOPING_MASTER_ENABLED/);
    expect(cfg).toMatch(/stopCodebuddyAutoPing\(\)/);
  });
});
