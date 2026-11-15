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
// Kiro Agent Server that the 1.4.178 IDE embeds. Captured 2026-11-15 from a live
// IDE request (mitmproxy + trusted CA) — every request UA ends with
//   ... KiroIDE-1.4.178-<machineId>-KAS/0.66.102-hotfix.1 acp-client/kiro-ide
// Not part of the gated version token, but it is what the real client sends.
export const KIRO_AGENT_SERVER_VERSION = "0.66.102-hotfix.1";
export const KIRO_CLIENT_ATTRIBUTION = "acp-client/kiro-ide";

// Service id per surface, from the same capture:
//   runtime.<region>.kiro.dev   → kiroruntime   (KiroRuntimeService.*)
//   codewhisperer.<region>...   → codewhispererstreaming
//   q.<region>.amazonaws.com    → codewhispererruntime
export function kiroServiceIdForUrl(url = "") {
  if (url.includes("://runtime.")) return "kiroruntime";
  if (url.includes("://codewhisperer.")) return "codewhispererstreaming";
  return "codewhispererruntime";
}

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
 * `KiroIDE-<version>-<machineId>` is the part the version gate reads; the
 * `-KAS/<agent server> acp-client/kiro-ide` tail and `api/<service>#<sdk>`
 * token are what the 1.4.178 client puts around it (captured).
 */
export function kiroUserAgents(credentials, { serviceId = "codewhispererruntime", serviceVersion = KIRO_RUNTIME_SDK_VERSION } = {}) {
  const machineId = kiroMachineId(credentials);
  const custom = `KiroIDE-${KIRO_IDE_VERSION}-${machineId}-KAS/${KIRO_AGENT_SERVER_VERSION} ${KIRO_CLIENT_ATTRIBUTION}`;
  const userAgent =
    `aws-sdk-js/${serviceVersion} ua/2.1 ` +
    `os/${kiroOsPlatform()}#${kiroOsRelease()} ` +
    `lang/js md/nodejs#${kiroNodeVersion()} ` +
    `api/${serviceId}#${serviceVersion} m/N,E ` +
    custom;
  const amzUserAgent = `aws-sdk-js/${serviceVersion} ${custom}`;
  return { userAgent, amzUserAgent, machineId };
}