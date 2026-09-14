import {
  ENTITY_TITLE_MAX_CHARS,
  EVENT_DESCRIPTION_MAX_CHARS,
  EVENT_LOCATION_MAX_CHARS,
} from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  applyExceptionToVCalendar,
  localEventToVCalendar,
  parseVCalendarToMutationIntents,
} from "./translate.js";

describe("CalDAV RFC 5545 Translation", () => {
  it("serializes and parses a one-off timed event", () => {
    const start = new Date("2026-08-21T14:00:00.000Z");
    const end = new Date("2026-08-21T15:00:00.000Z");
    const ics = localEventToVCalendar({
      title: "Dentist Appointment",
      description: "Annual cleaning",
      location: "Dental Clinic",
      allDay: false,
      startsAt: start,
      endsAt: end,
      timezone: "America/Chicago",
    });

    expect(ics).toContain("SUMMARY:Dentist Appointment");
    expect(ics).toContain("DESCRIPTION:Annual cleaning");
    expect(ics).toContain("LOCATION:Dental Clinic");

    const intents = parseVCalendarToMutationIntents(ics, "/dav/cal/event1.ics", "etag-1");
    expect(intents).toHaveLength(1);
    const intent = intents[0]!;
    expect(intent.kind).toBe("upsert_standalone_or_master");
    if (intent.kind === "upsert_standalone_or_master") {
      expect(intent.fields.title).toBe("Dentist Appointment");
      expect(intent.fields.description).toBe("Annual cleaning");
      expect(intent.fields.allDay).toBe(false);
      expect(intent.fields.startsAt?.toISOString()).toBe(start.toISOString());
      expect(intent.fields.endsAt?.toISOString()).toBe(end.toISOString());
      expect(intent.fields.caldavResourceUrl).toBe("/dav/cal/event1.ics");
      expect(intent.fields.caldavEtag).toBe("etag-1");
    }
  });

  it("serializes and parses an all-day event with invertible inclusive/exclusive bounds", () => {
    const ics = localEventToVCalendar({
      title: "Camping Trip",
      allDay: true,
      startDate: "2026-08-22",
      endDate: "2026-08-24", // 3 days inclusive
      timezone: "UTC",
    });

    // DTEND in RFC 5545 should be 20260825 (exclusive)
    expect(ics).toContain("DTSTART;VALUE=DATE:20260822");
    expect(ics).toContain("DTEND;VALUE=DATE:20260825");

    const intents = parseVCalendarToMutationIntents(ics, "/dav/cal/camping.ics", "etag-2");
    expect(intents).toHaveLength(1);
    const intent = intents[0]!;
    expect(intent.kind).toBe("upsert_standalone_or_master");
    if (intent.kind === "upsert_standalone_or_master") {
      expect(intent.fields.allDay).toBe(true);
      expect(intent.fields.startDate).toBe("2026-08-22");
      expect(intent.fields.endDate).toBe("2026-08-24"); // Back to inclusive
    }
  });

  it("serializes and parses a recurring master event with RRULE, UNTIL, and EXDATE", () => {
    const start = new Date("2026-08-21T14:00:00.000Z");
    const until = new Date("2026-12-31T23:59:59.000Z");
    const ics = localEventToVCalendar({
      title: "Weekly Sync",
      allDay: false,
      startsAt: start,
      endsAt: new Date("2026-08-21T15:00:00.000Z"),
      timezone: "America/Chicago",
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      recurrenceUntil: until,
      recurrenceExdates: ["2026-08-28"],
    });

    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T235959Z");
    expect(ics).toContain("EXDATE;VALUE=DATE:20260828");

    const intents = parseVCalendarToMutationIntents(ics, "/dav/cal/sync.ics", "etag-3");
    expect(intents).toHaveLength(1);
    const intent = intents[0]!;
    expect(intent.kind).toBe("upsert_standalone_or_master");
    if (intent.kind === "upsert_standalone_or_master") {
      expect(intent.fields.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
      expect(intent.fields.recurrenceUntil?.toISOString()).toBe(until.toISOString());
      expect(intent.fields.recurrenceExdates).toEqual(["2026-08-28"]);
    }
  });

  it("modifies an existing recurring resource to apply a detached single occurrence (RFC 4791 single resource model)", () => {
    const originalStart = new Date("2026-08-21T14:00:00.000Z");
    const masterIcs = localEventToVCalendar({
      title: "Team Meeting",
      allDay: false,
      startsAt: originalStart,
      endsAt: new Date("2026-08-21T15:00:00.000Z"),
      timezone: "America/Chicago",
      rrule: "FREQ=WEEKLY;BYDAY=FR",
    });

    const movedStart = new Date("2026-08-28T16:00:00.000Z");
    const movedEnd = new Date("2026-08-28T17:00:00.000Z");
    const updatedIcs = applyExceptionToVCalendar(masterIcs, {
      kind: "detach",
      originalStartInstant: new Date("2026-08-28T14:00:00.000Z"),
      fields: {
        title: "Team Meeting (Rescheduled)",
        allDay: false,
        startsAt: movedStart,
        endsAt: movedEnd,
        timezone: "America/Chicago",
      },
    });

    expect(updatedIcs).toContain("SUMMARY:Team Meeting (Rescheduled)");
    expect(updatedIcs).toContain("RECURRENCE-ID");

    const intents = parseVCalendarToMutationIntents(updatedIcs, "/dav/cal/team.ics", "etag-4");
    expect(intents).toHaveLength(2);

    const masterIntent = intents.find((i) => i.kind === "upsert_standalone_or_master");
    const exceptionIntent = intents.find((i) => i.kind === "detach_instance");

    expect(masterIntent).toBeDefined();
    expect(exceptionIntent).toBeDefined();
    if (exceptionIntent && exceptionIntent.kind === "detach_instance") {
      expect(exceptionIntent.fields.title).toBe("Team Meeting (Rescheduled)");
      expect(exceptionIntent.fields.startsAt?.toISOString()).toBe(movedStart.toISOString());
    }
  });

  it("modifies an existing recurring resource to cancel a single occurrence", () => {
    const originalStart = new Date("2026-08-21T14:00:00.000Z");
    const masterIcs = localEventToVCalendar({
      title: "Standup",
      allDay: false,
      startsAt: originalStart,
      endsAt: new Date("2026-08-21T14:30:00.000Z"),
      timezone: "America/Chicago",
      rrule: "FREQ=DAILY",
    });

    const cancelledInstant = new Date("2026-08-22T14:00:00.000Z");
    const updatedIcs = applyExceptionToVCalendar(masterIcs, {
      kind: "cancel",
      originalStartInstant: cancelledInstant,
    });

    expect(updatedIcs).toContain("EXDATE;VALUE=DATE:20260822");

    const intents = parseVCalendarToMutationIntents(updatedIcs, "/dav/cal/standup.ics", "etag-5");
    const master = intents.find((i) => i.kind === "upsert_standalone_or_master");
    expect(master).toBeDefined();
    if (master && master.kind === "upsert_standalone_or_master") {
      expect(master.fields.recurrenceExdates).toContain("2026-08-22");
    }
  });
});

// Checkpoint 9.6 (ADR-065): the CalDAV ingest path applies the same
// truncate-at-write bounds as the Google path -- see translate.test.ts for
// the reasoning. Serialising through localEventToVCalendar first is
// deliberate: the over-long text has to survive RFC 5545 line folding and
// come back out of ical.js before it is bounded, which is exactly the path a
// real server's resource takes.
describe("CalDAV ingest bounds provider text at write", () => {
  const start = new Date("2026-08-21T14:00:00.000Z");
  const end = new Date("2026-08-21T15:00:00.000Z");

  it("truncates an over-long SUMMARY, DESCRIPTION and LOCATION to the shared bounds", () => {
    const ics = localEventToVCalendar({
      title: "t".repeat(ENTITY_TITLE_MAX_CHARS + 100),
      description: "d".repeat(EVENT_DESCRIPTION_MAX_CHARS + 100),
      location: "l".repeat(EVENT_LOCATION_MAX_CHARS + 100),
      allDay: false,
      startsAt: start,
      endsAt: end,
      timezone: "UTC",
    });
    const intents = parseVCalendarToMutationIntents(ics, "/dav/cal/long.ics", "etag-long");
    expect(intents).toHaveLength(1);
    const intent = intents[0]!;
    if (intent.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(intent.fields.title).toHaveLength(ENTITY_TITLE_MAX_CHARS);
    expect(intent.fields.description).toHaveLength(EVENT_DESCRIPTION_MAX_CHARS);
    expect(intent.fields.location).toHaveLength(EVENT_LOCATION_MAX_CHARS);
  });

  it("never cuts a surrogate pair in half", () => {
    const ics = localEventToVCalendar({
      title: "x".repeat(ENTITY_TITLE_MAX_CHARS - 1) + "\u{1F600}" + "tail",
      allDay: false,
      startsAt: start,
      endsAt: end,
      timezone: "UTC",
    });
    const intent = parseVCalendarToMutationIntents(ics, "/dav/cal/emoji.ics", "etag-e")[0]!;
    if (intent.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(intent.fields.title).toHaveLength(ENTITY_TITLE_MAX_CHARS - 1);
    expect(intent.fields.title.endsWith("x")).toBe(true);
  });

  it("leaves text within the bounds byte-identical", () => {
    const ics = localEventToVCalendar({
      title: "Dentist \u{1F600}",
      description: "Annual cleaning",
      location: "Dental Clinic",
      allDay: false,
      startsAt: start,
      endsAt: end,
      timezone: "UTC",
    });
    const intent = parseVCalendarToMutationIntents(ics, "/dav/cal/ok.ics", "etag-ok")[0]!;
    if (intent.kind !== "upsert_standalone_or_master") throw new Error("unreachable");
    expect(intent.fields.title).toBe("Dentist \u{1F600}");
    expect(intent.fields.description).toBe("Annual cleaning");
    expect(intent.fields.location).toBe("Dental Clinic");
  });
});
