import { describe, expect, it } from "vitest";
import { wallClockToNaiveDate } from "../timezone.js";
import {
  computeNextLazyOccurrence,
  validateCompletionAnchoredRule,
  wallTimeOfNaiveTimestamp,
} from "./lazy-next-occurrence.js";

describe("computeNextLazyOccurrence", () => {
  it("anchors the next occurrence from a late completion, not the original expected date", () => {
    // "Water the plants every 3 days" -- completed 10 days after it was
    // last done. The next occurrence must be 3 days from the actual
    // completion instant, not 3 days from whenever it was originally due.
    const lateCompletion = new Date("2026-01-11T15:00:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "America/Chicago" },
      lateCompletion,
      "completed",
    );
    expect(result.occursAt.getTime() - lateCompletion.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("anchors the next occurrence from a skip the same way as a completion", () => {
    const skippedAt = new Date("2026-01-11T15:00:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "America/Chicago" },
      skippedAt,
      "skipped",
    );
    expect(result.occursAt.getTime() - skippedAt.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("preserves wall-clock time across a DST boundary crossed by the interval", () => {
    // 2026-10-30 is close enough to the Nov 1 fall-back that a 3-day
    // interval crosses it.
    const completedAt = new Date("2026-10-30T14:00:00.000Z"); // 9am CDT
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "America/Chicago" },
      completedAt,
      "completed",
    );
    expect(result.occursLocal).toMatchObject({ hour: 9, minute: 0 });
    // Nov 2, 9am CST (UTC-6) = 15:00 UTC, not 14:00.
    expect(result.occursAt.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });
});

describe("validateCompletionAnchoredRule", () => {
  it("accepts FREQ/INTERVAL-only rules", () => {
    expect(() => validateCompletionAnchoredRule("FREQ=DAILY;INTERVAL=3")).not.toThrow();
  });

  it("rejects BYDAY on a completion-anchored rule", () => {
    expect(() => validateCompletionAnchoredRule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toThrow(
      /FREQ\/INTERVAL/,
    );
  });

  it("rejects BYMONTHDAY on a completion-anchored rule", () => {
    expect(() => validateCompletionAnchoredRule("FREQ=MONTHLY;BYMONTHDAY=1")).toThrow(
      /FREQ\/INTERVAL/,
    );
  });

  // Checkpoint 9.3: the check used to look at part NAMES only, so every rule
  // below passed write-time validation and then threw -- or, for a negative
  // interval, never returned -- inside computeNextLazyOccurrence at the moment
  // the owner completed the task. Each of these must now fail at write time.
  describe("rejects rules the old name-only check accepted (9.3)", () => {
    it.each([
      ["unknown FREQ", "FREQ=WEEKLYY", /unknown FREQ/],
      ["lowercase unknown FREQ", "FREQ=fortnightly", /unknown FREQ/],
      ["missing FREQ", "INTERVAL=2", /require FREQ/],
      ["INTERVAL=0", "FREQ=DAILY;INTERVAL=0", /INTERVAL must be a positive integer/],
      ["negative INTERVAL", "FREQ=DAILY;INTERVAL=-1", /INTERVAL must be a positive integer/],
      ["non-numeric INTERVAL", "FREQ=DAILY;INTERVAL=abc", /INTERVAL must be a positive integer/],
      ["fractional INTERVAL", "FREQ=DAILY;INTERVAL=1.5", /INTERVAL must be a positive integer/],
      ["empty INTERVAL", "FREQ=DAILY;INTERVAL=", /INTERVAL must be a positive integer/],
      ["duplicate FREQ", "FREQ=DAILY;FREQ=WEEKLY", /repeats "FREQ"/],
      ["empty part (trailing semicolon)", "FREQ=DAILY;", /FREQ\/INTERVAL/],
      ["part with no value", "FREQ=DAILY;INTERVAL", /has no value/],
      ["unknown WKST", "FREQ=WEEKLY;WKST=XX", /unknown WKST/],
      // 9.4 review: rrule iterates only to MAXYEAR (9999), so an unbounded
      // INTERVAL lets `after()` return null downstream. 1000 is the cap.
      ["INTERVAL above the cap", "FREQ=DAILY;INTERVAL=1001", /INTERVAL must be at most 1000/],
      ["absurd INTERVAL", "FREQ=YEARLY;INTERVAL=99999", /INTERVAL must be at most 1000/],
    ])("%s: %s", (_label, rrule, pattern) => {
      expect(() => validateCompletionAnchoredRule(rrule)).toThrow(pattern);
    });

    it("accepts INTERVAL exactly at the cap", () => {
      expect(() => validateCompletionAnchoredRule("FREQ=DAILY;INTERVAL=1000")).not.toThrow();
      expect(() => validateCompletionAnchoredRule("FREQ=YEARLY;INTERVAL=1000")).not.toThrow();
    });

    it("still accepts every RFC 5545 frequency, case-insensitively, with WKST and an RRULE: prefix", () => {
      for (const freq of [
        "SECONDLY",
        "MINUTELY",
        "HOURLY",
        "DAILY",
        "WEEKLY",
        "MONTHLY",
        "YEARLY",
      ]) {
        expect(() => validateCompletionAnchoredRule(`FREQ=${freq};INTERVAL=2`)).not.toThrow();
      }
      expect(() => validateCompletionAnchoredRule("freq=weekly;interval=1;wkst=su")).not.toThrow();
      expect(() => validateCompletionAnchoredRule("RRULE:FREQ=DAILY")).not.toThrow();
    });
  });

  it("computeNextLazyOccurrence refuses a zero or negative INTERVAL up front instead of spinning or returning nothing", () => {
    const from = new Date("2026-06-01T14:00:00.000Z");
    expect(() =>
      computeNextLazyOccurrence(
        { rrule: "FREQ=YEARLY;INTERVAL=8000", recurrenceTimezone: "America/Chicago" },
        from,
        "completed",
      ),
    ).toThrow(/INTERVAL must be at most 1000/);
    expect(() =>
      computeNextLazyOccurrence(
        { rrule: "FREQ=DAILY;INTERVAL=0", recurrenceTimezone: "America/Chicago" },
        from,
        "completed",
      ),
    ).toThrow(/INTERVAL must be a positive integer/);
    expect(() =>
      computeNextLazyOccurrence(
        { rrule: "FREQ=DAILY;INTERVAL=-1", recurrenceTimezone: "America/Chicago" },
        from,
        "completed",
      ),
    ).toThrow(/INTERVAL must be a positive integer/);
    expect(() =>
      computeNextLazyOccurrence(
        { rrule: "FREQ=WEEKLYY", recurrenceTimezone: "America/Chicago" },
        from,
        "completed",
      ),
    ).toThrow(/unknown FREQ/);
  });
});

// Checkpoint 9.4: the successor keeps the PREVIOUS occurrence's wall-clock
// time-of-day, not the instant the owner tapped Done. Without `opts` the
// function is byte-identical to before (pinned below), so the worker's
// belt-and-braces re-check and the API's in-transaction insert can only
// disagree if one of them forgets to pass wallTime -- which is the reason the
// contract requires both to pass it.
describe("computeNextLazyOccurrence with opts.wallTime (9.4)", () => {
  const CHICAGO = "America/Chicago";
  const NINE = { hour: 9, minute: 0, second: 0 };

  it("without opts is byte-identical to the pre-9.4 behaviour", () => {
    const from = new Date("2026-03-08T02:47:00.000Z"); // 2026-03-07 20:47 CST
    const rule = { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO };
    const legacy = computeNextLazyOccurrence(rule, from, "completed");
    const explicitUndefined = computeNextLazyOccurrence(rule, from, "completed", {});
    expect(explicitUndefined).toEqual(legacy);
    expect(legacy.occursLocal).toEqual({
      year: 2026,
      month: 3,
      day: 10,
      hour: 20,
      minute: 47,
      second: 0,
    });
    // 2026-03-10 20:47 CDT (UTC-5) = 2026-03-11 01:47Z, 71 elapsed hours.
    expect(legacy.occursAt.toISOString()).toBe("2026-03-11T01:47:00.000Z");
  });

  it("completed at 21:47 local with wallTime 09:00, FREQ=DAILY;INTERVAL=3 → +3 days at 09:00", () => {
    const completedAt = new Date("2026-06-11T02:47:00.000Z"); // 2026-06-10 21:47 CDT
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toEqual({
      year: 2026,
      month: 6,
      day: 13,
      hour: 9,
      minute: 0,
      second: 0,
    });
    expect(result.occursAt.toISOString()).toBe("2026-06-13T14:00:00.000Z");
  });

  it("the date anchors on the completion's LOCAL date even when UTC has rolled over", () => {
    // 2026-06-10 21:47 CDT is already 06-11 in UTC; +3 local days is 06-13, not 06-14.
    const completedAt = new Date("2026-06-11T02:47:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal.day).toBe(13);
  });

  it("skipped anchors identically to completed", () => {
    const at = new Date("2026-06-11T02:47:00.000Z");
    const rule = { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO };
    expect(computeNextLazyOccurrence(rule, at, "skipped", { wallTime: NINE })).toEqual(
      computeNextLazyOccurrence(rule, at, "completed", { wallTime: NINE }),
    );
  });

  it("crosses the 2026-03-08 spring-forward keeping 09:00 wall clock (CST → CDT)", () => {
    // Completed Fri 2026-03-06 18:30 CST; every 3 days → Mon 03-09 09:00 CDT = 14:00Z.
    const completedAt = new Date("2026-03-07T00:30:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ month: 3, day: 9, hour: 9, minute: 0 });
    expect(result.occursAt.toISOString()).toBe("2026-03-09T14:00:00.000Z");
  });

  it("lands ON the spring-forward day at 09:00 CDT", () => {
    // Completed Thu 2026-03-05 22:00 CST; +3 days = Sun 03-08 09:00, which is CDT (14:00Z).
    const completedAt = new Date("2026-03-06T04:00:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ month: 3, day: 8, hour: 9 });
    expect(result.occursAt.toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });

  it("crosses the 2026-11-01 fall-back keeping 09:00 wall clock (CDT → CST)", () => {
    // Completed Fri 2026-10-30 23:15 CDT; +3 days → Mon 11-02 09:00 CST = 15:00Z.
    const completedAt = new Date("2026-10-31T04:15:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ month: 11, day: 2, hour: 9, minute: 0 });
    expect(result.occursAt.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("weekly: +7 local days at the wall time, across the fall-back", () => {
    // Completed Wed 2026-10-28 21:47 CDT → Wed 11-04 09:00 CST = 15:00Z.
    const completedAt = new Date("2026-10-29T02:47:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=WEEKLY", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toEqual({
      year: 2026,
      month: 11,
      day: 4,
      hour: 9,
      minute: 0,
      second: 0,
    });
    expect(result.occursAt.toISOString()).toBe("2026-11-04T15:00:00.000Z");
  });

  it("monthly from Jan 31 CLAMPS to Feb 28 (not rrule's skip to Mar 31) — pinned", () => {
    // With wallTime the step is calendar arithmetic, not an rrule iteration:
    // rrule would give a MONTHLY rule anchored on the 31st an implicit
    // BYMONTHDAY=31 and skip February entirely, landing on Mar 31. "Every
    // month after I complete it", completed on Jan 31, means February -- so
    // the day is clamped to the target month's length. See the module
    // header for why the clamp reads the completion date's day every time.
    const completedAt = new Date("2026-02-01T03:47:00.000Z"); // 2026-01-31 21:47 CST
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=MONTHLY", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toEqual({
      year: 2026,
      month: 2,
      day: 28,
      hour: 9,
      minute: 0,
      second: 0,
    });
    expect(result.occursAt.toISOString()).toBe("2026-02-28T15:00:00.000Z"); // CST
  });

  it("monthly clamp drifts to the 28th from the COMPLETION date's day: done Feb 28 → Mar 28 — pinned", () => {
    // The anchor is always the instant the owner acted; there is no
    // remembered "I meant month-end". Done on Feb 28 → Mar 28, not Mar 31.
    const completedAt = new Date("2026-02-28T20:00:00.000Z"); // 2026-02-28 14:00 CST
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=MONTHLY", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ year: 2026, month: 3, day: 28, hour: 9 });
  });

  it("monthly from Jan 31 in a leap year clamps to Feb 29", () => {
    const completedAt = new Date("2028-01-31T20:00:00.000Z"); // 2028-01-31 14:00 CST
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=MONTHLY", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ year: 2028, month: 2, day: 29, hour: 9 });
  });

  it("monthly INTERVAL=3 from Nov 30 crosses the year and clamps: → Feb 28", () => {
    const completedAt = new Date("2026-11-30T20:00:00.000Z"); // 2026-11-30 14:00 CST
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=MONTHLY;INTERVAL=3", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ year: 2027, month: 2, day: 28, hour: 9 });
    expect(result.occursAt.toISOString()).toBe("2027-02-28T15:00:00.000Z");
  });

  it("yearly from Feb 29 clamps to Feb 28 the following year", () => {
    const completedAt = new Date("2028-02-29T20:00:00.000Z"); // 2028-02-29 14:00 CST
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=YEARLY", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ year: 2029, month: 2, day: 28, hour: 9 });
  });

  it("weekly INTERVAL=2 is +14 local days", () => {
    const completedAt = new Date("2026-06-11T02:47:00.000Z"); // Wed 2026-06-10 21:47 CDT
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=WEEKLY;INTERVAL=2", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ year: 2026, month: 6, day: 24, hour: 9 });
  });

  it("a sub-daily FREQ with wallTime keeps the pre-9.4 rrule iteration from the substituted time", () => {
    // Nothing in the product writes one, but the grammar allows it and it
    // must not become a new failure mode: HOURLY;INTERVAL=6 from 09:00 → 15:00.
    const completedAt = new Date("2026-06-11T02:47:00.000Z"); // 2026-06-10 21:47 CDT
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=HOURLY;INTERVAL=6", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toEqual({
      year: 2026,
      month: 6,
      day: 10,
      hour: 15,
      minute: 0,
      second: 0,
    });
  });

  it("monthly from Jan 15 lands on Feb 15 at the wall time", () => {
    const completedAt = new Date("2026-01-16T03:47:00.000Z"); // 2026-01-15 21:47 CST
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=MONTHLY", recurrenceTimezone: CHICAGO },
      completedAt,
      "completed",
      { wallTime: { hour: 7, minute: 30, second: 15 } },
    );
    expect(result.occursLocal).toEqual({
      year: 2026,
      month: 2,
      day: 15,
      hour: 7,
      minute: 30,
      second: 15,
    });
    expect(result.occursAt.toISOString()).toBe("2026-02-15T13:30:15.000Z");
  });

  it("Pacific/Auckland: wall time survives the April NZDT → NZST fall-back", () => {
    // Completed Fri 2026-04-03 22:10 NZDT (UTC+13); every 3 days → Mon 04-06 09:00 NZST (UTC+12).
    const completedAt = new Date("2026-04-03T09:10:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "Pacific/Auckland" },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ month: 4, day: 6, hour: 9 });
    expect(result.occursAt.toISOString()).toBe("2026-04-05T21:00:00.000Z");
  });

  it("Europe/London: wall time survives the March GMT → BST spring-forward", () => {
    // Completed Fri 2026-03-27 23:30 GMT; every 3 days → Mon 03-30 09:00 BST = 08:00Z.
    const completedAt = new Date("2026-03-27T23:30:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "Europe/London" },
      completedAt,
      "completed",
      { wallTime: NINE },
    );
    expect(result.occursLocal).toMatchObject({ month: 3, day: 30, hour: 9 });
    expect(result.occursAt.toISOString()).toBe("2026-03-30T08:00:00.000Z");
  });

  it("API-style and worker-style callers compute the identical successor from the same inputs", () => {
    // The two writers of a successor must agree byte-for-byte or the
    // belt-and-braces job inserts a second row at a different instant.
    const rule = { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO };
    const completedAt = new Date("2026-06-11T02:47:00.000Z");
    const occursLocalOfCompletedRow = { hour: 9, minute: 0, second: 0 }; // from occurrences.occurs_local
    const api = computeNextLazyOccurrence(rule, completedAt, "completed", {
      wallTime: occursLocalOfCompletedRow,
    });
    const worker = computeNextLazyOccurrence(rule, new Date(completedAt.getTime()), "completed", {
      wallTime: { ...occursLocalOfCompletedRow },
    });
    expect(worker.occursAt.getTime()).toBe(api.occursAt.getTime());
    expect(worker.occursLocal).toEqual(api.occursLocal);
  });

  it("rejects a wallTime outside 00:00:00–23:59:59", () => {
    const from = new Date("2026-06-11T02:47:00.000Z");
    const rule = { rrule: "FREQ=DAILY", recurrenceTimezone: CHICAGO };
    for (const wallTime of [
      { hour: 24, minute: 0, second: 0 },
      { hour: -1, minute: 0, second: 0 },
      { hour: 9, minute: 60, second: 0 },
      { hour: 9, minute: 0, second: 60 },
      { hour: 9.5, minute: 0, second: 0 },
    ]) {
      expect(() => computeNextLazyOccurrence(rule, from, "completed", { wallTime })).toThrow(
        /wallTime is not a valid time of day/,
      );
    }
  });
});

// Checkpoint 9.4 review (blocker): with wallTime the successor is
// localDate(completion) + INTERVAL at the wall time, so completing a row
// INTERVAL days (or more) EARLY lands the successor at or before the
// completed row's own occurs_at. That instant already exists for the parent,
// the insert is onConflictDoNothing against occurrences_parent_occurs_at_key,
// and the series silently ends. `opts.after` -- the completed row's occurs_at
// -- is the exclusive lower bound that closes it.
describe("computeNextLazyOccurrence with opts.after (9.4 review)", () => {
  const CHICAGO = "America/Chicago";
  const NINE = { hour: 9, minute: 0, second: 0 };
  const EVERY_3_DAYS = { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: CHICAGO };
  // The open occurrence: Thu 2026-06-11 09:00 CDT.
  const SEED_THU = new Date("2026-06-11T14:00:00.000Z");

  it("reviewer repro: seed Thu 09:00 completed on Mon → candidate Thu 09:00 == after → Sun 09:00", () => {
    const completedMon = new Date("2026-06-08T15:15:00.000Z"); // Mon 06-08 10:15 CDT
    const result = computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed", {
      wallTime: NINE,
      after: SEED_THU,
    });
    expect(result.occursLocal).toEqual({
      year: 2026,
      month: 6,
      day: 14,
      hour: 9,
      minute: 0,
      second: 0,
    });
    expect(result.occursAt.toISOString()).toBe("2026-06-14T14:00:00.000Z");
    // And the same call WITHOUT the bound is exactly the colliding instant.
    expect(
      computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed", {
        wallTime: NINE,
      }).occursAt.getTime(),
    ).toBe(SEED_THU.getTime());
  });

  it("early by one day: completed Wed → Sat (candidate already clears the bound)", () => {
    const completedWed = new Date("2026-06-10T15:15:00.000Z"); // Wed 06-10 10:15 CDT
    const result = computeNextLazyOccurrence(EVERY_3_DAYS, completedWed, "completed", {
      wallTime: NINE,
      after: SEED_THU,
    });
    expect(result.occursLocal).toMatchObject({ month: 6, day: 13, hour: 9 });
  });

  it("late by five days: completed the following Tue → Fri, completion + 3", () => {
    const completedTue = new Date("2026-06-16T15:15:00.000Z"); // Tue 06-16 10:15 CDT
    const result = computeNextLazyOccurrence(EVERY_3_DAYS, completedTue, "completed", {
      wallTime: NINE,
      after: SEED_THU,
    });
    expect(result.occursLocal).toMatchObject({ month: 6, day: 19, hour: 9 });
  });

  it("early by more than one interval steps by whole intervals from the completion", () => {
    // Completed Thu 06-04, a week early: 06-07 and 06-10 are both ≤ Thu 06-11
    // 09:00, so the successor is 06-13 -- three steps from the completion,
    // keeping the every-3-days cadence anchored on the owner's action.
    const completedEarly = new Date("2026-06-04T15:15:00.000Z");
    const result = computeNextLazyOccurrence(EVERY_3_DAYS, completedEarly, "completed", {
      wallTime: NINE,
      after: SEED_THU,
    });
    expect(result.occursLocal).toMatchObject({ month: 6, day: 13, hour: 9 });
  });

  it("skipped honours the bound identically to completed", () => {
    const completedMon = new Date("2026-06-08T15:15:00.000Z");
    expect(
      computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "skipped", {
        wallTime: NINE,
        after: SEED_THU,
      }),
    ).toEqual(
      computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed", {
        wallTime: NINE,
        after: SEED_THU,
      }),
    );
  });

  it("a bound BEFORE the candidate changes nothing", () => {
    const completedMon = new Date("2026-06-08T15:15:00.000Z");
    const unbounded = computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed", {
      wallTime: NINE,
    });
    const bounded = computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed", {
      wallTime: NINE,
      after: new Date("2026-06-01T14:00:00.000Z"),
    });
    expect(bounded).toEqual(unbounded);
  });

  it("the bound is exclusive to the millisecond", () => {
    const completedMon = new Date("2026-06-08T15:15:00.000Z");
    const justBefore = new Date(SEED_THU.getTime() - 1);
    expect(
      computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed", {
        wallTime: NINE,
        after: justBefore,
      }).occursAt.getTime(),
    ).toBe(SEED_THU.getTime());
  });

  it("same-day completion across the 2026-03-08 spring-forward: Sat 08:00 CST done, seed Tue 09:00 CDT → Fri 09:00 CDT", () => {
    const seedTue = new Date("2026-03-10T14:00:00.000Z"); // Tue 03-10 09:00 CDT
    const completedSat = new Date("2026-03-07T14:00:00.000Z"); // Sat 03-07 08:00 CST
    const result = computeNextLazyOccurrence(EVERY_3_DAYS, completedSat, "completed", {
      wallTime: NINE,
      after: seedTue,
    });
    expect(result.occursLocal).toMatchObject({ month: 3, day: 13, hour: 9, minute: 0 });
    expect(result.occursAt.toISOString()).toBe("2026-03-13T14:00:00.000Z");
  });

  it("same-day completion across the 2026-11-01 fall-back: Sat 08:00 CDT done, seed Tue 09:00 CST → Fri 09:00 CST", () => {
    const seedTue = new Date("2026-11-03T15:00:00.000Z"); // Tue 11-03 09:00 CST
    const completedSat = new Date("2026-10-31T13:00:00.000Z"); // Sat 10-31 08:00 CDT
    const result = computeNextLazyOccurrence(EVERY_3_DAYS, completedSat, "completed", {
      wallTime: NINE,
      after: seedTue,
    });
    expect(result.occursLocal).toMatchObject({ month: 11, day: 6, hour: 9, minute: 0 });
    expect(result.occursAt.toISOString()).toBe("2026-11-06T15:00:00.000Z");
  });

  it("monthly with a bound: done Jan 31 with the open row on Feb 28 → Mar 28 (anchor-based, no compounding)", () => {
    // Feb 28 == after → step 2 from the ANCHOR (Jan 31 + 2 months, clamped)
    // is Mar 31, not Feb 28 + 1 month = Mar 28: the clamp never compounds
    // inside one call.
    const completed = new Date("2026-02-01T03:47:00.000Z"); // 2026-01-31 21:47 CST
    const openFeb28 = new Date("2026-02-28T15:00:00.000Z");
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=MONTHLY", recurrenceTimezone: CHICAGO },
      completed,
      "completed",
      { wallTime: NINE, after: openFeb28 },
    );
    expect(result.occursLocal).toMatchObject({ year: 2026, month: 3, day: 31, hour: 9 });
  });

  it("the legacy (no wallTime) rrule path honours the bound too", () => {
    const completedMon = new Date("2026-06-08T15:15:00.000Z"); // Mon 06-08 10:15 CDT
    const unbounded = computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed");
    expect(unbounded.occursAt.toISOString()).toBe("2026-06-11T15:15:00.000Z");
    const bounded = computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed", {
      after: unbounded.occursAt,
    });
    expect(bounded.occursLocal).toEqual({
      year: 2026,
      month: 6,
      day: 14,
      hour: 10,
      minute: 15,
      second: 0,
    });
    expect(bounded.occursAt.toISOString()).toBe("2026-06-14T15:15:00.000Z");
    // A bound before the candidate leaves the legacy result untouched.
    expect(
      computeNextLazyOccurrence(EVERY_3_DAYS, completedMon, "completed", {
        after: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).toEqual(unbounded);
  });

  it("legacy path: a sub-daily rule steps past the bound by its own interval", () => {
    const from = new Date("2026-06-11T02:47:00.000Z"); // 2026-06-10 21:47 CDT
    const rule = { rrule: "FREQ=HOURLY;INTERVAL=6", recurrenceTimezone: CHICAGO };
    const first = computeNextLazyOccurrence(rule, from, "completed");
    expect(first.occursLocal).toMatchObject({ day: 11, hour: 3, minute: 47 });
    const result = computeNextLazyOccurrence(rule, from, "completed", { after: first.occursAt });
    expect(result.occursLocal).toMatchObject({ day: 11, hour: 9, minute: 47 });
  });

  it("gives up after 1000 steps rather than spinning on a pathological bound", () => {
    const completed = new Date("2026-06-08T15:15:00.000Z");
    const farFuture = new Date(completed.getTime() + 3001 * 24 * 60 * 60 * 1000);
    expect(() =>
      computeNextLazyOccurrence(EVERY_3_DAYS, completed, "completed", {
        wallTime: NINE,
        after: farFuture,
      }),
    ).toThrow(/within 1000 steps/);
    expect(() =>
      computeNextLazyOccurrence(EVERY_3_DAYS, completed, "completed", { after: farFuture }),
    ).toThrow(/within 1000 steps/);
    // 999 intervals ahead is still reachable on both paths.
    const reachable = new Date(completed.getTime() + 2996 * 24 * 60 * 60 * 1000);
    expect(
      computeNextLazyOccurrence(EVERY_3_DAYS, completed, "completed", {
        wallTime: NINE,
        after: reachable,
      }).occursAt.getTime(),
    ).toBeGreaterThan(reachable.getTime());
    expect(
      computeNextLazyOccurrence(EVERY_3_DAYS, completed, "completed", {
        after: reachable,
      }).occursAt.getTime(),
    ).toBeGreaterThan(reachable.getTime());
  });

  it("rejects an invalid bound", () => {
    expect(() =>
      computeNextLazyOccurrence(EVERY_3_DAYS, new Date("2026-06-08T15:15:00.000Z"), "completed", {
        wallTime: NINE,
        after: new Date("nope"),
      }),
    ).toThrow(/after is not a valid instant/);
  });
});

