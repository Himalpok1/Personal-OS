import { describe, expect, it } from "vitest";
import { mergeAvailableCalendars } from "./merge-available-calendars";

function persistedCalendar(overrides: Partial<Parameters<typeof mergeAvailableCalendars>[1][number]> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    connection_id: "22222222-2222-4222-8222-222222222222",
    google_calendar_id: "primary",
    caldav_calendar_url: null,
    summary: "stale summary",
    sync_enabled: true,
    project_id: null,
    last_successful_sync_at: "2026-08-19T00:00:00.000Z",
    last_full_sync_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeAvailableCalendars", () => {
  it("defaults an available Google calendar with no persisted row to sync_enabled: false", () => {
    const result = mergeAvailableCalendars(
      [{ google_calendar_id: "work", summary: "Work", primary: false }],
      [],
    );
    expect(result).toEqual([
      {
        key: "work",
        google_calendar_id: "work",
        caldav_calendar_url: undefined,
        summary: "Work",
        color: null,
        primary: false,
        sync_enabled: false,
        last_successful_sync_at: null,
      },
    ]);
  });

  it("carries over sync_enabled and last_successful_sync_at from the persisted row", () => {
    const result = mergeAvailableCalendars(
      [{ google_calendar_id: "primary", summary: "Live summary", primary: true }],
      [persistedCalendar()],
    );
    expect(result).toEqual([
      {
        key: "primary",
        google_calendar_id: "primary",
        caldav_calendar_url: undefined,
        summary: "Live summary",
        color: null,
        primary: true,
        sync_enabled: true,
        last_successful_sync_at: "2026-08-19T00:00:00.000Z",
      },
    ]);
  });

  it("merges CalDAV collections matching by caldav_calendar_url", () => {
    const result = mergeAvailableCalendars(
      [
        {
          id: "/calendars/users/me/work/",
          caldav_calendar_url: "/calendars/users/me/work/",
          summary: "Work Collection",
          color: "#0055ff",
        },
      ],
      [
        persistedCalendar({
          google_calendar_id: null,
          caldav_calendar_url: "/calendars/users/me/work/",
          sync_enabled: true,
          last_successful_sync_at: "2026-08-20T12:00:00.000Z",
        }),
      ],
    );

    expect(result).toEqual([
      {
        key: "/calendars/users/me/work/",
        google_calendar_id: undefined,
        caldav_calendar_url: "/calendars/users/me/work/",
        summary: "Work Collection",
        color: "#0055ff",
        primary: false,
        sync_enabled: true,
        last_successful_sync_at: "2026-08-20T12:00:00.000Z",
      },
    ]);
  });
});
