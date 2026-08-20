import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "./google-calendar-client.js";
import {
  classifyGoogleEvent,
  googleAllDayToLocal,
  googleExdateInstantToLocalDate,
  googleRecurrenceToLocal,
  localAllDayToGoogle,
  mapGoogleEventToLocalUpsert,
  wouldCollideOnSameLocalDate,
} from "./translate.js";

describe("googleAllDayToLocal / localAllDayToGoogle", () => {
  it("converts a one-day event (exclusive end == start + 1) to an inclusive one-day range", () => {
    const result = googleAllDayToLocal("2026-08-20", "2026-08-21");
    expect(result).toEqual({ startDate: "2026-08-20", endDate: "2026-08-20" });
  });

  it("converts a multi-day span, subtracting exactly one calendar day from the exclusive end", () => {
    const result = googleAllDayToLocal("2026-08-20", "2026-08-25");
    expect(result).toEqual({ startDate: "2026-08-20", endDate: "2026-08-24" });
  });

  it("handles a month-boundary-crossing exclusive end correctly", () => {
    const result = googleAllDayToLocal("2026-08-30", "2026-09-01");
    expect(result).toEqual({ startDate: "2026-08-30", endDate: "2026-08-31" });
  });

  it("is the exact inverse of localAllDayToGoogle for a one-day event", () => {
    const local = googleAllDayToLocal("2026-08-20", "2026-08-21");
    const back = localAllDayToGoogle(local.startDate, local.endDate);
    expect(back).toEqual({ googleStartDate: "2026-08-20", googleEndDate: "2026-08-21" });
  });

  it("is the exact inverse of localAllDayToGoogle for a multi-day span", () => {
    const local = googleAllDayToLocal("2026-08-20", "2026-08-25");
    const back = localAllDayToGoogle(local.startDate, local.endDate);
    expect(back).toEqual({ googleStartDate: "2026-08-20", googleEndDate: "2026-08-25" });
  });

  it("localAllDayToGoogle adds exactly one day across a month boundary", () => {
    const result = localAllDayToGoogle("2026-08-30", "2026-08-31");
    expect(result).toEqual({ googleStartDate: "2026-08-30", googleEndDate: "2026-09-01" });
  });
});

