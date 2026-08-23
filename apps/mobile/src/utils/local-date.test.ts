import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  formatLocalDate,
  parseLocalDate,
  todayLocalDate,
} from "./local-date";

// These tests are the regression net for the class of bug Checkpoint 5.5 fixed
// server-side: a date-only value silently shifting by a day because it was
// routed through a UTC instant.
describe("parseLocalDate", () => {
  it("lands on LOCAL midnight, not UTC midnight", () => {
    const d = parseLocalDate("2026-08-23");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(0);
  });

  it("does not shift the calendar day the way new Date(string) does", () => {
    // The whole point: round-tripping must be identity in every zone.
    for (const date of ["2026-01-01", "2026-08-23", "2026-12-31"]) {
      expect(formatLocalDate(parseLocalDate(date))).toBe(date);
    }
  });
});

describe("formatLocalDate", () => {
  it("zero-pads month and day", () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("reads local parts, so a late-evening instant keeps its own date", () => {
    // 23:30 local -- .toISOString().slice(0,10) would report the NEXT day
    // anywhere west of UTC. This must report the local day.
    const d = new Date(2026, 7, 23, 23, 30);
    expect(formatLocalDate(d)).toBe("2026-08-23");
  });
});

describe("addLocalDays", () => {
  it("advances and rewinds by whole calendar days", () => {
    expect(addLocalDays("2026-08-23", 1)).toBe("2026-08-24");
    expect(addLocalDays("2026-08-23", -1)).toBe("2026-08-22");
    expect(addLocalDays("2026-08-23", 7)).toBe("2026-08-30");
  });

  it("crosses month and year boundaries", () => {
    expect(addLocalDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addLocalDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(addLocalDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addLocalDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("stays on calendar days across a DST transition", () => {
    // 2026-11-01 is the US fall-back date packages/core's own DST tests use.
    // A 25-hour day must still advance exactly one calendar day.
    expect(addLocalDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addLocalDays("2026-11-01", 1)).toBe("2026-11-02");
    // Spring-forward (23-hour day).
    expect(addLocalDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addLocalDays("2026-03-08", 1)).toBe("2026-03-09");
  });
});

describe("todayLocalDate", () => {
  it("uses the local calendar date of the supplied instant", () => {
    expect(todayLocalDate(new Date(2026, 7, 23, 23, 59))).toBe("2026-08-23");
    expect(todayLocalDate(new Date(2026, 7, 24, 0, 1))).toBe("2026-08-24");
  });
});
