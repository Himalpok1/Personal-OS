import { describe, expect, it } from "vitest";
import { mergeAvailableCalendars } from "./merge-available-calendars";

function persistedCalendar(overrides: Partial<Parameters<typeof mergeAvailableCalendars>[1][number]> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    connection_id: "22222222-2222-4222-8222-222222222222",
    google_calendar_id: "primary",
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
  it("defaults an available calendar with no persisted row to sync_enabled: false", () => {
    const result = mergeAvailableCalendars(
      [{ google_calendar_id: "work", summary: "Work", primary: false }],
      [],
    );
    expect(result).toEqual([
      {
        google_calendar_id: "work",
        summary: "Work",
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
        google_calendar_id: "primary",
        summary: "Live summary",
        primary: true,
        sync_enabled: true,
        last_successful_sync_at: "2026-08-19T00:00:00.000Z",
      },
    ]);
  });

  it("prefers Google's live summary over the persisted (possibly stale) one", () => {
    const result = mergeAvailableCalendars(
      [{ google_calendar_id: "primary", summary: "Renamed Calendar", primary: true }],
      [persistedCalendar({ summary: "Old Name" })],
    );
    expect(result[0]?.summary).toBe("Renamed Calendar");
  });

  it("drops a persisted calendar that no longer appears in the live Google list", () => {
    const result = mergeAvailableCalendars(
      [],
      [persistedCalendar({ google_calendar_id: "deleted-on-google" })],
    );
    expect(result).toEqual([]);
  });

  it("preserves the order of the available list, not the persisted list", () => {
    const result = mergeAvailableCalendars(
      [
        { google_calendar_id: "b", summary: "B", primary: false },
        { google_calendar_id: "a", summary: "A", primary: true },
      ],
      [persistedCalendar({ google_calendar_id: "a", sync_enabled: false })],
    );
    expect(result.map((c) => c.google_calendar_id)).toEqual(["b", "a"]);
  });
});
