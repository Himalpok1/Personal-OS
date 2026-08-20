import {
  AvailableGoogleCalendarsResponseSchema,
  CalendarConnectionCalendarSchema,
  CalendarConnectionCalendarUpdateSchema,
  CalendarConnectionSchema,
  ConnectGoogleCalendarRequestSchema,
  type AvailableGoogleCalendarsResponse,
  type CalendarConnection,
  type CalendarConnectionCalendar,
  type CalendarConnectionCalendarUpdate,
  type ConnectGoogleCalendarRequest,
} from "@personal-os/schema";
import { z } from "zod";
import { fetchJson } from "./client.js";

export type {
  AvailableGoogleCalendarsResponse,
  CalendarConnection,
  CalendarConnectionCalendar,
  CalendarConnectionCalendarUpdate,
  ConnectGoogleCalendarRequest,
};

const CalendarConnectionListResponseSchema = z.object({ items: z.array(CalendarConnectionSchema) });
const CalendarConnectionCalendarListResponseSchema = z.array(CalendarConnectionCalendarSchema);
const SyncNowResponseSchema = z.object({ queued: z.number() });

export async function connectGoogleCalendar(
  baseUrl: string,
  body: ConnectGoogleCalendarRequest,
): Promise<CalendarConnection> {
  const parsed = ConnectGoogleCalendarRequestSchema.parse(body);
  return fetchJson(baseUrl, "/calendar-connections/google", CalendarConnectionSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

export async function listCalendarConnections(baseUrl: string) {
  return fetchJson(baseUrl, "/calendar-connections", CalendarConnectionListResponseSchema);
}

export async function listAvailableGoogleCalendars(
  baseUrl: string,
  connectionId: string,
): Promise<AvailableGoogleCalendarsResponse> {
  return fetchJson(
    baseUrl,
    `/calendar-connections/${connectionId}/available-calendars`,
    AvailableGoogleCalendarsResponseSchema,
  );
}

export async function updateCalendarConnectionCalendars(
  baseUrl: string,
  connectionId: string,
  body: CalendarConnectionCalendarUpdate[],
): Promise<CalendarConnectionCalendar[]> {
  const parsed = body.map((item) => CalendarConnectionCalendarUpdateSchema.parse(item));
  return fetchJson(
    baseUrl,
    `/calendar-connections/${connectionId}/calendars`,
    CalendarConnectionCalendarListResponseSchema,
    { method: "PATCH", body: JSON.stringify(parsed) },
  );
}

export async function syncCalendarConnectionNow(baseUrl: string, connectionId: string) {
  return fetchJson(
    baseUrl,
    `/calendar-connections/${connectionId}/sync-now`,
    SyncNowResponseSchema,
    {
      method: "POST",
    },
  );
}

export async function disconnectCalendarConnection(
  baseUrl: string,
  connectionId: string,
): Promise<CalendarConnection> {
  return fetchJson(
    baseUrl,
    `/calendar-connections/${connectionId}/disconnect`,
    CalendarConnectionSchema,
    {
      method: "POST",
    },
  );
}
