import { ApiClientError } from "@personal-os/api-client";
import type { CalendarTarget, EventSyncState } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  allDayRangeError,
  applyStartDateChange,
  applyStartsAtChange,
  buildEventCreateBody,
  calendarLabel,
  classifyEventMutationError,
  defaultEndFor,
  EVENT_NOT_OWNED_MESSAGE,
  eventMutationErrorCopy,
  eventWhenLabel,
  externalCalendarLabel,
  initialClientUuidState,
  LINKED_SERIES_DETACH_MESSAGE,
  markAttemptFailed,
  nextClientUuidAfterEdit,
  SYNC_CONFLICT_LINE,
  SYNC_ERROR_FALLBACK_LINE,
  syncStatusLine,
  timedRangeError,
  toCalendarBody,
  type ClientUuidState,
  type EventFormValues,
} from "./event-form-state";

const TZ = "America/Chicago";

const GOOGLE_TARGET: CalendarTarget = {
  connection_id: "11111111-1111-4111-8111-111111111111",
  provider: "google",
  google_calendar_id: "primary",
  caldav_calendar_url: null,
  summary: "Work",
  access_role: "owner",
};
const CALDAV_TARGET: CalendarTarget = {
  connection_id: "22222222-2222-4222-8222-222222222222",
  provider: "caldav",
  google_calendar_id: null,
  caldav_calendar_url: "https://dav.example/cal/home/",
  summary: "Home",
  access_role: null,
};

describe("timed start/end coupling", () => {
  it("defaults the end to start + 1 h in the given zone", () => {
    expect(defaultEndFor("2026-09-15T14:00:00-05:00", TZ)).toBe("2026-09-15T15:00:00-05:00");
    expect(defaultEndFor("garbage", TZ)).toBeNull();
  });

  it("moving the start keeps the duration", () => {
    const next = applyStartsAtChange(
      { startsAt: "2026-09-15T14:00:00-05:00", endsAt: "2026-09-15T15:30:00-05:00" },
      "2026-09-15T16:00:00-05:00",
      TZ,
    );
    expect(next).toEqual({
      startsAt: "2026-09-15T16:00:00-05:00",
      endsAt: "2026-09-15T17:30:00-05:00",
    });
  });

  it("with no usable end yet, the end becomes start + 1 h", () => {
    for (const endsAt of [null, "not a date", "2026-09-15T13:00:00-05:00"]) {
      const next = applyStartsAtChange({ startsAt: null, endsAt }, "2026-09-15T14:00:00-05:00", TZ);
      expect(next.endsAt, String(endsAt)).toBe("2026-09-15T15:00:00-05:00");
    }
  });

  it("keeps the duration across a DST fall-back day in wall-clock terms of the zone offset", () => {
    // 2026-11-01 is the US fall-back. A 1 h duration is an elapsed hour, so
    // the end carries the post-transition offset.
    const next = applyStartsAtChange(
      { startsAt: "2026-09-15T14:00:00-05:00", endsAt: "2026-09-15T15:00:00-05:00" },
      "2026-11-01T01:30:00-05:00",
      TZ,
    );
    expect(next.endsAt).toBe("2026-11-01T01:30:00-06:00");
  });

  it("clearing the start clears the end", () => {
    expect(
      applyStartsAtChange(
        { startsAt: "2026-09-15T14:00:00-05:00", endsAt: "2026-09-15T15:00:00-05:00" },
        null,
        TZ,
      ),
    ).toEqual({ startsAt: null, endsAt: null });
  });

  it("refuses a missing start, a missing end and an end at or before the start", () => {
    expect(timedRangeError({ startsAt: null, endsAt: null })).toBe("start_required");
    expect(timedRangeError({ startsAt: "2026-09-15T14:00:00-05:00", endsAt: null })).toBe(
      "end_required",
    );
    expect(
      timedRangeError({
        startsAt: "2026-09-15T14:00:00-05:00",
        endsAt: "2026-09-15T14:00:00-05:00",
      }),
    ).toBe("end_before_start");
    expect(
      timedRangeError({
        startsAt: "2026-09-15T14:00:00-05:00",
        endsAt: "2026-09-15T15:00:00-05:00",
      }),
    ).toBeNull();
  });
});

