import { describe, expect, it } from "vitest";
import {
  hasCommittableRecurrence,
  resolveParsedTaskRecurrence,
  validateParsedTaskRecurrence,
} from "./parsed-task-recurrence.js";

// Checkpoint 9.3: CreateTaskToolSchema leaves `rrule` and
// `recurrence_timezone` as bare strings, so the parser can emit a rule the
// commit cannot materialize. This module is what lets the API refuse such a
// tool call at confirm time (409 parse_result_not_committable) and the worker
// reject it before any row is written.
describe("resolveParsedTaskRecurrence", () => {
  it("applies POST /tasks' defaulting: due_date anchor and the capture timezone", () => {
    expect(resolveParsedTaskRecurrence({ rrule: "FREQ=DAILY" }, "America/Chicago")).toEqual({
      rrule: "FREQ=DAILY",
      recurrenceAnchor: "due_date",
      recurrenceTimezone: "America/Chicago",
    });
  });

  it("honours an explicit anchor and zone", () => {
    expect(
      resolveParsedTaskRecurrence(
        {
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
          recurrence_timezone: "Pacific/Auckland",
        },
        "America/Chicago",
      ),
    ).toEqual({
      rrule: "FREQ=DAILY;INTERVAL=3",
      recurrenceAnchor: "completion_date",
      recurrenceTimezone: "Pacific/Auckland",
    });
  });

  it("returns null with no rrule, even when the parser sent an anchor or zone", () => {
    expect(
      resolveParsedTaskRecurrence(
        { recurrence_anchor: "completion_date", recurrence_timezone: "Mars/Olympus_Mons" },
        "America/Chicago",
      ),
    ).toBeNull();
  });
});

describe("validateParsedTaskRecurrence", () => {
  const tz = "America/Chicago";

  it("accepts a well-formed due_date rule with BY* parts", () => {
    expect(() =>
      validateParsedTaskRecurrence({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE" }, tz),
    ).not.toThrow();
  });

  it("accepts a well-formed completion_date rule", () => {
    expect(() =>
      validateParsedTaskRecurrence(
        { rrule: "FREQ=DAILY;INTERVAL=3", recurrence_anchor: "completion_date" },
        tz,
      ),
    ).not.toThrow();
  });

  it("is a no-op for a task with no rrule", () => {
    expect(() =>
      validateParsedTaskRecurrence({ recurrence_timezone: "Nowhere/Bogus" }, tz),
    ).not.toThrow();
  });

  it("rejects an rrule that does not parse (free text from the model)", () => {
    expect(() => validateParsedTaskRecurrence({ rrule: "every monday" }, tz)).toThrow(
      /invalid RRULE syntax/,
    );
  });

  it("rejects an unknown FREQ", () => {
    expect(() => validateParsedTaskRecurrence({ rrule: "FREQ=WEEKLYY" }, tz)).toThrow(
      /invalid RRULE syntax/,
    );
  });

  it.each(["FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;INTERVAL=-1", "FREQ=DAILY;INTERVAL=abc"])(
    "rejects an INTERVAL the expansion cannot iterate (%s)",
    (rrule) => {
      expect(() => validateParsedTaskRecurrence({ rrule }, tz)).toThrow(/INTERVAL/);
    },
  );

  it("rejects an invalid explicit recurrence_timezone", () => {
    expect(() =>
      validateParsedTaskRecurrence(
        { rrule: "FREQ=DAILY", recurrence_timezone: "Mars/Olympus_Mons" },
        tz,
      ),
    ).toThrow(/invalid recurrence timezone/);
  });

  it("rejects a BY* part on a completion_date rule", () => {
    expect(() =>
      validateParsedTaskRecurrence(
        { rrule: "FREQ=WEEKLY;BYDAY=MO", recurrence_anchor: "completion_date" },
        tz,
      ),
    ).toThrow(/FREQ\/INTERVAL/);
  });
});

describe("hasCommittableRecurrence", () => {
  const tz = "America/Chicago";

  it("is true for every non-task tool", () => {
    expect(
      hasCommittableRecurrence({ tool: "create_note", args: { title: "x", body: "y" } }, tz),
    ).toBe(true);
    expect(
      hasCommittableRecurrence(
        {
          tool: "create_event",
          args: { title: "x", start: "2026-01-01T09:00:00", rrule: "nonsense" },
        },
        tz,
      ),
    ).toBe(true);
  });

  it("is true for a task with no rrule and for a task with a valid rrule", () => {
    expect(hasCommittableRecurrence({ tool: "create_task", args: { title: "x" } }, tz)).toBe(true);
    expect(
      hasCommittableRecurrence(
        { tool: "create_task", args: { title: "x", rrule: "FREQ=MONTHLY;BYMONTHDAY=1" } },
        tz,
      ),
    ).toBe(true);
  });

  it.each([
    ["free-text rrule", { title: "x", rrule: "every monday" }],
    ["unknown FREQ", { title: "x", rrule: "FREQ=WEEKLYY" }],
    ["zero INTERVAL", { title: "x", rrule: "FREQ=DAILY;INTERVAL=0" }],
    ["invalid zone", { title: "x", rrule: "FREQ=DAILY", recurrence_timezone: "Mars/Olympus_Mons" }],
    [
      "BY* on completion_date",
      { title: "x", rrule: "FREQ=WEEKLY;BYDAY=MO", recurrence_anchor: "completion_date" },
    ],
  ])("is false for a task whose rule cannot be materialized: %s", (_label, args) => {
    expect(hasCommittableRecurrence({ tool: "create_task", args }, tz)).toBe(false);
  });

  it("is false for a task whose args are not an object", () => {
    expect(hasCommittableRecurrence({ tool: "create_task", args: null }, tz)).toBe(false);
  });
});