describe("wallTimeOfNaiveTimestamp", () => {
  it("reads the wall-clock time off a drizzle-decoded naive timestamp's UTC getters", () => {
    // What drizzle hands back for occurs_local = 2026-06-11 09:30:15: the
    // wall-clock fields on the UTC getters, whatever the host's zone is.
    const naive = new Date(Date.UTC(2026, 5, 11, 9, 30, 15));
    expect(wallTimeOfNaiveTimestamp(naive)).toEqual({ hour: 9, minute: 30, second: 15 });
  });

  it("round-trips what wallClockToNaiveDate writes", () => {
    const written = wallClockToNaiveDate({
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30,
      second: 0,
    });
    expect(wallTimeOfNaiveTimestamp(written)).toEqual({ hour: 1, minute: 30, second: 0 });
  });

  it("feeds computeNextLazyOccurrence the same time the completed row carried", () => {
    // The API and the worker each read the completed row's occurs_local
    // through this helper; the successor must carry that time forward.
    const occursLocal = wallClockToNaiveDate({
      year: 2026,
      month: 6,
      day: 11,
      hour: 7,
      minute: 45,
      second: 0,
    });
    const result = computeNextLazyOccurrence(
      { rrule: "FREQ=DAILY;INTERVAL=3", recurrenceTimezone: "America/Chicago" },
      new Date("2026-06-11T20:00:00.000Z"),
      "completed",
      { wallTime: wallTimeOfNaiveTimestamp(occursLocal) },
    );
    expect(result.occursLocal).toMatchObject({ day: 14, hour: 7, minute: 45, second: 0 });
  });
});
