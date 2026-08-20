import { describe, expect, it } from "vitest";
import type { EventRangeItem } from "@personal-os/schema";
import {
  DAYS_PER_WEEK,
  MINUTES_PER_DAY,
  getWeekDays,
  layoutWeek,
  parseCalendarDate,
} from "./week-grid-layout.js";

// Fixed for the whole file, set before any test runs and therefore before
// any Date/getHours() call this module makes (import statements have no
// runtime effect of their own here -- see week-grid-layout.ts's header
// comment on why this module is inherently local-timezone-dependent by
// design: EventRangeItem carries no per-event `timezone` field, unlike
// EventSchema). This is the same city used throughout this codebase's
// existing DST tests (packages/core/src/timezone.test.ts,
// due-date-window.test.ts) for consistency.
process.env.TZ = "America/Chicago";

function makeEntry(overrides: Partial<EventRangeItem> = {}): EventRangeItem {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Test entry",
    description: null,
    location: null,
    all_day: false,
    starts_at: null,
    ends_at: null,
    start_date: null,
    end_date: null,
    is_recurring_instance: false,
    occurs_at: null,
    occurs_ends_at: null,
    status: null,
    ...overrides,
  };
}

describe("getWeekDays", () => {
  it("returns 7 consecutive local-midnight days, Sunday-start", () => {
    // Verified externally: July 29 2026 is a Wednesday, so its week is
    // Sun Jul 26 - Sat Aug 1 2026 -- this is also the month-boundary week
    // reused below.
    const days = getWeekDays(new Date(2026, 6, 29));
    expect(days).toHaveLength(DAYS_PER_WEEK);
    expect(days.map((d) => [d.getFullYear(), d.getMonth(), d.getDate()])).toEqual([
      [2026, 6, 26],
      [2026, 6, 27],
      [2026, 6, 28],
      [2026, 6, 29],
      [2026, 6, 30],
      [2026, 6, 31],
      [2026, 7, 1],
    ]);
    for (const day of days) {
      expect(day.getHours()).toBe(0);
      expect(day.getMinutes()).toBe(0);
    }
  });
});

describe("parseCalendarDate", () => {
  it("parses a YYYY-MM-DD string as local midnight, not UTC midnight", () => {
    // `new Date("2026-08-20")` parses as UTC midnight, which under
    // America/Chicago (UTC-5/-6) converts back to Aug 19 local -- exactly
    // the bug this function exists to avoid.
    const date = parseCalendarDate("2026-08-20");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7); // August, 0-indexed
    expect(date.getDate()).toBe(20);
    expect(date.getHours()).toBe(0);
  });
});

describe("layoutWeek - day-column assignment across a month boundary", () => {
  // Week: Sun Jul 26 (index 0) .. Sat Aug 1 2026 (index 6).
  const week = new Date(2026, 6, 29);

  it("places a plain timed entry in the correct day column", () => {
    const entry = makeEntry({
      starts_at: "2026-07-29T09:15:00-05:00",
      ends_at: "2026-07-29T10:45:00-05:00",
    });
    const layout = layoutWeek(week, [entry]);
    expect(layout.timed).toEqual([
      { entry, dayIndex: 3, startMinutes: 9 * 60 + 15, endMinutes: 10 * 60 + 45 },
    ]);
  });

  it("places an entry on the far side of the month boundary in the last column", () => {
    const entry = makeEntry({
      starts_at: "2026-08-01T08:00:00-05:00",
      ends_at: "2026-08-01T09:00:00-05:00",
    });
    const layout = layoutWeek(week, [entry]);
    expect(layout.timed).toEqual([{ entry, dayIndex: 6, startMinutes: 480, endMinutes: 540 }]);
  });

  it("splits a midnight-crossing timed entry into one clipped placement per day, without dropping either half", () => {
    // 10pm Fri Jul 31 -> 2am Sat Aug 1, ordinary (non-DST) 4-hour span.
    const entry = makeEntry({
      starts_at: "2026-07-31T22:00:00-05:00",
      ends_at: "2026-08-01T02:00:00-05:00",
    });
    const layout = layoutWeek(week, [entry]);
    expect(layout.timed).toHaveLength(2);
    expect(layout.timed).toContainEqual({
      entry,
      dayIndex: 5, // Jul 31
      startMinutes: 22 * 60,
      endMinutes: MINUTES_PER_DAY, // clipped to bottom of that day's grid
    });
    expect(layout.timed).toContainEqual({
      entry,
      dayIndex: 6, // Aug 1
      startMinutes: 0, // clipped to top of that day's grid
      endMinutes: 2 * 60,
    });
  });

  it("routes an all-day entry to the all-day placements, never the timed grid", () => {
    const entry = makeEntry({ all_day: true, start_date: "2026-07-29", end_date: "2026-07-29" });
    const layout = layoutWeek(week, [entry]);
    expect(layout.allDay).toEqual([{ entry, dayIndex: 3 }]);
    expect(layout.timed).toEqual([]);
  });

  it("spans a multi-day all-day entry across every overlapping column, clipped to the displayed week", () => {
    // Jul 31 - Aug 2: Aug 2 falls outside this display week (which ends
    // Aug 1), so it must not appear as a placement at all.
    const entry = makeEntry({ all_day: true, start_date: "2026-07-31", end_date: "2026-08-02" });
    const layout = layoutWeek(week, [entry]);
    expect(layout.allDay).toEqual([
      { entry, dayIndex: 5 },
      { entry, dayIndex: 6 },
    ]);
  });

  it("positions a recurring instance by its own occurs_at/occurs_ends_at, not the parent series' starts_at/ends_at", () => {
    const entry = makeEntry({
      is_recurring_instance: true,
      // Parent series template -- a date that isn't even in this display
      // week. If the code wrongly used this, the entry would produce zero
      // placements instead of landing on Jul 29.
      starts_at: "2026-01-05T09:00:00-06:00",
      ends_at: "2026-01-05T10:00:00-06:00",
      occurs_at: "2026-07-29T14:00:00-05:00",
      occurs_ends_at: "2026-07-29T15:30:00-05:00",
    });
    const layout = layoutWeek(week, [entry]);
    expect(layout.timed).toEqual([
      { entry, dayIndex: 3, startMinutes: 14 * 60, endMinutes: 15 * 60 + 30 },
    ]);
  });

  it("gives a bare point-in-time entry (no end) a zero-length duration for the component to pad visually", () => {
    const entry = makeEntry({ starts_at: "2026-07-29T12:00:00-05:00", ends_at: null });
    const layout = layoutWeek(week, [entry]);
    expect(layout.timed).toEqual([{ entry, dayIndex: 3, startMinutes: 720, endMinutes: 720 }]);
  });
});

