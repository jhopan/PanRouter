import { describe, it, expect } from "vitest";
import {
  KIRO_AGENT_SERVER_VERSION,
  KIRO_CLIENT_ATTRIBUTION,
  KIRO_IDE_VERSION,
  kiroServiceIdForUrl,
  kiroUserAgents,
} from "../../open-sse/shared/kiroIdentity.js";

// Captured 2026-11-15 with mitmproxy + a trusted CA while the installed Kiro
// 1.4.178 IDE sent a real chat turn. Real wire, chat surface:
//   POST https://runtime.us-east-1.kiro.dev/
//   x-amz-target: KiroRuntimeService.GenerateAssistantResponse
//   user-agent: aws-sdk-js/1.0.0 ua/2.1 os/win32#10.0.26200 lang/js
//               md/nodejs#24.22.1 api/kiroruntime#1.0.0 m/N,E
//               KiroIDE-1.4.178-<machineId>-KAS/0.66.102-hotfix.1 acp-client/kiro-ide
const creds = { accessToken: "token-alpha", providerSpecificData: { clientId: "client-1" } };

describe("Kiro 1.4.178 user agents (captured)", () => {
  it("ends the custom agent with the KAS version and acp client", () => {
    const { machineId, userAgent, amzUserAgent } = kiroUserAgents(creds);
    const tail = `KiroIDE-${KIRO_IDE_VERSION}-${machineId}-KAS/${KIRO_AGENT_SERVER_VERSION} ${KIRO_CLIENT_ATTRIBUTION}`;

    expect(userAgent).toContain(` ${tail}`);
    expect(amzUserAgent).toBe(`aws-sdk-js/1.0.0 ${tail}`);
    expect(userAgent).toMatch(/^aws-sdk-js\/[\d.]+ ua\/2\.1 os\/[\w]+#/);
    expect(userAgent).toContain(" lang/js md/nodejs#");
    expect(userAgent).toContain(" m/N,E ");
  });

  it("names the api token for the surface it talks to", () => {
    expect(kiroServiceIdForUrl("https://runtime.us-east-1.kiro.dev/")).toBe("kiroruntime");
    expect(kiroServiceIdForUrl("https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse")).toBe("codewhispererstreaming");
    expect(kiroServiceIdForUrl("https://q.us-east-1.amazonaws.com/generateAssistantResponse")).toBe("codewhispererruntime");
    expect(kiroServiceIdForUrl("")).toBe("codewhispererruntime");

    expect(kiroUserAgents(creds, { serviceId: "kiroruntime" }).userAgent).toContain("api/kiroruntime#");
    expect(kiroUserAgents(creds).userAgent).toContain("api/codewhispererruntime#");
  });
});