describe("all-day start/end coupling", () => {
  it("moving the start never leaves the end before it", () => {
    expect(
      applyStartDateChange({ startDate: "2026-09-10", endDate: "2026-09-12" }, "2026-09-11"),
    ).toEqual({ startDate: "2026-09-11", endDate: "2026-09-12" });
    expect(
      applyStartDateChange({ startDate: "2026-09-10", endDate: "2026-09-12" }, "2026-09-20"),
    ).toEqual({ startDate: "2026-09-20", endDate: "2026-09-20" });
    expect(applyStartDateChange({ startDate: null, endDate: null }, "2026-09-20")).toEqual({
      startDate: "2026-09-20",
      endDate: "2026-09-20",
    });
  });

  it("refuses a missing start and an end before the start", () => {
    expect(allDayRangeError({ startDate: null, endDate: null })).toBe("start_date_required");
    expect(allDayRangeError({ startDate: "2026-09-15", endDate: "2026-09-14" })).toBe(
      "end_date_before_start",
    );
    expect(allDayRangeError({ startDate: "2026-09-15", endDate: null })).toBeNull();
    expect(allDayRangeError({ startDate: "2026-09-15", endDate: "2026-09-15" })).toBeNull();
  });
});

describe("buildEventCreateBody", () => {
  const base: EventFormValues = {
    title: "  Dentist  ",
    description: "",
    location: " Clinic ",
    allDay: false,
    timed: { startsAt: "2026-09-15T14:00:00-05:00", endsAt: "2026-09-15T15:00:00-05:00" },
    allDayRange: { startDate: null, endDate: null },
    projectId: undefined,
    calendar: null,
  };
  const uuid = "33333333-3333-4333-8333-333333333333";

  it("sends the SAME client_uuid on every attempt it is built with", () => {
    const first = buildEventCreateBody(base, { clientUuid: uuid, timezone: TZ, recurrence: null });
    const second = buildEventCreateBody(base, { clientUuid: uuid, timezone: TZ, recurrence: null });
    expect(first.client_uuid).toBe(uuid);
    expect(second.client_uuid).toBe(uuid);
    expect(first).toEqual(second);
  });

  it("builds a timed body with trimmed text, no calendar and no recurrence", () => {
    const body = buildEventCreateBody(base, { clientUuid: uuid, timezone: TZ, recurrence: null });
    expect(body).toEqual({
      title: "Dentist",
      description: undefined,
      location: "Clinic",
      timezone: TZ,
      project_id: undefined,
      all_day: false,
      client_uuid: uuid,
      starts_at: "2026-09-15T14:00:00-05:00",
      ends_at: "2026-09-15T15:00:00-05:00",
    });
    expect("calendar" in body).toBe(false);
    expect("rrule" in body).toBe(false);
  });

  it("builds an all-day body with the end defaulting to the start, and the calendar selector", () => {
    const body = buildEventCreateBody(
      {
        ...base,
        allDay: true,
        allDayRange: { startDate: "2026-09-15", endDate: null },
        calendar: GOOGLE_TARGET,
      },
      { clientUuid: uuid, timezone: TZ, recurrence: null },
    );
    expect(body.all_day).toBe(true);
    expect(body.start_date).toBe("2026-09-15");
    expect(body.end_date).toBe("2026-09-15");
    expect(body.starts_at).toBeUndefined();
    expect(body.calendar).toEqual({
      connection_id: GOOGLE_TARGET.connection_id,
      google_calendar_id: "primary",
    });
  });

  it("carries a serialized rule with the zone defaulting to the device's", () => {
    const body = buildEventCreateBody(base, {
      clientUuid: uuid,
      timezone: TZ,
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        recurrence_timezone: null,
        recurrence_until: new Date("2026-12-31T05:59:59.999Z"),
        recurrence_count: null,
        recurrence_anchor: "due_date",
      },
    });
    expect(body.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(body.recurrence_timezone).toBe(TZ);
    expect(body.recurrence_until).toBe("2026-12-31T05:59:59.999Z");
    expect(body.recurrence_count).toBeUndefined();
  });

  it("toCalendarBody picks exactly one selector per provider", () => {
    expect(toCalendarBody(CALDAV_TARGET)).toEqual({
      connection_id: CALDAV_TARGET.connection_id,
      caldav_calendar_url: "https://dav.example/cal/home/",
    });
  });
});

