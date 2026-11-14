import { describe, expect, it } from "vitest";
import { planBulkAdd } from "../../src/shared/utils/bulkAdd.js";

// Ported from upstream a199d777. `LLM|id|secret` is a single opaque token: the
// provider id and the secret both live inside the key, so splitting on "|" as
// name|key would store "LLM" as the name and "id|secret" as the key.
describe("planBulkAdd: opaque LLM|id|secret tokens", () => {
  it("treats LLM|id|secret as one token, not name|key", () => {
    const line = "LLM|1412752987604207|PYVRCdb9ZAnsZZk63RBlNQzApKk";
    const out = planBulkAdd([line], []);
    expect(out[0].name).toBe("LLM 1");
    expect(out[0].apiKey).toBe(line);
  });

  it("matches the prefix case-insensitively", () => {
    const line = "llm|1412752987604207|PYVRCdb9ZAnsZZk63RBlNQzApKk";
    const out = planBulkAdd([line], []);
    expect(out[0].apiKey).toBe(line);
  });

  it("still splits a normal name|key line", () => {
    const out = planBulkAdd(["my-key|sk-abc123"], []);
    expect(out[0].name).toBe("my-key 1");     // planner appends a uniqueness suffix
    expect(out[0].apiKey).toBe("sk-abc123");
  });

  it("keeps the Cloudflare name|apiKey|accountId shape intact", () => {
    const out = planBulkAdd(["cf|key-part|account-id"], [], { isCloudflareAi: true });
    expect(out[0].name).toBe("cf 1");
    expect(out[0].providerSpecificData?.accountId).toBe("account-id");
  });
});