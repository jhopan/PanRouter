import { describe, expect, it } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

const RUNTIME = "https://runtime.us-east-1.kiro.dev/generateAssistantResponse";
const CW_US = "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse";
const Q_US = "https://q.us-east-1.amazonaws.com/generateAssistantResponse";
const Q_EU = "https://q.eu-central-1.amazonaws.com/generateAssistantResponse";

const executor = new KiroExecutor();

function creds(extra = {}) {
  return { providerSpecificData: { authMethod: "idc", region: "us-east-1", ...extra } };
}

describe("Kiro region splicing is limited to services that serve the region", () => {
  it("keeps codewhisperer on us-east-1 for a eu-central-1 connection", () => {
    // codewhisperer only answers in us-east-1. Splicing eu-central-1 there built
    // `codewhisperer.eu-central-1.amazonaws.com` — an NXDOMAIN host that burned
    // the 502 retry ladder (~18s to first byte) while q.eu-central-1 worked.
    const urls = executor.getOrderedBaseUrls(creds({ region: "eu-central-1" }));
    expect(urls).toEqual([Q_EU, CW_US, RUNTIME]);
  });

  it("still regionalizes q, which does serve eu-central-1", () => {
    const urls = executor.getOrderedBaseUrls(creds({ region: "eu-central-1" }));
    expect(urls).toContain(Q_EU);
  });

  it("leaves us-east-1 untouched", () => {
    expect(executor.getOrderedBaseUrls(creds({ region: "us-east-1" }))).toEqual([
      Q_US,
      CW_US,
      RUNTIME,
    ]);
  });

  it("ignores a profileArn region no service covers", () => {
    // ap-southeast-2 passes the arn character class but no service serves it.
    const urls = executor.getOrderedBaseUrls(
      creds({ profileArn: "arn:aws:codewhisperer:ap-southeast-2:123456789012:profile/ABCD" }),
    );
    expect(urls).toEqual([Q_US, CW_US, RUNTIME]);
  });

  it("never lets an unvalidated arn region reach a hostname that receives the bearer token", () => {
    // The hostname carries the token. A region string from the credential must
    // not be able to steer it anywhere the connection did not choose.
    const hostile = [
      "arn:aws:codewhisperer:attacker-origin:123456789012:profile/ABCD",
      "arn:aws:codewhisperer:evilcom-9999:123456789012:profile/ABCD",
    ];
    for (const profileArn of hostile) {
      for (const url of executor.getOrderedBaseUrls(creds({ profileArn }))) {
        expect(url).toMatch(/amazonaws\.com|kiro\.dev/);
        expect(url).not.toContain("attacker-origin");
        expect(url).not.toContain("evilcom-9999");
      }
    }
  });

  it("accepts a covered profileArn region but still guards per service", () => {
    const urls = executor.getOrderedBaseUrls(
      creds({ profileArn: "arn:aws:codewhisperer:eu-central-1:123456789012:profile/ABCD" }),
    );
    // q regionalizes; codewhisperer stays us-east-1.
    expect(urls).toEqual([Q_EU, CW_US, RUNTIME]);
  });
});
