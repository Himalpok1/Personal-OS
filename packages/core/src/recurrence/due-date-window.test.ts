import { describe, expect, it } from "vitest";
import { expandDueDateWindow } from "./due-date-window.js";

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
