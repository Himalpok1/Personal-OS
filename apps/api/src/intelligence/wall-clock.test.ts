import { describe, expect, it } from "vitest";
import { formatWallClock, formatWallMonthDay, formatWallTime } from "./wall-clock.js";

describe("formatWallClock (Checkpoint 9.7)", () => {
  it("formats an instant as YYYY-MM-DD HH:mm in the request zone", () => {
    expect(formatWallClock("2026-09-14T14:30:00Z", "America/Chicago")).toBe("2026-09-14 09:30");
    expect(formatWallClock(new Date("2026-09-14T14:30:00Z"), "UTC")).toBe("2026-09-14 14:30");
  });

  it("is correct across the America/Chicago spring-forward (2026-03-08)", () => {
    // 07:59 UTC = 01:59 CST; 08:00 UTC = 03:00 CDT (02:00 never exists).
    expect(formatWallClock("2026-03-08T07:59:00Z", "America/Chicago")).toBe("2026-03-08 01:59");
    expect(formatWallClock("2026-03-08T08:00:00Z", "America/Chicago")).toBe("2026-03-08 03:00");
    expect(formatWallClock("2026-03-08T15:00:00Z", "America/Chicago")).toBe("2026-03-08 10:00");
  });

  it("is correct across the America/Chicago fall-back (2026-11-01)", () => {
    // 06:30 UTC = 01:30 CDT; 07:30 UTC = 01:30 CST (the repeated hour); 08:00 UTC = 02:00 CST.
    expect(formatWallClock("2026-11-01T06:30:00Z", "America/Chicago")).toBe("2026-11-01 01:30");
    expect(formatWallClock("2026-11-01T07:30:00Z", "America/Chicago")).toBe("2026-11-01 01:30");
    expect(formatWallClock("2026-11-01T08:00:00Z", "America/Chicago")).toBe("2026-11-01 02:00");
  });

  it("handles a non-whole-hour offset zone (Asia/Kolkata, +05:30)", () => {
    expect(formatWallClock("2026-09-14T18:45:00Z", "Asia/Kolkata")).toBe("2026-09-15 00:15");
    expect(formatWallClock("2026-09-14T00:00:00Z", "Asia/Kolkata")).toBe("2026-09-14 05:30");
  });

  it("renders midnight as 00, never 24", () => {
    expect(formatWallClock("2026-09-14T05:00:00Z", "America/Chicago")).toBe("2026-09-14 00:00");
  });

  it("throws on an invalid instant rather than emitting NaN", () => {
    expect(() => formatWallClock("not-a-date", "UTC")).toThrow(/invalid instant/);
  });

  it("derives the time-only and month-day forms from the same string", () => {
    expect(formatWallTime("2026-09-14T14:30:00Z", "America/Chicago")).toBe("09:30");
    expect(formatWallMonthDay("2026-09-14T14:30:00Z", "America/Chicago")).toBe("09-14");
  });
});
