import {
  AvailableCalendarsResponseSchema,
  AvailableGoogleCalendarsResponseSchema,
  CalendarConnectionCalendarSchema,
  CalendarConnectionCalendarUpdateSchema,
  CalendarConnectionSchema,
  ConnectCaldavCalendarRequestSchema,
  ConnectGoogleCalendarRequestSchema,
  type AvailableCalendar,
  type AvailableCalendarsResponse,
  type AvailableGoogleCalendarsResponse,
  type CalendarConnection,
  type CalendarConnectionCalendar,
  type CalendarConnectionCalendarUpdate,
  type ConnectCaldavCalendarRequest,
  type ConnectGoogleCalendarRequest,
} from "@personal-os/schema";
import { z } from "zod";
import { fetchJson } from "./client.js";

export type {
  AvailableCalendar,
  AvailableCalendarsResponse,
  AvailableGoogleCalendarsResponse,
  CalendarConnection,
  CalendarConnectionCalendar,
  CalendarConnectionCalendarUpdate,
  ConnectCaldavCalendarRequest,
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

export async function connectCaldavCalendar(
  baseUrl: string,
  body: ConnectCaldavCalendarRequest,
): Promise<CalendarConnection> {
  const parsed = ConnectCaldavCalendarRequestSchema.parse(body);
  return fetchJson(baseUrl, "/calendar-connections/caldav", CalendarConnectionSchema, {
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

export async function listAvailableCalendars(
  baseUrl: string,
  connectionId: string,
): Promise<AvailableCalendarsResponse> {
  return fetchJson(
    baseUrl,
    `/calendar-connections/${connectionId}/available-calendars`,
    AvailableCalendarsResponseSchema,
  );
}

export async function listCalendarConnectionCalendars(
  baseUrl: string,
  connectionId: string,
): Promise<CalendarConnectionCalendar[]> {
  return fetchJson(
    baseUrl,
    `/calendar-connections/${connectionId}/calendars`,
    CalendarConnectionCalendarListResponseSchema,
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