describe("layoutWeek - DST fall-back week (2026-11-01, America/Chicago)", () => {
  // Nov 1 2026 is itself a Sunday, so the whole 25-real-hour fall-back day
  // is entirely dayIndex 0 -- verified externally alongside the
  // month-boundary week above. Clocks fall back from 02:00 to 01:00, so
  // 01:00-01:59 occurs twice: once at CDT (UTC-5), once at CST (UTC-6).
  const dstWeek = new Date(2026, 10, 1);

  it("does not drop or misplace an entry that starts before the fall-back and ends after it", () => {
    // Wall-clock 01:00 -> 03:00, but real elapsed time is 3 hours (an
    // extra hour was inserted by the fallback). A naive elapsed-time
    // computation would wrongly place the end at wall-clock 04:00
    // (60 + 180 = 240 minutes); the grid must show 01:00-03:00, matching
    // its own 24 wall-clock-hour rows.
    const entry = makeEntry({
      starts_at: "2026-11-01T01:00:00-05:00", // pre-fallback, CDT
      ends_at: "2026-11-01T03:00:00-06:00", // post-fallback, CST
    });
    const layout = layoutWeek(dstWeek, [entry]);
    expect(layout.timed).toEqual([{ entry, dayIndex: 0, startMinutes: 60, endMinutes: 180 }]);
  });

  it("places both occurrences of the repeated ambiguous hour on the correct day, not shifted to the day before or after", () => {
    const beforeFallback = makeEntry({
      id: "00000000-0000-0000-0000-000000000002",
      starts_at: "2026-11-01T01:30:00-05:00",
      ends_at: "2026-11-01T01:45:00-05:00",
    });
    const afterFallback = makeEntry({
      id: "00000000-0000-0000-0000-000000000003",
      starts_at: "2026-11-01T01:30:00-06:00",
      ends_at: "2026-11-01T01:45:00-06:00",
    });
    const layout = layoutWeek(dstWeek, [beforeFallback, afterFallback]);
    // Both real (different) instants render at the same wall-clock slot --
    // an inherent limit of any hour-row grid on the transition day, not a
    // bug -- but critically, both land on dayIndex 0 (Nov 1), not on
    // Oct 31 or Nov 2, and neither is silently dropped.
    expect(layout.timed).toHaveLength(2);
    for (const placement of layout.timed) {
      expect(placement.dayIndex).toBe(0);
      expect(placement.startMinutes).toBe(90);
      expect(placement.endMinutes).toBe(105);
    }
  });

  it("still assigns the correct day and time to an ordinary entry later that same DST week", () => {
    const entry = makeEntry({
      starts_at: "2026-11-04T09:00:00-06:00", // Wed Nov 4, already CST
      ends_at: "2026-11-04T09:30:00-06:00",
    });
    const layout = layoutWeek(dstWeek, [entry]);
    expect(layout.timed).toEqual([{ entry, dayIndex: 3, startMinutes: 540, endMinutes: 570 }]);
  });
});
