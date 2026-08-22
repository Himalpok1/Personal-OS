import { describe, expect, it } from "vitest";
import { toWallClockComponents } from "../timezone.js";
import { expandRecurrenceInRange } from "./due-date-window.js";
import { allDayInstanceDates, buildEventRecurrenceRule } from "./event-recurrence.js";

describe("buildEventRecurrenceRule", () => {
  it("timed event: dtstart matches toWallClockComponents(startsAt, timezone)", () => {
    const startsAt = new Date("2026-09-01T14:30:00.000Z");
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=WEEKLY",
      recurrenceTimezone: "America/Chicago",
      allDay: false,
      startsAt,
      startDate: null,
    });

    expect(rule).not.toBeNull();
    expect(rule?.dtstart).toEqual(toWallClockComponents(startsAt, "America/Chicago"));
    expect(rule?.rrule).toBe("FREQ=WEEKLY");
    expect(rule?.recurrenceTimezone).toBe("America/Chicago");
  });

  it("all-day event: dtstart is derived from start_date at hour 12 (noon)", () => {
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=DAILY",
      recurrenceTimezone: "America/Chicago",
      allDay: true,
      startsAt: null,
      startDate: "2026-09-01",
    });

    expect(rule).not.toBeNull();
    expect(rule?.dtstart).toEqual({
      year: 2026,
      month: 9,
      day: 1,
      hour: 12,
      minute: 0,
      second: 0,
    });
  });

  it("returns null when rrule is missing", () => {
    const rule = buildEventRecurrenceRule({
      rrule: null,
      recurrenceTimezone: "America/Chicago",
      allDay: false,
      startsAt: new Date("2026-09-01T14:30:00.000Z"),
      startDate: null,
    });
    expect(rule).toBeNull();
  });

  it("returns null when recurrenceTimezone is missing", () => {
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=DAILY",
      recurrenceTimezone: null,
      allDay: false,
      startsAt: new Date("2026-09-01T14:30:00.000Z"),
      startDate: null,
    });
    expect(rule).toBeNull();
  });

  it("returns null for an all-day rule with no start_date", () => {
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=DAILY",
      recurrenceTimezone: "America/Chicago",
      allDay: true,
      startsAt: null,
      startDate: null,
    });
    expect(rule).toBeNull();
  });

  it("returns null for a timed rule with no starts_at", () => {
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=DAILY",
      recurrenceTimezone: "America/Chicago",
      allDay: false,
      startsAt: null,
      startDate: null,
    });
    expect(rule).toBeNull();
  });

  it("passes through null recurrenceUntil/recurrenceCount/recurrenceExdates as undefined", () => {
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=DAILY",
      recurrenceTimezone: "America/Chicago",
      allDay: false,
      startsAt: new Date("2026-09-01T14:30:00.000Z"),
      startDate: null,
      recurrenceUntil: null,
      recurrenceCount: null,
      recurrenceExdates: null,
    });
    expect(rule?.recurrenceUntil).toBeUndefined();
    expect(rule?.recurrenceCount).toBeUndefined();
    expect(rule?.recurrenceExdates).toBeUndefined();
  });

  it("passes through real recurrenceUntil/recurrenceCount/recurrenceExdates values unchanged", () => {
    const until = new Date("2026-12-31T00:00:00.000Z");
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=DAILY",
      recurrenceTimezone: "America/Chicago",
      allDay: false,
      startsAt: new Date("2026-09-01T14:30:00.000Z"),
      startDate: null,
      recurrenceUntil: until,
      recurrenceCount: 5,
      recurrenceExdates: ["2026-09-05"],
    });
    expect(rule?.recurrenceUntil).toBe(until);
    expect(rule?.recurrenceCount).toBe(5);
    expect(rule?.recurrenceExdates).toEqual(["2026-09-05"]);
  });
});

