import { z } from "zod";

export const CalendarConnectionProviderSchema = z.enum(["google", "caldav"]);
export type CalendarConnectionProvider = z.infer<typeof CalendarConnectionProviderSchema>;

export const CalendarConnectionStatusSchema = z.enum([
  "active",
  "needs_reauth",
  "revoked",
  "disconnected",
]);
export type CalendarConnectionStatus = z.infer<typeof CalendarConnectionStatusSchema>;

export const CalendarSyncStatusSchema = z.enum(["synced", "pending_push", "conflict", "error"]);
export type CalendarSyncStatus = z.infer<typeof CalendarSyncStatusSchema>;

// Response shape only. Deliberately excludes every token/credential field
// (access_token_*, refresh_token_*, password_*).
export const CalendarConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: CalendarConnectionProviderSchema,
  // Google-specific fields
  google_account_email: z.string().nullable().optional(),
  granted_scope: z.string().nullable().optional(),
  // CalDAV-specific fields
  server_url: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  auth_type: z.string().nullable().optional(),
  // Common fields
  status: CalendarConnectionStatusSchema,
  last_sync_error: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type CalendarConnection = z.infer<typeof CalendarConnectionSchema>;

export const CalendarConnectionCalendarSchema = z.object({
  id: z.string().uuid(),
  connection_id: z.string().uuid(),
  google_calendar_id: z.string().nullable().optional(),
  caldav_calendar_url: z.string().nullable().optional(),
  summary: z.string(),
  sync_enabled: z.boolean(),
  project_id: z.string().uuid().nullable(),
  last_successful_sync_at: z.string().datetime({ offset: true }).nullable(),
  last_full_sync_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type CalendarConnectionCalendar = z.infer<typeof CalendarConnectionCalendarSchema>;

// Per-item body for PATCH /calendar-connections/:id/calendars.
export const CalendarConnectionCalendarUpdateSchema = z
  .object({
    google_calendar_id: z.string().min(1).optional(),
    caldav_calendar_url: z.string().min(1).optional(),
    sync_enabled: z.boolean(),
    project_id: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CalendarConnectionCalendarUpdate = z.infer<
  typeof CalendarConnectionCalendarUpdateSchema
>;

// Google OAuth request
export const ConnectGoogleCalendarRequestSchema = z
  .object({
    auth_code: z.string().min(1),
  })
  .strict();
export type ConnectGoogleCalendarRequest = z.infer<typeof ConnectGoogleCalendarRequestSchema>;

// CalDAV connection request
export const ConnectCaldavCalendarRequestSchema = z
  .object({
    server_url: z.string().url(),
    username: z.string().min(1),
    password: z.string().min(1),
    auth_type: z.enum(["basic", "bearer"]).default("basic").optional(),
  })
  .strict();
export type ConnectCaldavCalendarRequest = z.infer<typeof ConnectCaldavCalendarRequestSchema>;

// Available calendar items
export const AvailableCalendarSchema = z.object({
  id: z.string(),
  summary: z.string(),
  color: z.string().nullable().optional(),
  primary: z.boolean().optional(),
  google_calendar_id: z.string().optional(),
  caldav_calendar_url: z.string().optional(),
});
export type AvailableCalendar = z.infer<typeof AvailableCalendarSchema>;

export const AvailableGoogleCalendarSchema = z.object({
  google_calendar_id: z.string(),
  summary: z.string(),
  primary: z.boolean(),
});
export type AvailableGoogleCalendar = z.infer<typeof AvailableGoogleCalendarSchema>;

export const AvailableGoogleCalendarsResponseSchema = z.array(AvailableGoogleCalendarSchema);
export type AvailableGoogleCalendarsResponse = z.infer<
  typeof AvailableGoogleCalendarsResponseSchema
>;

export const AvailableCalendarsResponseSchema = z.array(AvailableCalendarSchema);
export type AvailableCalendarsResponse = z.infer<typeof AvailableCalendarsResponseSchema>;

// Outbound linking
export const LinkEventToCalendarRequestSchema = z
  .object({
    connection_id: z.string().uuid(),
    google_calendar_id: z.string().min(1).optional(),
    caldav_calendar_url: z.string().min(1).optional(),
  })
  .strict();
export type LinkEventToCalendarRequest = z.infer<typeof LinkEventToCalendarRequestSchema>;

// Retain backward alias for Google-specific linking
export const LinkEventToGoogleCalendarRequestSchema = z
  .object({
    connection_id: z.string().uuid(),
    google_calendar_id: z.string().min(1),
  })
  .strict();
export type LinkEventToGoogleCalendarRequest = z.infer<
  typeof LinkEventToGoogleCalendarRequestSchema
>;

export const EventGoogleCalendarLinkSchema = z.object({
  event_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  google_calendar_id: z.string().nullable().optional(),
  caldav_calendar_url: z.string().nullable().optional(),
  sync_status: CalendarSyncStatusSchema,
});
export type EventGoogleCalendarLink = z.infer<typeof EventGoogleCalendarLinkSchema>;
