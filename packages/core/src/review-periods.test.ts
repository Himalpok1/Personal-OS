import { describe, expect, it } from "vitest";
import {
  dailyPeriodStart,
  nextDailyPeriodStart,
  nextWeeklyPeriodStart,
  weeklyPeriodStart,
} from "./review-periods.js";

const CHICAGO = "America/Chicago";
const AUCKLAND = "Pacific/Auckland";

describe("dailyPeriodStart", () => {
  it("returns the local calendar date containing the instant", () => {
    // 2026-08-19T14:00:00Z = 09:00 CDT (UTC-5) on Aug 19.
    expect(dailyPeriodStart(CHICAGO, new Date("2026-08-19T14:00:00Z"))).toBe("2026-08-19");
  });

  it("is correct across the spring-forward gap and the fall-back repeat hour", () => {
    // Spring forward: 02:00 CST -> 03:00 CDT on 2026-03-08 (transition at 08:00Z).
    const beforeJump = new Date("2026-03-08T07:00:00Z"); // 01:00 CST
    const afterJump = new Date("2026-03-08T08:30:00Z"); // 03:30 CDT
    expect(dailyPeriodStart(CHICAGO, beforeJump)).toBe("2026-03-08");
    expect(dailyPeriodStart(CHICAGO, afterJump)).toBe("2026-03-08");

    // Fall back: 02:00 CDT -> 01:00 CST on 2026-11-01 (transition at 07:00Z).
    const firstOneOclock = new Date("2026-11-01T05:30:00Z"); // 00:30 CDT
    const secondOneOclock = new Date("2026-11-01T07:30:00Z"); // 01:30 CST
    expect(dailyPeriodStart(CHICAGO, firstOneOclock)).toBe("2026-11-01");
    expect(dailyPeriodStart(CHICAGO, secondOneOclock)).toBe("2026-11-01");
  });

  it("yields different period_start for the same instant in different timezones", () => {
    // 2026-06-14T13:00:00Z = 08:00 Jun 14 Chicago (UTC-5) but
    // 01:00 Jun 15 Auckland (NZST, UTC+12) -- straddles UTC-midnight-ish.
    const instant = new Date("2026-06-14T13:00:00Z");
    expect(dailyPeriodStart(CHICAGO, instant)).toBe("2026-06-14");
    expect(dailyPeriodStart(AUCKLAND, instant)).toBe("2026-06-15");
  });

  it("captures now when no instant is supplied", () => {
    const captured = new Date();
    expect(dailyPeriodStart(CHICAGO)).toBe(dailyPeriodStart(CHICAGO, captured));
    expect(dailyPeriodStart(AUCKLAND)).toBe(dailyPeriodStart(AUCKLAND, captured));
  });
});

