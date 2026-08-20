// Also serves as Checkpoint 4.2's Step 1 date-fns-under-Node verification:
// startOfMonth/endOfMonth/startOfWeek/endOfWeek/addDays/startOfDay/format are
// all exercised for real here (not mocked), against real assertions, not
// just "it didn't throw". See apps/mobile's calendar/README note (or
// docs/STATUS.md's Checkpoint 4.2 entry) for the companion web-bundle check,
// which vitest alone cannot prove.
//
// process.env.TZ is pinned below so this suite is deterministic in CI
// regardless of the host's local timezone -- grid-math.ts's bucketing is
// intentionally LOCAL-DEVICE-TIMEZONE based (see that file's top comment),
// so the tests need a fixed local zone to assert against, the same way a
// real device has one fixed zone at any given moment. America/Chicago
// matches the rest of this codebase's DST fixtures
// (due-date-window.test.ts's 2026-11-01 fall-back). It's set immediately
// after the imports below (execution order, not import order, is what
// matters -- grid-math.ts reads the system TZ per-call, not at import time)
// so it runs before any test body does.

import { describe, expect, it } from "vitest";
import type { EventRangeItem } from "@personal-os/schema";
import { dayKey, getMonthGridDays, groupEntriesByDay } from "./grid-math";

process.env.TZ = "America/Chicago";

function entry(overrides: Partial<EventRangeItem> = {}): EventRangeItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
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

describe("getMonthGridDays", () => {
  it("produces a complete set of full weeks for a month with a partial leading/trailing week", () => {
    // November 2026: Nov 1 is a Sunday, Nov 30 is a Monday -- so the grid
    // needs zero leading days but several trailing days from December to
    // complete the final week.
    const days = getMonthGridDays(new Date(2026, 10, 15)); // any date in November

    expect(days.length % 7).toBe(0);
    expect(days[0]).toEqual(new Date(2026, 10, 1)); // Nov 1, no leading Oct days needed
    const last = days[days.length - 1];
    expect(last.getMonth()).toBe(11); // spills into December
    expect(last.getFullYear()).toBe(2026);

    // Every day is a distinct, consecutive calendar date. Deliberately NOT
    // asserting a fixed 24h ms difference here -- this grid spans the
    // 2026-11-01 DST fall-back, where local-midnight-to-local-midnight is a
    // real 25-hour interval, and asserting raw ms would be testing the DST
    // transition instead of the day-sequencing this test actually cares
    // about.
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1];
      const cur = days[i];
      const expectedNext = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
      expect(cur).toEqual(expectedNext);
    }
  });

  it("produces leading days from the prior month when the 1st isn't the start of the week", () => {
    // February 2026: Feb 1 is a Sunday too in this year -- pick a month
    // where the 1st falls mid-week instead. March 2026: March 1 is a Sunday
    // as well; use January 2026, where Jan 1 is a Thursday.
    const days = getMonthGridDays(new Date(2026, 0, 15));
    expect(days[0].getMonth()).toBe(11); // leading days spill into December 2025
    expect(days[0].getFullYear()).toBe(2025);
    expect(days.some((d) => d.getMonth() === 0 && d.getDate() === 1)).toBe(true);
  });
});

describe("groupEntriesByDay", () => {
  const rangeStart = new Date(2026, 10, 1);
  const rangeEnd = new Date(2026, 11, 5);

  it("buckets an all-day entry without a timezone-driven off-by-one", () => {
    // If start_date were parsed as UTC midnight (new Date("2026-11-10")),
    // reading it back in America/Chicago (UTC-6 in November) would shift it
    // to Nov 9 -- exactly the class of bug this function guards against.
    const e = entry({ all_day: true, start_date: "2026-11-10", end_date: "2026-11-10" });
    const buckets = groupEntriesByDay([e], rangeStart, rangeEnd);

    expect(buckets.get("2026-11-10")).toEqual([e]);
    expect(buckets.get("2026-11-09")).toBeUndefined();
  });

  it("renders a multi-day entry on every day it overlaps, including across a month boundary", () => {
    const e = entry({
      all_day: true,
      start_date: "2026-11-29",
      end_date: "2026-12-02",
    });
    const buckets = groupEntriesByDay([e], rangeStart, rangeEnd);

    expect(buckets.get("2026-11-29")).toEqual([e]);
    expect(buckets.get("2026-11-30")).toEqual([e]);
    expect(buckets.get("2026-12-01")).toEqual([e]);
    expect(buckets.get("2026-12-02")).toEqual([e]);
    expect(buckets.get("2026-12-03")).toBeUndefined();
  });

  it("buckets a recurring instance to its actual occurrence day, not the parent's starts_at", () => {
    const e = entry({
      is_recurring_instance: true,
      // Parent series template -- deliberately a different day than the
      // instance, to prove occurs_at/occurs_ends_at win.
      starts_at: "2026-01-05T15:00:00.000Z",
      ends_at: "2026-01-05T15:30:00.000Z",
      occurs_at: "2026-11-16T15:00:00.000Z", // 9:00am CST
      occurs_ends_at: "2026-11-16T15:30:00.000Z",
      status: "scheduled",
    });
    const buckets = groupEntriesByDay([e], rangeStart, rangeEnd);

    expect(buckets.get("2026-11-16")).toEqual([e]);
    expect(buckets.get("2026-01-05")).toBeUndefined();
  });

  it("buckets a one-off timed entry using starts_at/ends_at", () => {
    const e = entry({ starts_at: "2026-11-12T14:00:00.000Z", ends_at: "2026-11-12T14:30:00.000Z" });
    const buckets = groupEntriesByDay([e], rangeStart, rangeEnd);
    expect(buckets.get("2026-11-12")).toEqual([e]);
  });

  it("does not shift an occurrence's calendar day across the 2026-11-01 DST fall-back", () => {
    // Grid bucketing only cares about the LOCAL calendar day, and JS Date
    // correctly resolves the local offset (CDT before, CST after) on either
    // side of the fall-back -- so an instant just before local midnight and
    // one just after should each land on the correct, unambiguous day
    // regardless of which side of the transition they're on. This is really
    // confirming DST does NOT perturb day-bucketing (unlike the UTC-instant
    // shift that matters for packages/core's authoritative reminder
    // scheduling), which is the property worth asserting explicitly here.
    const beforeFallback = entry({
      is_recurring_instance: true,
      occurs_at: "2026-11-01T05:30:00.000Z", // 00:30 CDT (fall-back is 2am local)
      occurs_ends_at: "2026-11-01T06:00:00.000Z",
    });
    const afterFallback = entry({
      is_recurring_instance: true,
      occurs_at: "2026-11-01T09:00:00.000Z", // 03:00 CST
      occurs_ends_at: "2026-11-01T09:30:00.000Z",
    });
    const buckets = groupEntriesByDay([beforeFallback, afterFallback], rangeStart, rangeEnd);

    const nov1 = buckets.get("2026-11-01") ?? [];
    expect(nov1).toHaveLength(2);
    expect(nov1).toContain(beforeFallback);
    expect(nov1).toContain(afterFallback);
  });

  it("clips a span to the requested range and skips entries with no resolvable date", () => {
    const outOfRange = entry({ starts_at: "2026-01-01T12:00:00.000Z" });
    const noDate = entry({ all_day: true, start_date: null });
    const buckets = groupEntriesByDay([outOfRange, noDate], rangeStart, rangeEnd);
    expect(buckets.size).toBe(0);
  });
});

describe("dayKey", () => {
  it("formats as yyyy-MM-dd", () => {
    expect(dayKey(new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});
