import { z } from "zod";
import { CalendarSyncErrorCodeSchema } from "./calendar-sync-errors.js";

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
  // A CODE, never a message. Typing this as the closed vocabulary rather than
  // `z.string()` makes an accidental provider-prose leak a parse failure at the
  // API boundary instead of a silently-passing free-text field -- the same
  // structural trick `HealthMetricPointSchema`'s state refine uses to make a
  // fabricated zero inexpressible. See ./calendar-sync-errors.ts.
  last_sync_error: CalendarSyncErrorCodeSchema.nullable(),
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
  // Provider-reported write capability (9.5): Google calendarList accessRole
  // ('owner' | 'writer' | 'reader' | 'freeBusyReader'); null = unknown/CalDAV.
  access_role: z.string().nullable().optional(),
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
  access_role: z.string().nullable().optional(),
});

// GET /calendar-targets (Checkpoint 9.5): the calendars a NEW local event may
// be written to -- sync-enabled, on an active connection, and (Google)
// reported writable. A Google calendar with no recorded access role is NOT a
// target; CalDAV calendars carry null and are offered (the PUT is the check).
export const CalendarTargetSchema = z
  .object({
    connection_id: z.string().uuid(),
    provider: z.enum(["google", "caldav"]),
    google_calendar_id: z.string().nullable(),
    caldav_calendar_url: z.string().nullable(),
    summary: z.string(),
    access_role: z.string().nullable(),
  })
  .strict();
export type CalendarTarget = z.infer<typeof CalendarTargetSchema>;
export const CalendarTargetsResponseSchema = z.object({ items: z.array(CalendarTargetSchema) });
export type CalendarTargetsResponse = z.infer<typeof CalendarTargetsResponseSchema>;
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
