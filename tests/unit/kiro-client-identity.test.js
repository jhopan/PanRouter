import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import os from "node:os";
import {
  KIRO_IDE_VERSION,
  kiroMachineId,
  kiroUserAgents,
} from "../../open-sse/shared/kiroIdentity.js";

const REPO = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".next", ".next-cli-build", "coverage"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

const creds = { accessToken: "token-alpha", providerSpecificData: {} };

describe("Kiro client identity passes the version gate", () => {
  it("uses a real Kiro IDE build number, not a placeholder", () => {
    // The gateway rejects old builds outright:
    //   400 "This version of Kiro is no longer supported."
    // 1.0.0 and 0.10.32 were both stale; this tracks the IDE's product.json.
    expect(KIRO_IDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(KIRO_IDE_VERSION).not.toBe("1.0.0");
    expect(KIRO_IDE_VERSION).not.toBe("0.10.32");
    // A version is only meaningful if it is at least as new as the build that was
    // verified live (1.4.178 passed while the old values did not).
    const [maj, min] = KIRO_IDE_VERSION.split(".").map(Number);
    expect(maj > 1 || (maj === 1 && min >= 4)).toBe(true);
  });

  it("emits the hyphenated KiroIDE-<version>-<machineId> form", () => {
    // Verified live: `KiroIDE-1.4.178-<id>` passes the gate, while the
    // space-separated `KiroIDE 1.4.178 <id>` form is still refused, and
    // `kiro-ide/<version>` is refused outright.
    const { userAgent, amzUserAgent } = kiroUserAgents(creds);
    expect(userAgent).toContain(`KiroIDE-${KIRO_IDE_VERSION}-`);
    expect(amzUserAgent).toContain(`KiroIDE-${KIRO_IDE_VERSION}-`);
    expect(userAgent).not.toContain("kiro-ide/");
    expect(userAgent).not.toMatch(/KiroIDE \d/);
  });

  it("describes the host it runs on: raw os.platform() token, real node version", () => {
    // Extracted from extensions/kiro.kiro-agent/dist/extension.js, the bundled
    // AWS SDK builds [ `os/${os.platform()}`, os.release() ] and
    // [ "md/nodejs", process.versions.node ]. So the wire token is
    // win32 | linux | darwin — never "windows" — and the pair describes the
    // machine actually running the code. The old constants sent
    // `os/windows#10.0.26200 ... md/nodejs#22.21.1` from every host, which made
    // a Linux VPS claim a Windows 10 desktop.
    const { userAgent } = kiroUserAgents(creds);
    expect(userAgent).toContain(`os/${os.platform()}#`);
    expect(userAgent).toContain(`md/nodejs#${process.versions.node}`);
    expect(userAgent).not.toContain("os/windows#");
    expect(userAgent).not.toContain("md/nodejs#22.21.1");
  });

  it("carries a 64-char machineId that is stable per account", () => {
    const a = kiroUserAgents(creds);
    const b = kiroUserAgents(creds);
    expect(a.machineId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.userAgent).toBe(b.userAgent);

    const other = kiroUserAgents({ accessToken: "token-beta", providerSpecificData: {} });
    expect(other.machineId).not.toBe(a.machineId);
  });

  it("keys the machineId off the durable identifier when one exists", () => {
    const byToken = kiroMachineId({ accessToken: "t1" });
    const byClient = kiroMachineId({ accessToken: "t1", providerSpecificData: { clientId: "c1" } });
    expect(byClient).not.toBe(byToken);
  });

  it("names the codewhisperer runtime api in the full UA", () => {
    const { userAgent } = kiroUserAgents(creds);
    expect(userAgent).toMatch(/^aws-sdk-js\//);
    expect(userAgent).toContain("api/codewhispererruntime#");
    expect(userAgent).toContain("ua/2.1");
  });
});

describe("no source file reintroduces a rejected Kiro identity", () => {
  it("has no kiro-ide/ or bare-KiroIDE strings left", () => {
    const offenders = [];
    for (const file of walk(join(REPO, "open-sse")).concat(walk(join(REPO, "src")))) {
      if (file.endsWith("kiroIdentity.js")) continue; // the one legitimate source
      const text = readFileSync(file, "utf8");
      // A hardcoded version is the failure mode: it silently rots until the
      // gateway refuses every request for the whole provider.
      if (/kiro-ide\/\d|"aws-sdk-js\/1\.0\.0 KiroIDE"|kiro-cli\/1\.0\.0/.test(text)) {
        offenders.push(relative(REPO, file));
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);
});