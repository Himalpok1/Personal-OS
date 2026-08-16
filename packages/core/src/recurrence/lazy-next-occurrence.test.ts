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
});
