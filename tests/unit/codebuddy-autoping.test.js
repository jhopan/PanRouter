import { describe, it, expect } from "vitest";

const mod = await import("../../src/shared/services/codebuddyAutoPing.js");
const { dailySlotKey, slotMinuteOfDay, cycleMinuteElapsed } = mod;

describe("codebuddyAutoPing dailySlotKey (07:00 WIB boundary)", () => {
  it("aligns to 07:00 WIB reset boundary (00:00 UTC)", () => {
    // 2026-09-29T00:05:00Z = 07:05 WIB (new cycle 2026-09-29)
    expect(dailySlotKey(Date.parse("2026-09-29T00:05:00Z"))).toBe("2026-09-29");
    // 2026-09-29T23:58:00Z = 06:58 WIB next morning (still cycle 2026-09-29)
    expect(dailySlotKey(Date.parse("2026-09-29T23:58:00Z"))).toBe("2026-09-29");
    // 2026-09-30T00:01:00Z = 07:01 WIB next morning (new cycle 2026-09-30)
    expect(dailySlotKey(Date.parse("2026-09-30T00:01:00Z"))).toBe("2026-09-30");
  });
});

describe("codebuddyAutoPing cycleMinuteElapsed", () => {
  it("calculates minutes elapsed since 07:00 WIB", () => {
    // 07:00 WIB (00:00 UTC) -> 0
    expect(cycleMinuteElapsed(Date.parse("2026-09-29T00:00:00Z"))).toBe(0);
    // 07:01 WIB (00:01 UTC) -> 1
    expect(cycleMinuteElapsed(Date.parse("2026-09-29T00:01:00Z"))).toBe(1);
    // 06:58 WIB next morning (23:58 UTC) -> 1438
    expect(cycleMinuteElapsed(Date.parse("2026-09-29T23:58:00Z"))).toBe(1438);
  });
});

describe("codebuddyAutoPing slotMinuteOfDay (daily re-roll)", () => {
  it("stable within one day for same connection, different across days", () => {
    const d1 = "2026-09-29", d2 = "2026-09-30";
    const s1 = slotMinuteOfDay("conn-cb-1", d1, 8, 20);
    expect(s1).toBe(slotMinuteOfDay("conn-cb-1", d1, 8, 20)); // same day = same slot
    const s2 = slotMinuteOfDay("conn-cb-1", d2, 8, 20);
    expect(s2).not.toBe(s1); // new day = re-rolled
    expect(s1).toBeGreaterThanOrEqual(8 * 60);
    expect(s1).toBeLessThan(20 * 60);
  });

  it("staggers different connections on the same day", () => {
    const slots = new Set(Array.from({ length: 10 }, (_, i) => slotMinuteOfDay(`cb-conn-${i}`, "2026-09-29", 8, 20)));
    expect(slots.size).toBeGreaterThanOrEqual(5);
  });

  it("distributes across full 08:01 to 07:58 WIB window (1..1438) by default", () => {
    const slots = Array.from({ length: 50 }, (_, i) => slotMinuteOfDay(`cb-conn-${i}`, "2026-09-29"));
    expect(Math.min(...slots)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...slots)).toBeLessThanOrEqual(1438);
    // Across 50 connections in 24 hours, should have wide spread
    expect(new Set(slots).size).toBeGreaterThanOrEqual(30);
  });
});
