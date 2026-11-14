import { createHash } from "node:crypto";

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
// installed IDE (1.4.178), not invented.
export const KIRO_IDE_VERSION = "1.4.178";
export const KIRO_RUNTIME_SDK_VERSION = "1.0.0";
export const KIRO_AGENT_OS = "windows";
export const KIRO_AGENT_OS_VERSION = "10.0.26200";
export const KIRO_NODE_VERSION = "22.21.1";

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
    `os/${KIRO_AGENT_OS}#${KIRO_AGENT_OS_VERSION} ` +
    `lang/js md/nodejs#${KIRO_NODE_VERSION} ` +
    `api/codewhispererruntime#${KIRO_RUNTIME_SDK_VERSION} m/N,E ` +
    `KiroIDE-${KIRO_IDE_VERSION}-${machineId}`;
  const amzUserAgent = `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} KiroIDE-${KIRO_IDE_VERSION}-${machineId}`;
  return { userAgent, amzUserAgent, machineId };
}