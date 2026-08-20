import { z } from "zod";

// Single provider today. Kept as an enum of one value (rather than a bare
// z.literal) so a second provider is a schema extension, not a rewrite --
// mirrors packages/db/src/schema/calendar-connections.ts's
// text + check('google') pattern.
export const CalendarConnectionProviderSchema = z.enum(["google"]);
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
// (access_token_*, refresh_token_*) -- matches ai-provider.ts's
// AiProviderConnectionSchema, which excludes api_key material for the same
// reason: a future Settings UI can't leak a secret just by reusing an
// existing response shape.
export const CalendarConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: CalendarConnectionProviderSchema,
  google_account_email: z.string(),
  status: CalendarConnectionStatusSchema,
  granted_scope: z.string(),
  last_sync_error: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type CalendarConnection = z.infer<typeof CalendarConnectionSchema>;

export const CalendarConnectionCalendarSchema = z.object({
  id: z.string().uuid(),
  connection_id: z.string().uuid(),
  google_calendar_id: z.string(),
  summary: z.string(),
  sync_enabled: z.boolean(),
  project_id: z.string().uuid().nullable(),
  last_successful_sync_at: z.string().datetime({ offset: true }).nullable(),
  last_full_sync_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type CalendarConnectionCalendar = z.infer<typeof CalendarConnectionCalendarSchema>;

// Per-item body for PATCH /calendar-connections/:id/calendars. sync_enabled
// is required (this endpoint's whole purpose is toggling it); project_id is
// optional/nullable since not every synced calendar needs an inbound
// landing project.
export const CalendarConnectionCalendarUpdateSchema = z
  .object({
    google_calendar_id: z.string().min(1),
    sync_enabled: z.boolean(),
    project_id: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CalendarConnectionCalendarUpdate = z.infer<
  typeof CalendarConnectionCalendarUpdateSchema
>;

// The OAuth authorization-code exchange request. auth_code is the only
// field accepted here -- everything else (tokens, account identity, scope)
// is derived server-side from Google's token/userinfo response, never
// supplied by the client.
export const ConnectGoogleCalendarRequestSchema = z
  .object({
    auth_code: z.string().min(1),
  })
  .strict();
export type ConnectGoogleCalendarRequest = z.infer<typeof ConnectGoogleCalendarRequestSchema>;

// A live passthrough listing of the calendars on a connected Google
// account -- not stored, so no id/timestamps. Distinct from
// CalendarConnectionCalendarSchema, which is the persisted opt-in row.
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
