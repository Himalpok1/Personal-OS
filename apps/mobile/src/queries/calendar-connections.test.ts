import type { CalendarConnectionCalendar } from "@personal-os/schema";
import { describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { persistedCalendarConnectionCalendarsQueryOptions } from "./calendar-connections";

// This app has no render harness (see `ask.test.ts`'s and `monitor.test.ts`'s
// own notes on the same constraint), so `persistedCalendarConnectionCalendarsQueryOptions`
// is exported as a plain function -- same convention as `askCloudMutationOptions`
// -- specifically so its `queryFn` can be called directly here without a live
// `QueryClientProvider` tree.

function calendarRow(
  overrides: Partial<CalendarConnectionCalendar> = {},
): CalendarConnectionCalendar {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    connection_id: "22222222-2222-4222-8222-222222222222",
    google_calendar_id: "primary",
    caldav_calendar_url: null,
    summary: "Primary",
    sync_enabled: true,
    project_id: null,
    last_successful_sync_at: null,
    last_full_sync_at: null,
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("persistedCalendarConnectionCalendarsQueryOptions", () => {
  it("fetches persisted state from the real API -- the fix for the cold-launch bug", async () => {
    // Before Checkpoint 9.1, this hook's queryFn was
    // `() => Promise.resolve([] as CalendarConnectionCalendar[])`, unconditionally --
    // it never called the backend, so this spy would never have been hit and
    // the assertions below would have failed against a stub that always
    // resolves []. This is exactly the cold-launch scenario the bug report
    // describes: no prior toggle this session, real persisted state must
    // still surface.
    const enabledRow = calendarRow({ sync_enabled: true });
    const spy = vi
      .spyOn(api, "listCalendarConnectionCalendars")
      .mockResolvedValue([enabledRow]);

    const options = persistedCalendarConnectionCalendarsQueryOptions("connection-1");
    const result = await options.queryFn();

    expect(spy).toHaveBeenCalledWith("connection-1");
    expect(result).toEqual([enabledRow]);
    spy.mockRestore();
  });

  it("surfaces a disabled calendar as sync_enabled: false, independently of an enabled one", async () => {
    // Two-calendar isolation at the client boundary: the query must not
    // collapse or conflate rows from the same connection.
    const enabledRow = calendarRow({ google_calendar_id: "primary", sync_enabled: true });
    const disabledRow = calendarRow({
      id: "33333333-3333-4333-8333-333333333333",
      google_calendar_id: "work@group.calendar.google.com",
      summary: "Work",
      sync_enabled: false,
    });
    const spy = vi
      .spyOn(api, "listCalendarConnectionCalendars")
      .mockResolvedValue([enabledRow, disabledRow]);

    const result = await persistedCalendarConnectionCalendarsQueryOptions("connection-1").queryFn();

    expect(result.find((r) => r.google_calendar_id === "primary")?.sync_enabled).toBe(true);
    expect(result.find((r) => r.google_calendar_id === "work@group.calendar.google.com")?.sync_enabled).toBe(
      false,
    );
    spy.mockRestore();
  });

  it("is disabled when connectionId is undefined, same as the sibling available-calendars queries", () => {
    expect(persistedCalendarConnectionCalendarsQueryOptions(undefined).enabled).toBe(false);
  });

  it("keys the query per-connection so two connections' caches never collide", () => {
    const a = persistedCalendarConnectionCalendarsQueryOptions("connection-a").queryKey;
    const b = persistedCalendarConnectionCalendarsQueryOptions("connection-b").queryKey;
    expect(a).not.toEqual(b);
  });
});
