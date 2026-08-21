import type {
  AvailableCalendar,
  AvailableGoogleCalendar,
  CalendarConnectionCalendar,
} from "@personal-os/schema";

export interface MergedCalendarItem {
  key: string;
  google_calendar_id?: string;
  caldav_calendar_url?: string;
  summary: string;
  color?: string | null;
  primary: boolean;
  sync_enabled: boolean;
  last_successful_sync_at: string | null;
}

export type MergedGoogleCalendar = MergedCalendarItem & { google_calendar_id: string };

export function mergeAvailableCalendars(
  available: Array<AvailableGoogleCalendar | AvailableCalendar>,
  persisted: CalendarConnectionCalendar[],
): MergedCalendarItem[] {
  const persistedByGoogleId = new Map(
    persisted
      .filter((cal) => Boolean(cal.google_calendar_id))
      .map((cal) => [cal.google_calendar_id!, cal]),
  );
  const persistedByCaldavUrl = new Map(
    persisted
      .filter((cal) => Boolean(cal.caldav_calendar_url))
      .map((cal) => [cal.caldav_calendar_url!, cal]),
  );

  return available.map((cal) => {
    const googleId = "google_calendar_id" in cal ? cal.google_calendar_id : undefined;
    const caldavUrl = "caldav_calendar_url" in cal ? cal.caldav_calendar_url : undefined;
    const key = googleId || caldavUrl || ("id" in cal ? cal.id : "unknown");

    const existing = googleId
      ? persistedByGoogleId.get(googleId)
      : caldavUrl
        ? persistedByCaldavUrl.get(caldavUrl)
        : undefined;

    return {
      key,
      google_calendar_id: googleId,
      caldav_calendar_url: caldavUrl,
      summary: cal.summary,
      color: "color" in cal ? cal.color : null,
      primary: Boolean(cal.primary),
      sync_enabled: existing?.sync_enabled ?? false,
      last_successful_sync_at: existing?.last_successful_sync_at ?? null,
    };
  });
}
