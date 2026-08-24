import { describe, expect, it } from "vitest";
import {
  civilDateRange,
  civilDateToLocalDate,
  civilDateTimeToNaiveDate,
  parseGoogleDuration,
} from "./civil-time.js";

describe("parseGoogleDuration", () => {
  it("parses zero, positive and negative offsets", () => {
    expect(parseGoogleDuration("0s")).toBe(0);
    expect(parseGoogleDuration("-18000s")).toBe(-18000);
    expect(parseGoogleDuration("50400s")).toBe(50400);
  });

  // Kathmandu +05:45 and Chatham +12:45 are the reason offsets are stored in
  // seconds rather than hours -- an hour-granular column is simply wrong there.
  it("round-trips the three-quarter-hour offsets that break hour-granular code", () => {
    expect(parseGoogleDuration("20700s")).toBe(20700); // +05:45 Kathmandu
    expect(parseGoogleDuration("45900s")).toBe(45900); // +12:45 Chatham
  });

  it("truncates a fractional part toward zero rather than rounding", () => {
    expect(parseGoogleDuration("3.5s")).toBe(3);
    expect(parseGoogleDuration("-3.5s")).toBe(-3);
  });

  it("rejects malformed durations instead of silently yielding NaN", () => {
    expect(() => parseGoogleDuration("18000")).toThrow(/invalid Google Duration/);
    expect(() => parseGoogleDuration("")).toThrow(/invalid Google Duration/);
    expect(() => parseGoogleDuration("abc")).toThrow(/invalid Google Duration/);
  });
});

describe("civilDateToLocalDate", () => {
  it("zero-pads month and day", () => {
    expect(civilDateToLocalDate({ date: { year: 2026, month: 3, day: 4 } })).toBe("2026-03-04");
  });
});

describe("civilDateTimeToNaiveDate", () => {
  // A `timestamp without time zone` column stores the Date's UTC getters, so a
  // naive Date built with local getters is off by the process timezone. This
  // asserts the UTC reading, which is what actually lands in the column.
  it("preserves the wall clock in the Date's UTC getters", () => {
    const d = civilDateTimeToNaiveDate({
      date: { year: 2026, month: 11, day: 1 },
      time: { hours: 23, minutes: 41, seconds: 9 },
    });
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth() + 1).toBe(11);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(41);
    expect(d.getUTCSeconds()).toBe(9);
  });

  it("defaults a missing time part to midnight", () => {
    const d = civilDateTimeToNaiveDate({ date: { year: 2026, month: 1, day: 1 } });
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
  });
});

describe("civilDateRange", () => {
  it("is half-open: includes from, excludes to", () => {
    expect(civilDateRange("2026-08-20", "2026-08-23")).toEqual([
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ]);
  });

  it("crosses a month boundary", () => {
    expect(civilDateRange("2026-08-30", "2026-09-02")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });

  it("crosses a leap day", () => {
    expect(civilDateRange("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29"]);
  });

  // A DST transition changes the LENGTH of a civil day but never the sequence
  // of civil dates, which is exactly why densification iterates dates.
  it("emits one entry per civil date across a DST transition", () => {
    expect(civilDateRange("2026-10-31", "2026-11-03")).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("returns empty rather than looping forever when to <= from", () => {
    expect(civilDateRange("2026-08-20", "2026-08-20")).toEqual([]);
    expect(civilDateRange("2026-08-20", "2026-08-19")).toEqual([]);
  });
});
