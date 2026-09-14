import { describe, expect, it } from "vitest";
import {
  computeNextLazyOccurrence,
  validateCompletionAnchoredRule,
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
    ])("%s: %s", (_label, rrule, pattern) => {
      expect(() => validateCompletionAnchoredRule(rrule)).toThrow(pattern);
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