describe("calendar and sync copy", () => {
  const linked: EventSyncState = {
    status: "synced",
    connection_id: GOOGLE_TARGET.connection_id,
    google_calendar_id: "primary",
    caldav_calendar_url: null,
    last_error: null,
  };

  it("names the calendar when it is a known target, and stays generic otherwise", () => {
    expect(calendarLabel(null, [GOOGLE_TARGET])).toBe("Not synced to a calendar");
    expect(calendarLabel(linked, [GOOGLE_TARGET, CALDAV_TARGET])).toBe("Synced to Work");
    expect(calendarLabel(linked, [])).toBe("Synced to a connected calendar");
    expect(
      calendarLabel(
        {
          ...linked,
          connection_id: CALDAV_TARGET.connection_id,
          google_calendar_id: null,
          caldav_calendar_url: CALDAV_TARGET.caldav_calendar_url,
        },
        [GOOGLE_TARGET, CALDAV_TARGET],
      ),
    ).toBe("Synced to Home");
    expect(externalCalendarLabel(linked, [GOOGLE_TARGET])).toBe("From Work · read-only");
    expect(externalCalendarLabel(null, [GOOGLE_TARGET])).toBe(
      "From connected calendar · read-only",
    );
  });

  it("renders one status line per sync state, nothing for synced or unlinked", () => {
    expect(syncStatusLine(null)).toBeNull();
    expect(syncStatusLine(linked)).toBeNull();
    expect(syncStatusLine({ ...linked, status: "pending_push" })).toBe("Syncing to calendar…");
    // The inbound conflict branch applies NOTHING and parks the link, so the
    // line never claims the calendar's version won; a save retries.
    expect(syncStatusLine({ ...linked, status: "conflict" })).toBe(SYNC_CONFLICT_LINE);
    expect(SYNC_CONFLICT_LINE).toBe(
      "Calendar conflict — your latest edit hasn't been synced. Save it again to retry.",
    );
    expect(syncStatusLine({ ...linked, status: "error" })).toBe(SYNC_ERROR_FALLBACK_LINE);
    expect(syncStatusLine({ ...linked, status: "error", last_error: "missing_scope" })).toBe(
      "Calendar sync failed: calendar not writable",
    );
    expect(syncStatusLine({ ...linked, status: "error", last_error: "auth_expired" })).toBe(
      "Calendar sync failed: reconnect the calendar",
    );
    // A code with no phrase of its own is never echoed.
    expect(syncStatusLine({ ...linked, status: "error", last_error: "provider_error" })).toBe(
      SYNC_ERROR_FALLBACK_LINE,
    );
  });

  it("gives each 9.5 error code its own line, and none of them promise a retry", () => {
    const line = (last_error: EventSyncState["last_error"]) =>
      syncStatusLine({ ...linked, status: "error", last_error });
    expect(line("invalid_request")).toBe("Calendar rejected this event — edit it to retry");
    expect(line("connection_inactive")).toBe("Calendar disconnected — reconnect it in Settings");
    expect(line("not_found")).toBe("Calendar event no longer exists");
    expect(line("retries_exhausted")).toBe("Calendar sync failed — edit it to retry");
    expect(line("auth_failed")).toBe("Calendar sync failed: reconnect the calendar");
    // `calendar_not_writable` is not in the enum today; the map is keyed by
    // string so a later addition renders correctly rather than falling back.
    expect(line("calendar_not_writable" as never)).toBe(
      "Calendar sync failed: calendar not writable",
    );
    expect(SYNC_ERROR_FALLBACK_LINE).toBe("Calendar sync failed");
    for (const code of [
      "invalid_request",
      "connection_inactive",
      "not_found",
      "retries_exhausted",
      "rate_limited",
      "provider_unavailable",
      "network_error",
      "provider_error",
      null,
    ] as const) {
      expect(line(code)).not.toMatch(/will retry/i);
    }
  });
});

describe("classifyEventMutationError", () => {
  it("recognises 409 event_not_owned and renders the ownership line", () => {
    const failure = classifyEventMutationError(new ApiClientError(409, "event_not_owned"));
    expect(failure).toBe("not_owned");
    expect(eventMutationErrorCopy(failure, "save those changes")).toBe(EVENT_NOT_OWNED_MESSAGE);
  });

  it("recognises 409 linked_series_detach_unsupported and renders the linked-series line", () => {
    const failure = classifyEventMutationError(
      new ApiClientError(409, "linked_series_detach_unsupported"),
    );
    expect(failure).toBe("linked_detach");
    expect(eventMutationErrorCopy(failure, "save this occurrence")).toBe(
      LINKED_SERIES_DETACH_MESSAGE,
    );
    expect(LINKED_SERIES_DETACH_MESSAGE).toBe(
      "Single occurrences of a synced series can't be edited yet — edit the whole series or cancel this occurrence.",
    );
    // The status matters: the same code on any other status is not the refusal.
    expect(
      classifyEventMutationError(new ApiClientError(400, "linked_series_detach_unsupported")),
    ).toBe("unknown");
  });

  it("keeps other failures distinct and never echoes the error message", () => {
    expect(classifyEventMutationError(new ApiClientError(404, "not_found"))).toBe("not_found");
    expect(classifyEventMutationError(new ApiClientError(400, "validation_failed"))).toBe(
      "validation",
    );
    expect(classifyEventMutationError(new ApiClientError(409, "already_linked"))).toBe("unknown");
    expect(classifyEventMutationError(new Error("boom"))).toBe("unknown");
    for (const failure of [
      "not_owned",
      "linked_detach",
      "not_found",
      "validation",
      "unknown",
    ] as const) {
      expect(eventMutationErrorCopy(failure, "save")).not.toContain("boom");
    }
  });
});

