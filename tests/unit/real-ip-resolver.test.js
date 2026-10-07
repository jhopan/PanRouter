import { describe, expect, it } from "vitest";
import { isPoisonedIp } from "../../open-sse/utils/realIpResolver.js";

describe("realIpResolver isPoisonedIp", () => {
  it("flags steering dead-addresses", () => {
    expect(isPoisonedIp("0.0.0.0")).toBe(true);
    expect(isPoisonedIp("0.0.0.1")).toBe(true);
    expect(isPoisonedIp("0.0.0.255")).toBe(true);
    expect(isPoisonedIp("127.0.0.1")).toBe(true);
    expect(isPoisonedIp("")).toBe(true);
    expect(isPoisonedIp(null)).toBe(true);
  });

  it("allows real public IPs", () => {
    expect(isPoisonedIp("43.159.106.56")).toBe(false);
    expect(isPoisonedIp("142.250.4.100")).toBe(false);
    expect(isPoisonedIp(" 8.8.8.8 ")).toBe(false);
  });
});