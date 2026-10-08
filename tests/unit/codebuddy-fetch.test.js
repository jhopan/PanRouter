import { describe, expect, it } from "vitest";
import { CODEBUDDY_EDGE_IP, CODEBUDDY_HOST, codebuddyFetch } from "../../open-sse/utils/codebuddyFetch.js";

describe("codebuddyFetch isolated client", () => {
  it("exports valid host and Anycast IP constants", () => {
    expect(CODEBUDDY_HOST).toBe("www.codebuddy.ai");
    expect(CODEBUDDY_EDGE_IP).toBe("43.159.106.56");
  });

  it("fails gracefully on invalid URL without throwing uncaught", async () => {
    await expect(codebuddyFetch("not-a-valid-url")).rejects.toThrow();
  });
});
