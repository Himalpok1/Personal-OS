import { describe, expect, it } from "vitest";
import * as coreBarrel from "../index.js";
import {
  TaskDueDateRuleError,
  validateEventRecurrenceRule,
  validateRecurrenceRule,
} from "./validation.js";

// Checkpoint 9.5 (Lane E): pins the write-time contract of the NEW
// `validateEventRecurrenceRule` -- the event twin of validateTaskDueDateRule
// that POST/PATCH /events and the capture `create_event` commit share. The
// route maps a TaskDueDateRuleError to its own token and every OTHER throw to
// `invalid_rrule`, so the split between "token-only TaskDueDateRuleError" and
// "plain Error" is itself part of the contract.

const TZ = "America/Chicago";

function codeOf(fn: () => void): TaskDueDateRuleError["code"] | "no-throw" | "plain-error" {
  try {
    fn();
    return "no-throw";
  } catch (err) {
    if (err instanceof TaskDueDateRuleError) return err.code;
    return "plain-error";
  }
}

describe("validateEventRecurrenceRule (9.5)", () => {
  it("is exported from the core barrel (server-only entry), alongside TaskDueDateRuleError", () => {
    expect(typeof coreBarrel.validateEventRecurrenceRule).toBe("function");
    expect(coreBarrel.validateEventRecurrenceRule).toBe(validateEventRecurrenceRule);
    expect(coreBarrel.TaskDueDateRuleError).toBe(TaskDueDateRuleError);
  });

  it("accepts DAILY, WEEKLY, MONTHLY and YEARLY -- every preset an event Repeat field can emit", () => {
    const accepted = [
      "FREQ=DAILY",
      "FREQ=DAILY;INTERVAL=3",
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      "FREQ=WEEKLY;BYDAY=MO",
      "FREQ=WEEKLY;BYDAY=MO,WE",
      "FREQ=MONTHLY;BYMONTHDAY=15",
      "FREQ=MONTHLY;BYMONTHDAY=-1",
      "FREQ=YEARLY",
      "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=8",
    ];
    for (const rrule of accepted) {
      expect(() => validateEventRecurrenceRule(rrule, TZ), rrule).not.toThrow();
    }
  });

  it("accepts the same rule with or without the RRULE: property prefix", () => {
    expect(() => validateEventRecurrenceRule("FREQ=WEEKLY;BYDAY=MO", TZ)).not.toThrow();
    expect(() => validateEventRecurrenceRule("RRULE:FREQ=WEEKLY;BYDAY=MO", TZ)).not.toThrow();
    expect(() => validateEventRecurrenceRule("rrule:FREQ=MONTHLY;BYMONTHDAY=-1", TZ)).not.toThrow();
  });

  it("defaults the zone to UTC when only the rule is given", () => {
    expect(() => validateEventRecurrenceRule("FREQ=DAILY")).not.toThrow();
  });

  it("rejects HOURLY / MINUTELY / SECONDLY with the unsupported_frequency token, never the rule text", () => {
    for (const rrule of [
      "FREQ=HOURLY",
      "FREQ=MINUTELY;INTERVAL=5",
      "FREQ=SECONDLY",
      "RRULE:FREQ=HOURLY",
      "freq=hourly",
    ]) {
      expect(
        codeOf(() => validateEventRecurrenceRule(rrule, TZ)),
        rrule,
      ).toBe("unsupported_frequency");
      try {
        validateEventRecurrenceRule(rrule, TZ);
      } catch (err) {
        expect((err as Error).message).toContain("unsupported_frequency");
        expect((err as Error).message).not.toContain(rrule);
      }
    }
  });

  it("rejects an embedded UNTIL or COUNT with the embedded_until_count token, before the rule is quoted", () => {
    for (const rrule of [
      "FREQ=DAILY;UNTIL=20261231T000000Z",
      "FREQ=DAILY;COUNT=10",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T000000Z",
      "FREQ=MONTHLY;count=3",
      // The token check wins even over an otherwise-unsupported frequency.
      "FREQ=HOURLY;COUNT=2",
    ]) {
      expect(
        codeOf(() => validateEventRecurrenceRule(rrule, TZ)),
        rrule,
      ).toBe("embedded_until_count");
      try {
        validateEventRecurrenceRule(rrule, TZ);
      } catch (err) {
        expect((err as Error).message).not.toContain("UNTIL=");
        expect((err as Error).message).not.toContain("COUNT=");
        expect((err as Error).message).not.toContain(rrule);
      }
    }
  });

  it("throws a PLAIN error (the route's invalid_rrule bucket) for garbage, no FREQ, bad INTERVAL, bad zone", () => {
    for (const [rrule, tz] of [
      ["garbage", TZ],
      ["INTERVAL=2", TZ],
      ["FREQ=WEEKLYY", TZ],
      ["FREQ=DAILY;INTERVAL=0", TZ],
      ["FREQ=DAILY;INTERVAL=-1", TZ],
      ["FREQ=DAILY;INTERVAL=abc", TZ],
      ["FREQ=WEEKLY;BYDAY=XX", TZ],
      ["FREQ=DAILY", "Mars/Olympus_Mons"],
    ] as const) {
      expect(
        codeOf(() => validateEventRecurrenceRule(rrule, tz)),
        `${rrule} @ ${tz}`,
      ).toBe("plain-error");
    }
  });

  it("passes the separate until/count/exdate columns through (mutually exclusive until+count, exdate format)", () => {
    expect(() =>
      validateEventRecurrenceRule("FREQ=DAILY", TZ, {
        recurrenceUntil: new Date("2026-12-31T05:59:59.999Z"),
      }),
    ).not.toThrow();
    expect(() =>
      validateEventRecurrenceRule("FREQ=DAILY", TZ, { recurrenceCount: 5 }),
    ).not.toThrow();
    expect(() =>
      validateEventRecurrenceRule("FREQ=DAILY", TZ, { recurrenceExdates: ["2026-10-01"] }),
    ).not.toThrow();

    expect(
      codeOf(() =>
        validateEventRecurrenceRule("FREQ=DAILY", TZ, {
          recurrenceUntil: new Date("2026-12-31T05:59:59.999Z"),
          recurrenceCount: 5,
        }),
      ),
    ).toBe("plain-error");
    expect(
      codeOf(() => validateEventRecurrenceRule("FREQ=DAILY", TZ, { recurrenceCount: 0 })),
    ).toBe("plain-error");
    expect(
      codeOf(() =>
        validateEventRecurrenceRule("FREQ=DAILY", TZ, { recurrenceExdates: ["10/01/2026"] }),
      ),
    ).toBe("plain-error");
  });

  it("has no anchor parameter at all: an event rule cannot be completion-anchored", () => {
    // The signature is (rrule, tz, extras) with extras limited to
    // until/count/exdates -- there is no way to hand it an anchor, and the
    // underlying validator rejects an anchor on a non-task explicitly.
    expect(validateEventRecurrenceRule.length).toBeLessThanOrEqual(3);
    expect(() =>
      validateRecurrenceRule({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        isTask: false,
        recurrenceAnchor: "completion_date",
      }),
    ).toThrow(/recurrenceAnchor is only supported for tasks/);
    expect(() =>
      validateRecurrenceRule({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        isTask: false,
        recurrenceAnchor: "due_date",
      }),
    ).toThrow(/recurrenceAnchor is only supported for tasks/);
  });

  it("PINS CURRENT BEHAVIOUR (reported, not desired): an empty or blank rrule string passes silently", () => {
    // validateRecurrenceRule treats "" / whitespace as "no rule" and returns
    // without throwing. EventSchema/EventCreateSchema declare `rrule:
    // z.string().nullable()` with no .min(1), so a caller can persist
    // rrule = "" -- and assembleEventRange then classifies that row as
    // RECURRING (`rrule IS NOT NULL`) while buildEventRecurrenceRule returns
    // null for it, so the event is silently absent from range/Today/Agenda.
    // See event-range.9-5-semantics.test.ts for the read-model half. The
    // route must reject or null-out a blank rrule before this validator sees
    // it; this test only pins that the validator itself will not.
    expect(() => validateEventRecurrenceRule("", TZ)).not.toThrow();
    expect(() => validateEventRecurrenceRule("   ", TZ)).not.toThrow();
  });

  it("does not accept a compound RRULE set (a second RRULE: line)", () => {
    expect(
      codeOf(() => validateEventRecurrenceRule("RRULE:FREQ=DAILY\nRRULE:FREQ=WEEKLY", TZ)),
    ).toBe("plain-error");
  });
});
