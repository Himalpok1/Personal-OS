import { describe, expect, it } from "vitest";
import { expandDueDateWindow, expandRecurrenceInRange } from "./due-date-window.js";

describe("expandDueDateWindow", () => {
  it("keeps wall-clock time fixed and shifts the UTC offset by exactly one hour across a DST fall-back", () => {
    // 9am on the 15th of every month, America/Chicago. Window spans the
    // 2026-11-01 fall-back, so October's occurrence is CDT (UTC-5) and
    // November's is CST (UTC-6).
    const now = new Date("2026-10-01T00:00:00.000Z");
    const occurrences = expandDueDateWindow(
      {
        rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2026, month: 1, day: 15, hour: 9, minute: 0, second: 0 },
      },
      60,
      now,
    );

    const october = occurrences.find((o) => o.occursLocal.month === 10);
    const november = occurrences.find((o) => o.occursLocal.month === 11);
    expect(october).toBeDefined();
    expect(november).toBeDefined();

    // Wall-clock stays 9:00 both times.
    expect(october?.occursLocal).toMatchObject({ hour: 9, minute: 0 });
    expect(november?.occursLocal).toMatchObject({ hour: 9, minute: 0 });

    // UTC instant shifts by exactly one hour (CDT UTC-5 -> CST UTC-6).
    expect(october?.occursAt.toISOString()).toBe("2026-10-15T14:00:00.000Z");
    expect(november?.occursAt.toISOString()).toBe("2026-11-15T15:00:00.000Z");
  });

  it("excludes dates listed in recurrenceExdates", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const occurrences = expandDueDateWindow(
      {
        rrule: "FREQ=WEEKLY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2026, month: 1, day: 5, hour: 9, minute: 0, second: 0 },
        recurrenceExdates: ["2026-01-12"],
      },
      21,
      now,
    );
    const days = occurrences.map((o) => o.occursLocal.day);
    expect(days).not.toContain(12);
    expect(days).toContain(5);
    expect(days).toContain(19);
  });

  it("respects recurrenceUntil as a real-instant cutoff", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const occurrences = expandDueDateWindow(
      {
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2026, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
        recurrenceUntil: new Date("2026-01-04T00:00:00.000Z"),
      },
      30,
      now,
    );
    for (const occurrence of occurrences) {
      expect(occurrence.occursAt.getTime()).toBeLessThanOrEqual(
        new Date("2026-01-04T00:00:00.000Z").getTime(),
      );
    }
    expect(occurrences.length).toBeGreaterThan(0);
  });

  it("respects recurrenceCount", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const occurrences = expandDueDateWindow(
      {
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2026, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
        recurrenceCount: 3,
      },
      365,
      now,
    );
    expect(occurrences).toHaveLength(3);
  });

  it("only returns occurrences on or after now, within the window", () => {
    // One full day after June 1's 9am-Chicago occurrence, so it's
    // unambiguously in the past regardless of that day's UTC offset.
    const now = new Date("2026-06-02T00:00:00.000Z");
    const occurrences = expandDueDateWindow(
      {
        rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2020, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
      },
      35,
      now,
    );
    for (const occurrence of occurrences) {
      expect(occurrence.occursAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
      expect(occurrence.occursAt.getTime()).toBeLessThanOrEqual(
        now.getTime() + 35 * 24 * 60 * 60 * 1000,
      );
    }
    // Should include July 1 (within 35 days) but not June 1 (already past).
    expect(occurrences.some((o) => o.occursLocal.month === 7 && o.occursLocal.day === 1)).toBe(
      true,
    );
    expect(occurrences.some((o) => o.occursLocal.month === 6 && o.occursLocal.day === 1)).toBe(
      false,
    );
  });
});

describe("expandRecurrenceInRange", () => {
  it("returns occurrences for a range entirely in the past, relative to no 'now'", () => {
    // Daily rule starting 2020-01-01; request a range last month (July
    // 2026) even though "today" in this test's other cases is 2026-08-20 --
    // expandRecurrenceInRange has no now-floor at all, so a wholly-past
    // range must still return real occurrences.
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-31T23:59:59.999Z");
    const occurrences = expandRecurrenceInRange(
      {
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2020, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
      },
      from,
      to,
    );
    expect(occurrences.length).toBe(31);
    for (const occurrence of occurrences) {
      expect(occurrence.occursAt.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(occurrence.occursAt.getTime()).toBeLessThanOrEqual(to.getTime());
    }
  });

  it("keeps wall-clock time fixed and shifts the UTC offset across a DST fall-back, for an arbitrary range", () => {
    // Same reference transition as expandDueDateWindow's DST test
    // (2026-11-01 America/Chicago fall-back), but driven through explicit
    // from/to instants rather than a windowDays/now pair.
    const from = new Date("2026-10-01T00:00:00.000Z");
    const to = new Date("2026-11-30T23:59:59.999Z");
    const occurrences = expandRecurrenceInRange(
      {
        rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2026, month: 1, day: 15, hour: 9, minute: 0, second: 0 },
      },
      from,
      to,
    );

    const october = occurrences.find((o) => o.occursLocal.month === 10);
    const november = occurrences.find((o) => o.occursLocal.month === 11);
    expect(october).toBeDefined();
    expect(november).toBeDefined();

    expect(october?.occursLocal).toMatchObject({ hour: 9, minute: 0 });
    expect(november?.occursLocal).toMatchObject({ hour: 9, minute: 0 });

    expect(october?.occursAt.toISOString()).toBe("2026-10-15T14:00:00.000Z");
    expect(november?.occursAt.toISOString()).toBe("2026-11-15T15:00:00.000Z");
  });

  it("returns empty when recurrenceCount is already exhausted before the requested range starts", () => {
    // 3 daily occurrences starting 2026-01-01 (so the series ends by
    // 2026-01-03); request a range that starts well after that.
    const occurrences = expandRecurrenceInRange(
      {
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2026, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
        recurrenceCount: 3,
      },
      new Date("2026-02-01T00:00:00.000Z"),
      new Date("2026-02-28T23:59:59.999Z"),
    );
    expect(occurrences).toHaveLength(0);
  });

  it("returns correct occurrences for an open-ended rule queried far beyond any 90-day pre-generation window", () => {
    // No recurrenceUntil/recurrenceCount at all. Query a month more than a
    // year out -- expandRecurrenceInRange has no window-size limitation of
    // its own, unlike expandDueDateWindow's rolling window.
    const from = new Date("2028-03-01T00:00:00.000Z");
    const to = new Date("2028-03-31T23:59:59.999Z");
    const occurrences = expandRecurrenceInRange(
      {
        rrule: "FREQ=MONTHLY;BYMONTHDAY=10",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2026, month: 1, day: 10, hour: 9, minute: 0, second: 0 },
      },
      from,
      to,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.occursLocal).toMatchObject({ year: 2028, month: 3, day: 10 });
  });

  it("excludes recurrenceExdates within an arbitrary requested range", () => {
    const occurrences = expandRecurrenceInRange(
      {
        rrule: "FREQ=WEEKLY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
        dtstart: { year: 2026, month: 1, day: 5, hour: 9, minute: 0, second: 0 },
        recurrenceExdates: ["2026-01-12"],
      },
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-31T23:59:59.999Z"),
    );
    const days = occurrences.map((o) => o.occursLocal.day);
    expect(days).not.toContain(12);
    expect(days).toContain(5);
    expect(days).toContain(19);
    expect(days).toContain(26);
  });
});
