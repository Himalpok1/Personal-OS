import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "./google-calendar-client.js";
import {
  classifyGoogleEvent,
  googleAllDayToLocal,
  googleExdateInstantToLocalDate,
  googleRecurrenceToLocal,
  localRecurrenceToGoogle,
  normalizeRruleParts,
  localAllDayToGoogle,
  mapGoogleEventToLocalUpsert,
  wouldCollideOnSameLocalDate,
} from "./translate.js";

describe("googleAllDayToLocal / localAllDayToGoogle", () => {
  // Checkpoint 8.6A. Google emits end.date == start.date for a zero-length
  // all-day event, and production already holds one. Unclamped, the exclusive
  // -> inclusive conversion put end one day BEFORE start, which made
  // classifyEventIntoWindows' `start <= day <= end` range EMPTY -- so the event
  // matched no Today window and silently disappeared.
  it("clamps a zero-length all-day event to a single day instead of inverting it", () => {
    const result = googleAllDayToLocal("2026-08-20", "2026-08-20");
    expect(result.startDate).toBe("2026-08-20");
    expect(result.endDate).toBe("2026-08-20");
  });

  it("never returns an end date before the start date", () => {
    const cases = [
      { start: "2026-08-20", end: "2026-08-20" },
      { start: "2026-03-01", end: "2026-02-28" },
      { start: "2026-01-01", end: "2025-12-25" },
    ];
    for (const { start, end } of cases) {
      const result = googleAllDayToLocal(start, end);
      expect(result.endDate >= result.startDate).toBe(true);
    }
  });

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

// ---------------------------------------------------------------------------
// Outbound recurrence round-trips (Checkpoint 9.5). Every case goes local ->
// Google lines -> `googleRecurrenceToLocal` (the EXISTING inbound parser, not
// a mirror written for the test) and must come back equal: rule parts modulo
// the RRULE: prefix, the UNTIL instant, the COUNT, and the exdate local dates.
// ---------------------------------------------------------------------------
describe("localRecurrenceToGoogle round-trips through googleRecurrenceToLocal", () => {
  const CHICAGO = "America/Chicago";

  function roundTrip(input: Parameters<typeof localRecurrenceToGoogle>[0]) {
    const lines = localRecurrenceToGoogle(input);
    const back = googleRecurrenceToLocal(lines, input.timezone);
    return {
      lines,
      back,
      backParts: normalizeRruleParts(back.rrule),
      backExdates: back.exdateInstants.map((i) =>
        googleExdateInstantToLocalDate(i, input.timezone),
      ),
    };
  }

  it("normalises a bare FREQ=... and a prefixed RRULE:FREQ=... to the same line", () => {
    const bare = localRecurrenceToGoogle({ rrule: "FREQ=DAILY", allDay: false, timezone: CHICAGO });
    const prefixed = localRecurrenceToGoogle({
      rrule: "RRULE:FREQ=DAILY",
      allDay: false,
      timezone: CHICAGO,
    });
    expect(bare).toEqual(["RRULE:FREQ=DAILY"]);
    expect(prefixed).toEqual(bare);
  });

  it("daily", () => {
    const { backParts, back } = roundTrip({
      rrule: "FREQ=DAILY",
      allDay: false,
      timezone: CHICAGO,
    });
    expect(backParts).toEqual(["FREQ=DAILY"]);
    expect(back.recurrenceUntil).toBeUndefined();
    expect(back.recurrenceCount).toBeUndefined();
    expect(back.exdateInstants).toEqual([]);
  });

  it("weekdays (BYDAY=MO,TU,WE,TH,FR)", () => {
    const { backParts } = roundTrip({
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      allDay: false,
      timezone: CHICAGO,
    });
    expect(backParts).toEqual(["FREQ=WEEKLY", "BYDAY=MO,TU,WE,TH,FR"]);
  });

  it("weekly BYDAY with INTERVAL", () => {
    const { backParts } = roundTrip({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
      allDay: false,
      timezone: CHICAGO,
    });
    expect(backParts).toEqual(["FREQ=WEEKLY", "INTERVAL=2", "BYDAY=TU"]);
  });

  it("monthly BYMONTHDAY=-1", () => {
    const { backParts } = roundTrip({
      rrule: "FREQ=MONTHLY;BYMONTHDAY=-1",
      allDay: true,
      timezone: CHICAGO,
    });
    expect(backParts).toEqual(["FREQ=MONTHLY", "BYMONTHDAY=-1"]);
  });

  it("timed UNTIL in America/Chicago on both sides of the DST fall-back is emitted as a UTC instant and returns as the same instant", () => {
    // 2026-11-01 is the US fall-back day. An UNTIL just before (CDT, -05:00)
    // and just after (CST, -06:00) the transition must each survive as the
    // exact instant, which only the UTC basic form guarantees.
    for (const iso of ["2026-10-31T09:00:00-05:00", "2026-11-02T09:00:00-06:00"]) {
      const until = new Date(iso);
      const { lines, back } = roundTrip({
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        recurrenceUntil: until,
        allDay: false,
        timezone: CHICAGO,
      });
      expect(lines[0]).toMatch(/;UNTIL=\d{8}T\d{6}Z$/);
      expect(back.recurrenceUntil?.getTime()).toBe(until.getTime());
      expect(back.rrule).not.toMatch(/UNTIL/);
    }
  });

  it("all-day UNTIL is emitted as the local YYYYMMDD and returns as that local date", () => {
    // The mobile editor stores an all-day until as end-of-local-day; Google's
    // date-only UNTIL carries the date alone, and the inbound parser resolves
    // it at END of local day (Checkpoint 9.5 fixer review) -- so the instant
    // round-trips exactly, not merely the date.
    const until = new Date("2026-12-31T23:59:59.999-06:00");
    const { lines, back } = roundTrip({
      rrule: "FREQ=DAILY",
      recurrenceUntil: until,
      allDay: true,
      timezone: CHICAGO,
    });
    expect(lines).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261231"]);
    expect(googleExdateInstantToLocalDate(back.recurrenceUntil!, CHICAGO)).toBe("2026-12-31");
    expect(back.recurrenceUntil?.getTime()).toBe(until.getTime());
  });

  it("a date-only UNTIL resolves to the END of that local day, after ADR-042's local-noon anchor (fixer review, MAJOR-D)", () => {
    // Before the fix a date-only UNTIL resolved at local MIDNIGHT, which sits
    // BEFORE the noon anchor every all-day instance is generated at, so the
    // last day of every inbound all-day series was dropped.
    const back = googleRecurrenceToLocal(["RRULE:FREQ=DAILY;UNTIL=20261231"], CHICAGO);
    expect(back.recurrenceUntil?.toISOString()).toBe("2027-01-01T05:59:59.999Z");
    const noonOfLastDay = new Date("2026-12-31T12:00:00-06:00");
    expect(back.recurrenceUntil!.getTime()).toBeGreaterThan(noonOfLastDay.getTime());
    // A date-time UNTIL is an exact instant and is untouched.
    const exact = googleRecurrenceToLocal(["RRULE:FREQ=DAILY;UNTIL=20261231T120000Z"], CHICAGO);
    expect(exact.recurrenceUntil?.toISOString()).toBe("2026-12-31T12:00:00.000Z");
    // An EXDATE date-only value still marks the whole day from local midnight.
    const ex = googleRecurrenceToLocal(["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20261230"], CHICAGO);
    expect(ex.exdateInstants[0]?.toISOString()).toBe("2026-12-30T06:00:00.000Z");
  });

  it("COUNT", () => {
    const { lines, back, backParts } = roundTrip({
      rrule: "FREQ=DAILY;INTERVAL=3",
      recurrenceCount: 10,
      allDay: false,
      timezone: CHICAGO,
    });
    expect(lines).toEqual(["RRULE:FREQ=DAILY;INTERVAL=3;COUNT=10"]);
    expect(back.recurrenceCount).toBe(10);
    expect(backParts).toEqual(["FREQ=DAILY", "INTERVAL=3"]);
  });

  it("the UNTIL/COUNT columns win over a stale embedded UNTIL/COUNT in the stored string", () => {
    const lines = localRecurrenceToGoogle({
      rrule: "RRULE:FREQ=DAILY;COUNT=99;UNTIL=20200101T000000Z",
      recurrenceCount: 4,
      allDay: false,
      timezone: CHICAGO,
    });
    expect(lines).toEqual(["RRULE:FREQ=DAILY;COUNT=4"]);
  });

  it("two timed EXDATEs carry DTSTART's wall-clock time under the series TZID and return as the same local dates", () => {
    const { lines, backExdates, backParts } = roundTrip({
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      recurrenceExdates: ["2026-09-21", "2026-09-14"],
      allDay: false,
      timezone: CHICAGO,
      startsAt: new Date("2026-09-07T09:00:00-05:00"),
    });
    expect(lines).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;TZID=America/Chicago:20260914T090000,20260921T090000",
    ]);
    expect(backParts).toEqual(["FREQ=WEEKLY", "BYDAY=MO"]);
    expect(backExdates).toEqual(["2026-09-14", "2026-09-21"]);
  });

  it("a timed EXDATE across the DST fall-back keeps the wall-clock time, so the date never shifts", () => {
    const { backExdates } = roundTrip({
      rrule: "FREQ=DAILY",
      recurrenceExdates: ["2026-10-31", "2026-11-02"],
      allDay: false,
      timezone: CHICAGO,
      startsAt: new Date("2026-10-01T23:30:00-05:00"),
    });
    expect(backExdates).toEqual(["2026-10-31", "2026-11-02"]);
  });

  it("two all-day EXDATEs use VALUE=DATE and return as the same local dates", () => {
    const { lines, backExdates } = roundTrip({
      rrule: "FREQ=DAILY",
      recurrenceExdates: ["2026-09-15", "2026-09-15", "2026-09-10"],
      allDay: true,
      timezone: CHICAGO,
    });
    expect(lines).toEqual(["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20260910,20260915"]);
    expect(backExdates).toEqual(["2026-09-10", "2026-09-15"]);
  });

  it("a timed series with no DTSTART falls back to VALUE=DATE exdates, which the inbound parser also accepts", () => {
    const { lines, backExdates } = roundTrip({
      rrule: "FREQ=DAILY",
      recurrenceExdates: ["2026-09-15"],
      allDay: false,
      timezone: CHICAGO,
    });
    expect(lines[1]).toBe("EXDATE;VALUE=DATE:20260915");
    expect(backExdates).toEqual(["2026-09-15"]);
  });

  it("returns no lines at all for a rule with no FREQ, never an empty RRULE line", () => {
    expect(localRecurrenceToGoogle({ rrule: "", allDay: false, timezone: CHICAGO })).toEqual([]);
    expect(localRecurrenceToGoogle({ rrule: "RRULE:", allDay: false, timezone: CHICAGO })).toEqual(
      [],
    );
  });

  it("ignores exdates that are not YYYY-MM-DD rather than emitting a malformed line", () => {
    const lines = localRecurrenceToGoogle({
      rrule: "FREQ=DAILY",
      recurrenceExdates: ["not-a-date", "2026-09-15"],
      allDay: true,
      timezone: CHICAGO,
    });
    expect(lines).toEqual(["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20260915"]);
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

  it("an all-day master with no start.timeZone reads its recurrence in the EXISTING local row's zone before the connection default (fixer review, MAJOR-D)", () => {
    const event: GoogleCalendarEvent = {
      id: "allday-master",
      status: "confirmed",
      summary: "Holiday block",
      start: { date: "2026-12-28" },
      end: { date: "2026-12-29" },
      recurrence: ["RRULE:FREQ=DAILY;UNTIL=20261231"],
      etag: '"1"',
      updated: "2026-08-01T00:00:00Z",
      iCalUID: "uid@google.com",
    };
    const withExisting = mapGoogleEventToLocalUpsert(event, "master", {
      defaultTimezone: "UTC",
      existingTimezone: "America/Chicago",
    });
    if (withExisting.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(withExisting.fields.recurrenceTimezone).toBe("America/Chicago");
    expect(withExisting.fields.recurrenceUntil?.toISOString()).toBe("2027-01-01T05:59:59.999Z");
    // All-day rows carry no timed zone; the caller must not overwrite one.
    expect(withExisting.fields.timezone).toBeUndefined();

    const withoutExisting = mapGoogleEventToLocalUpsert(event, "master", {
      defaultTimezone: "UTC",
    });
    if (withoutExisting.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(withoutExisting.fields.recurrenceTimezone).toBe("UTC");

    // Google's own zone, when sent, wins over both.
    const withGoogleZone = mapGoogleEventToLocalUpsert(
      { ...event, start: { date: "2026-12-28", timeZone: "Europe/Berlin" } },
      "master",
      { defaultTimezone: "UTC", existingTimezone: "America/Chicago" },
    );
    if (withGoogleZone.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(withGoogleZone.fields.recurrenceTimezone).toBe("Europe/Berlin");
  });
});
