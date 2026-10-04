import { describe, it, expect } from "vitest";

const mod = await import("../../src/shared/services/codebuddyAutoPing.js");
const { dailySlotKey, slotMinuteOfDay, cycleMinuteElapsed } = mod;

describe("codebuddyAutoPing dailySlotKey (08:00 WIB boundary)", () => {
  it("aligns to 08:00 WIB reset boundary", () => {
    // 2026-09-29T01:05:00Z = 08:05 WIB (new cycle 2026-09-29)
    expect(dailySlotKey(Date.parse("2026-09-29T01:05:00Z"))).toBe("2026-09-29");
    // 2026-09-30T00:58:00Z = 07:58 WIB next morning (still cycle 2026-09-29)
    expect(dailySlotKey(Date.parse("2026-09-30T00:58:00Z"))).toBe("2026-09-29");
    // 2026-09-30T01:01:00Z = 08:01 WIB next morning (new cycle 2026-09-30)
    expect(dailySlotKey(Date.parse("2026-09-30T01:01:00Z"))).toBe("2026-09-30");
  });
});

describe("codebuddyAutoPing cycleMinuteElapsed", () => {
  it("calculates minutes elapsed since 08:00 WIB", () => {
    // 08:00 WIB -> 0
    expect(cycleMinuteElapsed(Date.parse("2026-09-29T01:00:00Z"))).toBe(0);
    // 08:01 WIB -> 1
    expect(cycleMinuteElapsed(Date.parse("2026-09-29T01:01:00Z"))).toBe(1);
    // 07:58 WIB next morning -> 1438
    expect(cycleMinuteElapsed(Date.parse("2026-09-30T00:58:00Z"))).toBe(1438);
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