describe("googleRecurrenceToLocal", () => {
  it("strips UNTIL= out of the RRULE string and returns it as recurrenceUntil", () => {
    const result = googleRecurrenceToLocal(
      ["RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z;BYDAY=MO,WE,FR"],
      "America/Chicago",
    );
    expect(result.rrule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(result.rrule).not.toMatch(/UNTIL/);
    expect(result.recurrenceUntil).toBeInstanceOf(Date);
    expect(result.recurrenceUntil?.toISOString()).toBe("2026-12-31T23:59:59.000Z");
    expect(result.recurrenceCount).toBeUndefined();
    expect(result.recurrenceTimezone).toBe("America/Chicago");
  });

  it("strips COUNT= out of the RRULE string and returns it as recurrenceCount", () => {
    const result = googleRecurrenceToLocal(
      ["RRULE:FREQ=DAILY;COUNT=10;INTERVAL=2"],
      "America/Chicago",
    );
    expect(result.rrule).toBe("RRULE:FREQ=DAILY;INTERVAL=2");
    expect(result.rrule).not.toMatch(/COUNT/);
    expect(result.recurrenceCount).toBe(10);
    expect(result.recurrenceUntil).toBeUndefined();
  });

  it("keeps every other RRULE part verbatim, unvalidated", () => {
    const result = googleRecurrenceToLocal(["RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=SU"], "UTC");
    expect(result.rrule).toBe("RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=SU");
  });

  it("extracts EXDATE lines mixed into the recurrence array as separate instants, not left in the RRULE", () => {
    const result = googleRecurrenceToLocal(
      ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=America/Chicago:20260824T090000,20260831T090000"],
      "America/Chicago",
    );
    expect(result.rrule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(result.exdateInstants).toHaveLength(2);
    // 09:00 America/Chicago in August is CDT (UTC-5) -> 14:00Z
    expect(result.exdateInstants[0]?.toISOString()).toBe("2026-08-24T14:00:00.000Z");
    expect(result.exdateInstants[1]?.toISOString()).toBe("2026-08-31T14:00:00.000Z");
  });

  it("handles a date-only (VALUE=DATE) EXDATE line for all-day masters", () => {
    const result = googleRecurrenceToLocal(
      ["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20260825"],
      "America/Chicago",
    );
    expect(result.exdateInstants).toHaveLength(1);
    // Resolved at local midnight in the master's timezone.
    const local = googleExdateInstantToLocalDate(result.exdateInstants[0]!, "America/Chicago");
    expect(local).toBe("2026-08-25");
  });

  it("throws when no RRULE line is present", () => {
    expect(() => googleRecurrenceToLocal(["EXDATE:20260825T090000Z"], "UTC")).toThrow(/RRULE/);
  });
});

describe("googleExdateInstantToLocalDate", () => {
  it("converts a UTC instant to the correct local calendar date across a DST boundary", () => {
    // 2026-11-01 06:00Z is 2026-11-01 01:00 America/Chicago (CDT, pre-fallback) -- still the 1st.
    const instant = new Date("2026-11-01T06:00:00.000Z");
    expect(googleExdateInstantToLocalDate(instant, "America/Chicago")).toBe("2026-11-01");
  });

  it("can roll the local date backward relative to UTC for a negative-offset zone", () => {
    // 2026-08-01 02:00Z is 2026-07-31 21:00 America/Chicago (CDT, UTC-5).
    const instant = new Date("2026-08-01T02:00:00.000Z");
    expect(googleExdateInstantToLocalDate(instant, "America/Chicago")).toBe("2026-07-31");
  });
});

describe("wouldCollideOnSameLocalDate", () => {
  it("is true when the candidate date is already present", () => {
    expect(wouldCollideOnSameLocalDate(["2026-08-20", "2026-08-27"], "2026-08-20")).toBe(true);
  });

  it("is false when the candidate date is absent", () => {
    expect(wouldCollideOnSameLocalDate(["2026-08-20", "2026-08-27"], "2026-09-03")).toBe(false);
  });

  it("is false against an empty list", () => {
    expect(wouldCollideOnSameLocalDate([], "2026-08-20")).toBe(false);
  });
});

describe("classifyGoogleEvent", () => {
  const base = { etag: '"1"', updated: "2026-08-01T00:00:00Z", iCalUID: "uid@google.com" } as const;

  it("classifies a master (recurrence present, no recurringEventId)", () => {
    const event: GoogleCalendarEvent = {
      ...base,
      id: "master-1",
      status: "confirmed",
      recurrence: ["RRULE:FREQ=DAILY"],
    };
    expect(classifyGoogleEvent(event)).toBe("master");
  });

  it("classifies a one-off (neither recurrence nor recurringEventId)", () => {
    const event: GoogleCalendarEvent = { ...base, id: "oneoff-1", status: "confirmed" };
    expect(classifyGoogleEvent(event)).toBe("one_off");
  });

  it("classifies a detached instance (recurringEventId + originalStartTime, not cancelled)", () => {
    const event: GoogleCalendarEvent = {
      ...base,
      id: "instance-1",
      status: "confirmed",
      recurringEventId: "master-1",
      originalStartTime: { dateTime: "2026-08-20T09:00:00-05:00", timeZone: "America/Chicago" },
    };
    expect(classifyGoogleEvent(event)).toBe("detached_instance");
  });

  it("classifies a cancelled instance (recurringEventId + originalStartTime, status cancelled)", () => {
    const event: GoogleCalendarEvent = {
      ...base,
      id: "instance-2",
      status: "cancelled",
      recurringEventId: "master-1",
      originalStartTime: { dateTime: "2026-08-27T09:00:00-05:00", timeZone: "America/Chicago" },
    };
    expect(classifyGoogleEvent(event)).toBe("cancelled_instance");
  });
});

describe("mapGoogleEventToLocalUpsert", () => {
  const ctx = { defaultTimezone: "America/Chicago" };

  it("maps a one-off timed event to upsert_standalone_or_master", () => {
    const event: GoogleCalendarEvent = {
      id: "oneoff-1",
      status: "confirmed",
      summary: "Dentist",
      description: "Cleaning",
      location: "123 Main St",
      start: { dateTime: "2026-08-20T09:00:00-05:00", timeZone: "America/Chicago" },
      end: { dateTime: "2026-08-20T10:00:00-05:00", timeZone: "America/Chicago" },
      etag: '"1"',
      updated: "2026-08-01T00:00:00Z",
      iCalUID: "uid@google.com",
    };

    const intent = mapGoogleEventToLocalUpsert(event, "one_off", ctx);
    expect(intent.kind).toBe("upsert_standalone_or_master");
    if (intent.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(intent.sourceGoogleEventId).toBe("oneoff-1");
    expect(intent.fields.title).toBe("Dentist");
    expect(intent.fields.allDay).toBe(false);
    expect(intent.fields.timezone).toBe("America/Chicago");
    expect(intent.fields.startsAt?.toISOString()).toBe("2026-08-20T14:00:00.000Z");
    expect(intent.fields.rrule).toBeUndefined();
  });

  it("maps an all-day one-off event with inclusive-end conversion applied", () => {
    const event: GoogleCalendarEvent = {
      id: "allday-1",
      status: "confirmed",
      summary: "Conference",
      start: { date: "2026-08-20" },
      end: { date: "2026-08-23" },
      etag: '"1"',
      updated: "2026-08-01T00:00:00Z",
      iCalUID: "uid@google.com",
    };

    const intent = mapGoogleEventToLocalUpsert(event, "one_off", ctx);
    if (intent.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(intent.fields.allDay).toBe(true);
    expect(intent.fields.startDate).toBe("2026-08-20");
    expect(intent.fields.endDate).toBe("2026-08-22");
  });

  it("maps a master event, including recurrence and exdate translation", () => {
    const event: GoogleCalendarEvent = {
      id: "master-1",
      status: "confirmed",
      summary: "Weekly sync",
      start: { dateTime: "2026-08-17T09:00:00-05:00", timeZone: "America/Chicago" },
      end: { dateTime: "2026-08-17T09:30:00-05:00", timeZone: "America/Chicago" },
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270101T000000Z",
        "EXDATE;TZID=America/Chicago:20260824T090000",
      ],
      etag: '"1"',
      updated: "2026-08-01T00:00:00Z",
      iCalUID: "uid@google.com",
    };

    const intent = mapGoogleEventToLocalUpsert(event, "master", ctx);
    if (intent.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(intent.fields.rrule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(intent.fields.recurrenceUntil?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(intent.fields.recurrenceTimezone).toBe("America/Chicago");
    expect(intent.fields.recurrenceExdates).toEqual(["2026-08-24"]);
  });

  it("maps a detached instance to detach_instance with the parent id and original start", () => {
    const event: GoogleCalendarEvent = {
      id: "instance-1",
      status: "confirmed",
      summary: "Weekly sync (moved)",
      start: { dateTime: "2026-08-20T14:00:00-05:00", timeZone: "America/Chicago" },
      end: { dateTime: "2026-08-20T14:30:00-05:00", timeZone: "America/Chicago" },
      recurringEventId: "master-1",
      originalStartTime: { dateTime: "2026-08-17T09:00:00-05:00", timeZone: "America/Chicago" },
      etag: '"2"',
      updated: "2026-08-10T00:00:00Z",
      iCalUID: "uid-instance@google.com",
    };

    const intent = mapGoogleEventToLocalUpsert(event, "detached_instance", ctx);
    expect(intent.kind).toBe("detach_instance");
    if (intent.kind !== "detach_instance") throw new Error("unreachable");
    expect(intent.parentGoogleEventId).toBe("master-1");
    expect(intent.originalStartInstant.toISOString()).toBe("2026-08-17T14:00:00.000Z");
    expect(intent.fields.title).toBe("Weekly sync (moved)");
    expect(intent.fields.rrule).toBeUndefined();
  });

  it("maps a cancelled instance to cancel_instance with no fields", () => {
    const event: GoogleCalendarEvent = {
      id: "instance-2",
      status: "cancelled",
      recurringEventId: "master-1",
      originalStartTime: { dateTime: "2026-08-24T09:00:00-05:00", timeZone: "America/Chicago" },
      etag: '"3"',
      updated: "2026-08-10T00:00:00Z",
      iCalUID: "uid-instance-2@google.com",
    };

    const intent = mapGoogleEventToLocalUpsert(event, "cancelled_instance", ctx);
    expect(intent).toEqual({
      kind: "cancel_instance",
      parentGoogleEventId: "master-1",
      originalStartInstant: new Date("2026-08-24T14:00:00.000Z"),
    });
  });

  it("falls back to connectionContext.defaultTimezone when start.timeZone is omitted", () => {
    const event: GoogleCalendarEvent = {
      id: "oneoff-2",
      status: "confirmed",
      summary: "No explicit zone",
      start: { dateTime: "2026-08-20T09:00:00-05:00" },
      end: { dateTime: "2026-08-20T10:00:00-05:00" },
      etag: '"1"',
      updated: "2026-08-01T00:00:00Z",
      iCalUID: "uid@google.com",
    };
    const intent = mapGoogleEventToLocalUpsert(event, "one_off", ctx);
    if (intent.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(intent.fields.timezone).toBe("America/Chicago");
  });
});
