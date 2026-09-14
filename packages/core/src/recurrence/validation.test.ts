import { describe, expect, it } from "vitest";
import { validateRecurrenceRule } from "./validation.js";

describe("validateRecurrenceRule", () => {
  describe("Valid rules", () => {
    it("accepts null/undefined/empty rrule when no recurrence fields are passed", () => {
      expect(() => validateRecurrenceRule({ rrule: null })).not.toThrow();
      expect(() => validateRecurrenceRule({ rrule: undefined })).not.toThrow();
      expect(() => validateRecurrenceRule({ rrule: "" })).not.toThrow();
    });

    it("accepts standard daily, weekly, monthly, and yearly rules", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrenceTimezone: "America/Chicago",
        }),
      ).not.toThrow();

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
          recurrenceTimezone: "UTC",
        }),
      ).not.toThrow();

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
          recurrenceTimezone: "Asia/Tokyo",
        }),
      ).not.toThrow();

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=YEARLY",
          recurrenceTimezone: "Europe/London",
        }),
      ).not.toThrow();
    });

    it("accepts recurrenceUntil with valid date", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "America/Chicago",
          recurrenceUntil: new Date("2026-12-31T23:59:59.999Z"),
        }),
      ).not.toThrow();
    });

    it("accepts recurrenceCount (count=1 and count=2)", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "America/Chicago",
          recurrenceCount: 1,
        }),
      ).not.toThrow();

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "America/Chicago",
          recurrenceCount: 2,
        }),
      ).not.toThrow();
    });

    it("accepts recurrenceExdates with YYYY-MM-DD strings", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=WEEKLY;BYDAY=MO",
          recurrenceTimezone: "America/Chicago",
          recurrenceExdates: ["2026-01-12", "2026-01-19"],
        }),
      ).not.toThrow();
    });

    it("accepts due_date anchor on task", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
          recurrenceTimezone: "America/Chicago",
          recurrenceAnchor: "due_date",
          isTask: true,
        }),
      ).not.toThrow();
    });

    it("accepts completion_date anchor with simple FREQ/INTERVAL on task", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrenceTimezone: "America/Chicago",
          recurrenceAnchor: "completion_date",
          isTask: true,
        }),
      ).not.toThrow();

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=WEEKLY",
          recurrenceTimezone: "UTC",
          recurrenceAnchor: "completion_date",
          isTask: true,
        }),
      ).not.toThrow();
    });
  });

  describe("Rejections and error cases", () => {
    it("rejects invalid RFC 5545 syntax", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "NOT_AN_RRULE",
          recurrenceTimezone: "America/Chicago",
        }),
      ).toThrow(/invalid RRULE syntax/i);

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=INVALID_FREQ",
          recurrenceTimezone: "America/Chicago",
        }),
      ).toThrow(/invalid RRULE syntax/i);
    });

    // Checkpoint 9.3: rrulestr never validates INTERVAL and silently defaults
    // a missing FREQ to YEARLY, so these used to pass and then fail (or, for
    // a negative interval, never terminate) at expansion time.
    it("rejects an INTERVAL the expansion cannot iterate", () => {
      for (const rrule of [
        "FREQ=DAILY;INTERVAL=0",
        "FREQ=DAILY;INTERVAL=-1",
        "FREQ=DAILY;INTERVAL=abc",
        "FREQ=DAILY;INTERVAL=1.5",
        "FREQ=WEEKLY;BYDAY=MO;INTERVAL=",
      ]) {
        expect(() => validateRecurrenceRule({ rrule, recurrenceTimezone: "UTC" })).toThrow(
          /INTERVAL must be a positive integer/,
        );
      }
    });

    it("rejects a rule with no FREQ rather than letting rrulestr default it to YEARLY", () => {
      expect(() =>
        validateRecurrenceRule({ rrule: "INTERVAL=2;BYDAY=MO", recurrenceTimezone: "UTC" }),
      ).toThrow(/FREQ is required/);
    });

    it("rejects an unknown FREQ and a free-text rule", () => {
      expect(() =>
        validateRecurrenceRule({ rrule: "FREQ=WEEKLYY", recurrenceTimezone: "UTC" }),
      ).toThrow(/invalid RRULE syntax/);
      expect(() =>
        validateRecurrenceRule({ rrule: "every monday", recurrenceTimezone: "UTC" }),
      ).toThrow(/invalid RRULE syntax/);
    });

    it("rejects compound RRuleSet", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "RRULE:FREQ=DAILY\nRRULE:FREQ=WEEKLY",
          recurrenceTimezone: "America/Chicago",
        }),
      ).toThrow("compound RRULE sets are not supported");
    });

    it("rejects embedded UNTIL= in rrule string", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY;UNTIL=20261231T000000Z",
          recurrenceTimezone: "America/Chicago",
        }),
      ).toThrow(
        "RRULE string must not embed UNTIL or COUNT; use recurrenceUntil or recurrenceCount instead",
      );
    });

    it("rejects embedded COUNT= in rrule string", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY;COUNT=5",
          recurrenceTimezone: "America/Chicago",
        }),
      ).toThrow(
        "RRULE string must not embed UNTIL or COUNT; use recurrenceUntil or recurrenceCount instead",
      );
    });

    it("rejects when both recurrenceUntil and recurrenceCount are provided", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "America/Chicago",
          recurrenceUntil: new Date("2026-12-31T23:59:59.999Z"),
          recurrenceCount: 5,
        }),
      ).toThrow("recurrenceUntil and recurrenceCount are mutually exclusive");
    });

    it("rejects missing or invalid timezone", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: null,
        }),
      ).toThrow('invalid recurrence timezone "null"');

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "Mars/Olympus_Mons",
        }),
      ).toThrow('invalid recurrence timezone "Mars/Olympus_Mons"');
    });

    it("rejects invalid recurrenceCount values", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "UTC",
          recurrenceCount: 0,
        }),
      ).toThrow("recurrenceCount must be a positive integer");

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "UTC",
          recurrenceCount: -2,
        }),
      ).toThrow("recurrenceCount must be a positive integer");

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "UTC",
          recurrenceCount: 1.5,
        }),
      ).toThrow("recurrenceCount must be a positive integer");
    });

    it("rejects invalid recurrenceUntil Date", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "UTC",
          recurrenceUntil: new Date("invalid"),
        }),
      ).toThrow("recurrenceUntil must be a valid Date");
    });

    it("rejects invalid recurrenceExdates format", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "UTC",
          recurrenceExdates: ["2026/01/01"],
        }),
      ).toThrow('invalid exdate "2026/01/01", expected YYYY-MM-DD');

      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "UTC",
          recurrenceExdates: ["not-a-date"],
        }),
      ).toThrow('invalid exdate "not-a-date", expected YYYY-MM-DD');
    });

    it("rejects recurrenceAnchor on non-task entity", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: "FREQ=DAILY",
          recurrenceTimezone: "America/Chicago",
          recurrenceAnchor: "due_date",
          isTask: false,
        }),
      ).toThrow("recurrenceAnchor is only supported for tasks");
    });

    it("rejects extra recurrence fields when rrule is null", () => {
      expect(() =>
        validateRecurrenceRule({
          rrule: null,
          recurrenceUntil: new Date("2026-12-31T00:00:00.000Z"),
        }),
      ).toThrow("recurrenceUntil cannot be set without an rrule");

      expect(() =>
        validateRecurrenceRule({
          rrule: null,
          recurrenceCount: 5,
        }),
      ).toThrow("recurrenceCount cannot be set without an rrule");

      expect(() =>
        validateRecurrenceRule({
          rrule: null,
          recurrenceExdates: ["2026-01-01"],
        }),
      ).toThrow("recurrenceExdates cannot be set without an rrule");

      expect(() =>
        validateRecurrenceRule({
          rrule: null,
          recurrenceAnchor: "due_date",
        }),
      ).toThrow("recurrenceAnchor cannot be set without an rrule");
    });

    describe("completion-anchored rules", () => {
      it("rejects recurrenceUntil with completion_date anchor", () => {
        expect(() =>
          validateRecurrenceRule({
            rrule: "FREQ=DAILY",
            recurrenceTimezone: "UTC",
            recurrenceAnchor: "completion_date",
            recurrenceUntil: new Date("2026-12-31T00:00:00.000Z"),
            isTask: true,
          }),
        ).toThrow("completion-anchored recurrence rules do not support recurrenceUntil");
      });

      it("rejects recurrenceCount with completion_date anchor", () => {
        expect(() =>
          validateRecurrenceRule({
            rrule: "FREQ=DAILY",
            recurrenceTimezone: "UTC",
            recurrenceAnchor: "completion_date",
            recurrenceCount: 5,
            isTask: true,
          }),
        ).toThrow("completion-anchored recurrence rules do not support recurrenceCount");
      });

      it("rejects recurrenceExdates with completion_date anchor", () => {
        expect(() =>
          validateRecurrenceRule({
            rrule: "FREQ=DAILY",
            recurrenceTimezone: "UTC",
            recurrenceAnchor: "completion_date",
            recurrenceExdates: ["2026-01-01"],
            isTask: true,
          }),
        ).toThrow("completion-anchored recurrence rules do not support recurrenceExdates");
      });

      it("rejects unsupported rule parts on completion_date anchor via validateCompletionAnchoredRule", () => {
        expect(() =>
          validateRecurrenceRule({
            rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
            recurrenceTimezone: "UTC",
            recurrenceAnchor: "completion_date",
            isTask: true,
          }),
        ).toThrow(/completion-anchored recurrence rules may only use FREQ\/INTERVAL/);
      });
    });
  });
});