describe("weeklyPeriodStart", () => {
  it("maps midweek instants to that week's Monday", () => {
    // 2026-08-19 is a Wednesday; its Monday-start week begins 2026-08-17.
    expect(weeklyPeriodStart(CHICAGO, new Date("2026-08-19T14:00:00Z"))).toBe("2026-08-17");
  });

  it("is correct across both 2026 DST transitions", () => {
    // 2026-03-08 (spring forward) and 2026-11-01 (fall back) are Sundays;
    // their weeks start Mon 2026-03-02 and Mon 2026-10-26.
    expect(weeklyPeriodStart(CHICAGO, new Date("2026-03-08T07:00:00Z"))).toBe("2026-03-02");
    expect(weeklyPeriodStart(CHICAGO, new Date("2026-03-08T08:30:00Z"))).toBe("2026-03-02");
    expect(weeklyPeriodStart(CHICAGO, new Date("2026-11-01T05:30:00Z"))).toBe("2026-10-26");
    expect(weeklyPeriodStart(CHICAGO, new Date("2026-11-01T07:30:00Z"))).toBe("2026-10-26");
  });

  it("puts Sunday evening and Monday 00:30 in different weeks", () => {
    // Sun 2026-03-08 23:00 CDT = 2026-03-09T04:00:00Z.
    const sundayEvening = new Date("2026-03-09T04:00:00Z");
    // Mon 2026-03-09 00:30 CDT = 2026-03-09T05:30:00Z.
    const mondayEarly = new Date("2026-03-09T05:30:00Z");
    expect(weeklyPeriodStart(CHICAGO, sundayEvening)).toBe("2026-03-02");
    expect(weeklyPeriodStart(CHICAGO, mondayEarly)).toBe("2026-03-09");
  });

  it("crosses the year boundary onto the previous year's final week", () => {
    // Fri 2027-01-01 noon CST = 2027-01-01T18:00:00Z; week starts Mon 2026-12-28.
    expect(weeklyPeriodStart(CHICAGO, new Date("2027-01-01T18:00:00Z"))).toBe("2026-12-28");
  });

  it("always returns a Monday regardless of timezone or DST", () => {
    const instants = [
      new Date("2025-12-31T23:59:00Z"),
      new Date("2026-01-01T12:00:00Z"),
      new Date("2026-03-08T08:30:00Z"), // spring forward, Chicago
      new Date("2026-06-15T12:00:00Z"),
      new Date("2026-11-01T07:30:00Z"), // fall back, Chicago
      new Date("2026-12-31T23:59:00Z"),
      new Date("2027-01-01T12:00:00Z"),
      new Date("2027-02-28T18:00:00Z"),
    ];
    for (const tz of [CHICAGO, AUCKLAND]) {
      for (const instant of instants) {
        const periodStart = weeklyPeriodStart(tz, instant);
        const weekday = new Date(`${periodStart}T00:00:00Z`).getUTCDay();
        expect(weekday).toBe(1);
      }
    }
  });

  it("differs between Auckland and Chicago around UTC midnight", () => {
    // 2026-06-14T13:00:00Z = Sun 08:00 Chicago (week of Jun 8) vs
    // Mon 01:00 Auckland (week of Jun 15).
    const instant = new Date("2026-06-14T13:00:00Z");
    expect(weeklyPeriodStart(CHICAGO, instant)).toBe("2026-06-08");
    expect(weeklyPeriodStart(AUCKLAND, instant)).toBe("2026-06-15");
  });
});

describe("nextDailyPeriodStart", () => {
  it("adds exactly 1 day across a month boundary", () => {
    expect(nextDailyPeriodStart(CHICAGO, "2026-08-24")).toBe("2026-08-25");
    expect(nextDailyPeriodStart(CHICAGO, "2026-01-31")).toBe("2026-02-01");
  });

  it("adds exactly 1 day across a year boundary", () => {
    expect(nextDailyPeriodStart(CHICAGO, "2026-12-31")).toBe("2027-01-01");
  });
});

describe("nextWeeklyPeriodStart", () => {
  it("adds exactly 7 days across a month boundary", () => {
    expect(nextWeeklyPeriodStart(CHICAGO, "2026-02-23")).toBe("2026-03-02");
  });

  it("adds exactly 7 days across a year boundary", () => {
    expect(nextWeeklyPeriodStart(CHICAGO, "2026-12-28")).toBe("2027-01-04");
  });

  it("always maps a Monday to the following Monday", () => {
    for (const start of ["2026-02-23", "2026-10-26", "2026-12-28"]) {
      const next = nextWeeklyPeriodStart(CHICAGO, start);
      expect(new Date(`${next}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });
});

describe("input validation", () => {
  it("throws on an invalid timezone for every function", () => {
    const bad = ["Not/AZone", "", "America/Not_A_Real_Zone"];
    for (const tz of bad) {
      expect(() => dailyPeriodStart(tz, new Date("2026-08-19T14:00:00Z"))).toThrow();
      expect(() => weeklyPeriodStart(tz, new Date("2026-08-19T14:00:00Z"))).toThrow();
      expect(() => nextDailyPeriodStart(tz, "2026-08-17")).toThrow();
      expect(() => nextWeeklyPeriodStart(tz, "2026-08-17")).toThrow();
    }
  });

  it("throws on malformed period_start strings", () => {
    const bad = ["", "20260817", "2026-8-17", "2026/08/17", "2026-08-17T00:00:00Z"];
    for (const value of bad) {
      expect(() => nextDailyPeriodStart(CHICAGO, value)).toThrow();
      expect(() => nextWeeklyPeriodStart(CHICAGO, value)).toThrow();
    }
  });

  it("throws on period_start strings that are not real calendar dates", () => {
    for (const value of ["2026-02-30", "2026-13-01", "2026-00-10"]) {
      expect(() => nextDailyPeriodStart(CHICAGO, value)).toThrow();
      expect(() => nextWeeklyPeriodStart(CHICAGO, value)).toThrow();
    }
  });
});