describe("allDayInstanceDates", () => {
  it("single-day span: start === end, offset 0", () => {
    const result = allDayInstanceDates(
      { year: 2026, month: 9, day: 10, hour: 12, minute: 0, second: 0 },
      "2026-09-01",
      "2026-09-01",
    );
    expect(result).toEqual({ startDate: "2026-09-10", endDate: "2026-09-10" });
  });

  it("null parentEndDate is treated as offset 0", () => {
    const result = allDayInstanceDates(
      { year: 2026, month: 9, day: 10, hour: 12, minute: 0, second: 0 },
      "2026-09-01",
      null,
    );
    expect(result).toEqual({ startDate: "2026-09-10", endDate: "2026-09-10" });
  });

  it("preserves a 3-day span on a generated instance", () => {
    const result = allDayInstanceDates(
      { year: 2026, month: 9, day: 10, hour: 12, minute: 0, second: 0 },
      "2026-09-01",
      "2026-09-03",
    );
    expect(result).toEqual({ startDate: "2026-09-10", endDate: "2026-09-12" });
  });

  it("preserves the span across a month boundary", () => {
    const result = allDayInstanceDates(
      { year: 2026, month: 9, day: 29, hour: 12, minute: 0, second: 0 },
      "2026-01-01",
      "2026-01-03",
    );
    expect(result).toEqual({ startDate: "2026-09-29", endDate: "2026-10-01" });
  });

  it("preserves the span across a year boundary", () => {
    const result = allDayInstanceDates(
      { year: 2026, month: 12, day: 30, hour: 12, minute: 0, second: 0 },
      "2026-01-01",
      "2026-01-02",
    );
    expect(result).toEqual({ startDate: "2026-12-30", endDate: "2026-12-31" });
  });
});

describe("buildEventRecurrenceRule + expandRecurrenceInRange in nonexistent-midnight zones", () => {
  it("America/Santiago all-day series: dtstart hour is 12 and occurrences land on the expected calendar dates with no off-by-one", () => {
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=DAILY;COUNT=5",
      recurrenceTimezone: "America/Santiago",
      allDay: true,
      startsAt: null,
      startDate: "2026-09-05",
    });
    expect(rule).not.toBeNull();
    expect(rule?.dtstart.hour).toBe(12);

    const occurrences = expandRecurrenceInRange(
      rule!,
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-09-30T00:00:00.000Z"),
    );

    const days = occurrences.map((o) => o.occursLocal.day).sort((a, b) => a - b);
    expect(days).toEqual([5, 6, 7, 8, 9]);
    for (const occurrence of occurrences) {
      expect(occurrence.occursLocal.month).toBe(9);
      expect(occurrence.occursLocal.year).toBe(2026);
    }
  });

  it("Pacific/Auckland all-day series: dtstart hour is 12 and occurrences land on the expected calendar dates with no off-by-one", () => {
    const rule = buildEventRecurrenceRule({
      rrule: "FREQ=DAILY;COUNT=5",
      recurrenceTimezone: "Pacific/Auckland",
      allDay: true,
      startsAt: null,
      startDate: "2026-09-25",
    });
    expect(rule).not.toBeNull();
    expect(rule?.dtstart.hour).toBe(12);

    const occurrences = expandRecurrenceInRange(
      rule!,
      new Date("2026-09-20T00:00:00.000Z"),
      new Date("2026-10-05T00:00:00.000Z"),
    );

    const days = occurrences.map((o) => `${o.occursLocal.month}-${o.occursLocal.day}`);
    expect(days).toEqual(["9-25", "9-26", "9-27", "9-28", "9-29"]);
  });

  // Regression (Checkpoint 5.4 audit finding D1-8): an inverted span is
  // rejected upstream by EventCreateSchema and the detach handler, but this
  // shared helper must defend itself -- a negative offset would emit
  // endDate < startDate and silently drop instances from the date-overlap
  // filter that decides range membership.
  it("clamps an inverted parent span instead of emitting endDate before startDate", () => {
    const result = allDayInstanceDates(
      { year: 2026, month: 9, day: 10, hour: 12, minute: 0, second: 0 },
      "2026-09-05",
      "2026-09-01",
    );
    expect(result.startDate).toBe("2026-09-10");
    expect(result.endDate).toBe("2026-09-10");
    expect(result.endDate >= result.startDate).toBe(true);
  });
});