describe("client_uuid across a failed attempt", () => {
  const mint = (() => {
    let n = 0;
    return () => `uuid-${++n}`;
  })();

  it("mints once, and a retry WITHOUT edits keeps the uuid (a true idempotent retry)", () => {
    const initial = initialClientUuidState(mint);
    expect(initial).toEqual({ clientUuid: "uuid-1", attemptFailed: false });
    const failed = markAttemptFailed(initial);
    expect(failed.clientUuid).toBe("uuid-1");
    expect(failed.attemptFailed).toBe(true);
    // Marking twice is a no-op; no field changed, so the next tap reuses it.
    expect(markAttemptFailed(failed)).toBe(failed);
  });

  it("an edit AFTER a failed attempt is a new intent and gets a new uuid, once", () => {
    const failed: ClientUuidState = { clientUuid: "uuid-a", attemptFailed: true };
    const edited = nextClientUuidAfterEdit(failed, mint);
    expect(edited.clientUuid).not.toBe("uuid-a");
    expect(edited.attemptFailed).toBe(false);
    // A second edit before the next attempt does not churn the uuid again.
    expect(nextClientUuidAfterEdit(edited, mint)).toBe(edited);
  });

  it("an edit BEFORE any attempt keeps the uuid: nothing has been sent yet", () => {
    const fresh: ClientUuidState = { clientUuid: "uuid-b", attemptFailed: false };
    expect(nextClientUuidAfterEdit(fresh, mint)).toBe(fresh);
    expect(fresh.clientUuid).toBe("uuid-b");
  });
});

describe("eventWhenLabel", () => {
  it("shows the INSTANCE's date for an all-day recurring occurrence, not the template's (second-round review)", () => {
    // A yearly all-day series whose template is decades back; the card that
    // opened this screen is the 2026 instance, anchored at local noon in
    // Pacific/Auckland (UTC+12 in May) -- 2026-05-03T00:00:00Z.
    const label = eventWhenLabel(
      {
        all_day: true,
        starts_at: null,
        ends_at: null,
        start_date: "1990-05-03",
        end_date: "1990-05-03",
        timezone: "UTC",
        recurrence_timezone: "Pacific/Auckland",
      },
      "2026-05-03T00:00:00.000Z",
    );
    expect(label).toMatch(/2026/);
    expect(label).not.toMatch(/1990/);
    expect(label).toMatch(/3.*· all day$/);
    // A 3-day template span is carried onto the instance.
    const span = eventWhenLabel(
      {
        all_day: true,
        starts_at: null,
        ends_at: null,
        start_date: "2026-01-05",
        end_date: "2026-01-07",
        timezone: "America/Chicago",
        recurrence_timezone: null,
      },
      "2026-03-09T17:00:00.000Z", // local noon CDT on 2026-03-09
    );
    expect(span).toMatch(/Mar 9.*Mar 11.*· all day$/);
    // Without a zone the template dates are shown unchanged (no guess).
    expect(
      eventWhenLabel(
        { all_day: true, starts_at: null, ends_at: null, start_date: "1990-05-03", end_date: null },
        "2026-05-03T00:00:00.000Z",
      ),
    ).toMatch(/1990/);
  });

  it("shows calendar dates only for an all-day event, never a time", () => {
    expect(
      eventWhenLabel({
        all_day: true,
        starts_at: null,
        ends_at: null,
        start_date: "2026-09-15",
        end_date: "2026-09-15",
      }),
    ).toMatch(/^.*15.*· all day$/);
    const span = eventWhenLabel({
      all_day: true,
      starts_at: null,
      ends_at: null,
      start_date: "2026-09-15",
      end_date: "2026-09-17",
    });
    expect(span).toContain(" – ");
    expect(span).toMatch(/all day$/);
    expect(span).not.toMatch(/12:00/);
  });

  it("positions a recurring timed instance by occursAt, keeping the template duration", () => {
    const label = eventWhenLabel(
      {
        all_day: false,
        starts_at: "2026-09-01T14:00:00.000Z",
        ends_at: "2026-09-01T15:30:00.000Z",
        start_date: null,
        end_date: null,
      },
      "2026-09-15T14:00:00.000Z",
    );
    expect(label).toMatch(/15/);
    expect(label).toContain(" – ");
    expect(label).not.toMatch(/Sep 1,/);
  });

  it("is honest when the time is unreadable", () => {
    expect(
      eventWhenLabel({
        all_day: false,
        starts_at: null,
        ends_at: null,
        start_date: null,
        end_date: null,
      }),
    ).toBe("Time not set");
  });
});
