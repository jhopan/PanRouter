import { describe, it, expect } from "vitest";

const mod = await import("../../src/shared/services/codebuddyAutoPing.js");
const { dailySlotKey, slotMinuteOfDay } = mod;

describe("codebuddyAutoPing dailySlotKey", () => {
  it("formats timestamp as YYYY-MM-DD date in Asia/Jakarta", () => {
    // 2026-09-29T02:00:00Z = 09:00 WIB (same day)
    expect(dailySlotKey(Date.parse("2026-09-29T02:00:00Z"))).toBe("2026-09-29");
  });
  it("rolls to next day when UTC is late evening but WIB is next morning", () => {
    // 2026-09-29T18:00:00Z = 2026-09-30T01:00:00 WIB
    expect(dailySlotKey(Date.parse("2026-09-29T18:00:00Z"))).toBe("2026-09-30");
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
});
