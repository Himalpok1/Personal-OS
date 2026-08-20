// A typed interface over the slice of the Google Calendar v3 API this
// integration needs, plus a real fetch-based implementation. A separate fake
// implementation lives in google-calendar-client.fake.ts for unit tests (this
// package's own, and the worker-owning agent's later job tests).

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export interface GoogleEventDateTime {
  /** Present for timed events. RFC3339, e.g. "2026-08-20T15:00:00-05:00". */
  dateTime?: string;
  /** Present for all-day events. "YYYY-MM-DD". */
  date?: string;
  /** IANA zone name, only meaningful alongside `dateTime`. */
  timeZone?: string;
}

export type GoogleEventStatus = "confirmed" | "tentative" | "cancelled";

export interface GoogleCalendarEvent {
  id: string;
  status: GoogleEventStatus;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  /** RFC5545 lines (RRULE/EXDATE/etc). Only ever present on a recurrence master. */
  recurrence?: string[];
  /** Present only on an instance of a recurring event (detached or cancelled). */
  recurringEventId?: string;
  /** Present only on an instance of a recurring event. */
  originalStartTime?: GoogleEventDateTime;
  etag: string;
  /** ISO datetime string of last modification. */
  updated: string;
  iCalUID: string;
}

export interface GoogleEventWriteBody {
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurrence?: string[];
}

export interface ListCalendarsResult {
  items: Array<{ id: string; summary: string; primary?: boolean }>;
}

export interface ListEventsParams {
  calendarId: string;
  /** Incremental-sync token from a prior listEvents call's nextSyncToken. */
  syncToken?: string;
  /** Pagination token from a prior listEvents call's nextPageToken. */
  pageToken?: string;
}

export interface ListEventsResult {
  items: GoogleCalendarEvent[];
  /** Present when more pages remain for this sync/full listing. */
  nextPageToken?: string;
  /** Present only on the final page -- the token to store for the next incremental sync. */
  nextSyncToken?: string;
}

export interface GoogleCalendarClient {
  listCalendars(accessToken: string): Promise<ListCalendarsResult>;
  listEvents(accessToken: string, params: ListEventsParams): Promise<ListEventsResult>;
  insertEvent(accessToken: string, calendarId: string, event: GoogleEventWriteBody): Promise<GoogleCalendarEvent>;
  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: GoogleEventWriteBody,
  ): Promise<GoogleCalendarEvent>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
}

/** Thrown by listEvents on a 410 -- the syncToken is invalid/expired and the caller must fall back to a full resync. */
export class GoogleSyncTokenExpiredError extends Error {
  constructor() {
    super("Google Calendar sync token is invalid or expired (HTTP 410) -- a full resync is required");
    this.name = "GoogleSyncTokenExpiredError";
  }
}

/** Thrown for any other non-2xx response from the Google Calendar API. */
export class GoogleCalendarApiError extends Error {
  readonly httpStatus: number;
  readonly googleReason: string | undefined;

  constructor(message: string, httpStatus: number, googleReason: string | undefined) {
    super(message);
    this.name = "GoogleCalendarApiError";
    this.httpStatus = httpStatus;
    this.googleReason = googleReason;
  }
}

interface GoogleApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string }>;
  };
}

async function googleFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CALENDAR_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

async function throwForNonOk(response: Response, isListEvents: boolean): Promise<never> {
  if (isListEvents && response.status === 410) {
    throw new GoogleSyncTokenExpiredError();
  }
  let parsed: GoogleApiErrorBody = {};
  try {
    parsed = (await response.json()) as GoogleApiErrorBody;
  } catch {
    // Non-JSON error body -- fall through with an empty parsed body.
  }
  const reason = parsed.error?.errors?.[0]?.reason;
  throw new GoogleCalendarApiError(
    parsed.error?.message ?? `Google Calendar API returned HTTP ${response.status}`,
    response.status,
    reason,
  );
}

export function createGoogleCalendarClient(): GoogleCalendarClient {
  return {
    async listCalendars(accessToken) {
      const response = await googleFetch(accessToken, "/users/me/calendarList");
      if (!response.ok) return throwForNonOk(response, false);
      const body = (await response.json()) as {
        items?: Array<{ id: string; summary: string; primary?: boolean }>;
      };
      return { items: body.items ?? [] };
    },

    async listEvents(accessToken, params) {
      // FROZEN request shape -- see the package README/task brief. Always
      // singleEvents=false + showDeleted=true. Never timeMin/timeMax/q/
      // orderBy. When a syncToken is supplied, send only syncToken (+
      // pageToken while paginating within that sync); otherwise paginate a
      // full listing via pageToken alone.
      const query = new URLSearchParams({
        singleEvents: "false",
        showDeleted: "true",
      });
      if (params.syncToken) {
        query.set("syncToken", params.syncToken);
      }
      if (params.pageToken) {
        query.set("pageToken", params.pageToken);
      }

      const response = await googleFetch(
        accessToken,
        `/calendars/${encodeURIComponent(params.calendarId)}/events?${query.toString()}`,
      );
      if (!response.ok) return throwForNonOk(response, true);
      const body = (await response.json()) as {
        items?: GoogleCalendarEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      return {
        items: body.items ?? [],
        nextPageToken: body.nextPageToken,
        nextSyncToken: body.nextSyncToken,
      };
    },

    async insertEvent(accessToken, calendarId, event) {
      const response = await googleFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        body: JSON.stringify(event),
      });
      if (!response.ok) return throwForNonOk(response, false);
      return (await response.json()) as GoogleCalendarEvent;
    },

    async updateEvent(accessToken, calendarId, eventId, event) {
      const response = await googleFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(event),
        },
      );
      if (!response.ok) return throwForNonOk(response, false);
      return (await response.json()) as GoogleCalendarEvent;
    },

    async deleteEvent(accessToken, calendarId, eventId) {
      const response = await googleFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
      );
      // Google returns 204 No Content on success, and (per its docs) 410 is
      // also acceptable for delete (already deleted) -- but to keep this
      // client's contract simple and honest, only treat 2xx as success here;
      // callers that want idempotent-delete semantics can catch
      // GoogleCalendarApiError with httpStatus 410/404 themselves.
      if (!response.ok) return throwForNonOk(response, false);
    },
  };
}
