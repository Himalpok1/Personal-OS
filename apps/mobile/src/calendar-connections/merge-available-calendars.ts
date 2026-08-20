import type { AvailableGoogleCalendar, CalendarConnectionCalendar } from "@personal-os/schema";

// Pure, no expo/react imports -- same reasoning as reconcile.ts and
// resolve-notification-route.ts. Google's live calendarList.list passthrough
// (AvailableGoogleCalendarSchema) has no notion of sync_enabled -- that only
// exists on the persisted opt-in row (CalendarConnectionCalendarSchema).
// This merges the two so the Settings picker can render one row per
// available calendar with its current opt-in state, defaulting to
// "not yet synced" for a calendar that exists on Google but has never been
// toggled on in Personal OS.
export interface MergedGoogleCalendar {
  google_calendar_id: string;
  summary: string;
  primary: boolean;
  sync_enabled: boolean;
  last_successful_sync_at: string | null;
}

export function mergeAvailableCalendars(
  available: AvailableGoogleCalendar[],
  persisted: CalendarConnectionCalendar[],
): MergedGoogleCalendar[] {
  const persistedById = new Map(persisted.map((cal) => [cal.google_calendar_id, cal]));

  return available.map((cal) => {
    const existing = persistedById.get(cal.google_calendar_id);
    return {
      google_calendar_id: cal.google_calendar_id,
      summary: cal.summary,
      primary: cal.primary,
      sync_enabled: existing?.sync_enabled ?? false,
      last_successful_sync_at: existing?.last_successful_sync_at ?? null,
    };
  });
}
