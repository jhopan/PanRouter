import { createHash } from "node:crypto";
import os from "node:os";

// Kiro client identity — ONE source for every hop that talks to the Amazon
// surfaces (model list, chat, usage).
//
// Why this matters: the Amazon Q / CodeWhisperer gateway parses the Kiro version
// out of the user agent and refuses old builds outright:
//   400 {"message":"This version of Kiro is no longer supported.
//        Please update to the latest version of Kiro to continue."}
// It rejects the whole request, not just a model, so a stale constant takes the
// provider down. Verified against the live gateway: `KiroIDE-1.4.178-<machineId>`
// passes the version gate, while `kiro-ide/1.0.0` and the space-separated
// `KiroIDE 1.4.178 <machineId>` form are both refused.
//
// The version must track a real Kiro IDE build. The IDE derives it from
// `vscode.kiroVersion` — its own product.json — so this value is read from an
// installed IDE, not invented. Cross-checked against
// <install>/resources/app/product.json: {"nameShort":"Kiro","version":"1.4.178"}.
export const KIRO_IDE_VERSION = "1.4.178";
export const KIRO_RUNTIME_SDK_VERSION = "1.0.0";

// The os/ and md/ pairs are NOT constants in the real client. Extracted from
// extensions/kiro.kiro-agent/dist/extension.js, the bundled AWS SDK builds its
// user-agent pairs as:
//
//   [["aws-sdk-js", ver], ["ua", "2.1"], [`os/${os.platform()}`, os.release()],
//    ["lang/js"], ["md/nodejs", process.versions.node], [`api/${serviceId}`, ver]]
//
// So the wire token is `os.platform()` — win32 | linux | darwin — never
// "windows", and the machine/runtime entries describe the host that runs the
// client. The previous constants hardcoded `os/windows#10.0.26200` and
// `md/nodejs#22.21.1` from every host, which made a Linux VPS claim a Windows 10
// desktop. Derive them from the host instead: a claim about the machine we run
// on should be true.
export function kiroOsPlatform() {
  return String(os.platform());
}

export function kiroOsRelease() {
  // A user-agent token cannot carry whitespace; kernel release strings rarely
  // do, but a stray space would split the header into a bogus extra token.
  return String(os.release()).replace(/\s+/g, "_");
}

export function kiroNodeVersion() {
  return String(process.versions.node);
}

/**
 * Stable per-account machineId. Keyed off whatever durable identifier the
 * credential carries, so the same account always presents the same fingerprint
 * and keeps its queue/session standing.
 */
export function kiroMachineId(credentials) {
  const seed =
    credentials?.providerSpecificData?.clientId
    || credentials?.refreshToken
    || credentials?.providerSpecificData?.profileArn
    || credentials?.accessToken
    || "kiro-anonymous";
  return createHash("sha256").update(String(seed)).digest("hex");
}

/**
 * The two user-agent strings Kiro validates.
 * `KiroIDE-<version>-<machineId>` is the part the version gate reads.
 */
export function kiroUserAgents(credentials) {
  const machineId = kiroMachineId(credentials);
  const userAgent =
    `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ua/2.1 ` +
    `os/${kiroOsPlatform()}#${kiroOsRelease()} ` +
    `lang/js md/nodejs#${kiroNodeVersion()} ` +
    `api/codewhispererruntime#${KIRO_RUNTIME_SDK_VERSION} m/N,E ` +
    `KiroIDE-${KIRO_IDE_VERSION}-${machineId}`;
  const amzUserAgent = `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} KiroIDE-${KIRO_IDE_VERSION}-${machineId}`;
  return { userAgent, amzUserAgent, machineId };
}