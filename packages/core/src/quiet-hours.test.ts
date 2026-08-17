import { describe, expect, it } from "vitest";
import { isWithinQuietHours } from "./quiet-hours.js";

describe("isWithinQuietHours", () => {
  it("is false when any field is null", () => {
    const now = new Date("2026-08-16T03:00:00Z");
    expect(isWithinQuietHours(now, null, "08:00", "America/Chicago")).toBe(false);
    expect(isWithinQuietHours(now, "22:00", null, "America/Chicago")).toBe(false);
    expect(isWithinQuietHours(now, "22:00", "08:00", null)).toBe(false);
  });

  it("is true for a same-day window when now falls inside it", () => {
    // 2026-08-16T15:00:00Z = 10:00 America/Chicago (CDT, UTC-5) -- inside 09:00-17:00.
    const now = new Date("2026-08-16T15:00:00Z");
    expect(isWithinQuietHours(now, "09:00", "17:00", "America/Chicago")).toBe(true);
  });

  it("is false for a same-day window when now falls outside it", () => {
    // 2026-08-16T23:00:00Z = 18:00 America/Chicago -- after 09:00-17:00.
    const now = new Date("2026-08-16T23:00:00Z");
    expect(isWithinQuietHours(now, "09:00", "17:00", "America/Chicago")).toBe(false);
  });

  it("handles an overnight wraparound window (22:00 -> 06:00)", () => {
    // 2026-08-16T08:00:00Z = 03:00 America/Chicago -- inside the wraparound window.
    const insideWrap = new Date("2026-08-16T08:00:00Z");
    expect(isWithinQuietHours(insideWrap, "22:00", "06:00", "America/Chicago")).toBe(true);

    // 2026-08-16T20:00:00Z = 15:00 America/Chicago -- outside it.
    const outsideWrap = new Date("2026-08-16T20:00:00Z");
    expect(isWithinQuietHours(outsideWrap, "22:00", "06:00", "America/Chicago")).toBe(false);
  });

  it("is false when start equals end (degenerate/misconfigured window)", () => {
    const now = new Date("2026-08-16T15:00:00Z");
    expect(isWithinQuietHours(now, "09:00", "09:00", "America/Chicago")).toBe(false);
  });
});
