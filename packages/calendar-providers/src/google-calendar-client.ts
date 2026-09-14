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
  /**
   * Client-chosen event id (Checkpoint 9.5). Google accepts a caller-supplied
   * id on insert (`[a-v0-9]{5,1024}`, base32hex), which is what makes an
   * insert idempotent across a lost response: the push job derives it from
   * the link row, and a retry that finds the id already taken gets a 409 it
   * can resolve into an update instead of a duplicate event.
   */
  id?: string;
  status?: GoogleEventStatus;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleEventDateTime;
}

/**
 * Google's calendarList `accessRole` vocabulary. Carried through verbatim
 * (Checkpoint 9.5) so the API can decide write-eligibility -- `owner` and
 * `writer` may receive pushes; `reader`/`freeBusyReader` may not. A calendar
 * whose role is absent is treated as NOT writable by every consumer.
 */
export type GoogleCalendarAccessRole = "owner" | "writer" | "reader" | "freeBusyReader";

export interface ListCalendarsResult {
  items: Array<{
    id: string;
    summary: string;
    primary?: boolean;
    /** Clamped to the four documented values; anything else is `undefined` (= not writable). */
    accessRole?: GoogleCalendarAccessRole;
  }>;
}

const GOOGLE_CALENDAR_ACCESS_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "writer",
  "reader",
  "freeBusyReader",
]);

/**
 * Clamps a calendarList `accessRole` to the documented vocabulary (fixer
 * review, MINOR-4). An unknown string -- a future role, a typo in a fixture,
 * a provider change -- becomes `undefined`, which every consumer already
 * treats as "not writable". A role this code does not understand must never
 * be persisted as if it were one it does.
 */
export function clampGoogleCalendarAccessRole(raw: unknown): GoogleCalendarAccessRole | undefined {
  return typeof raw === "string" && GOOGLE_CALENDAR_ACCESS_ROLES.has(raw)
    ? (raw as GoogleCalendarAccessRole)
    : undefined;
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
  insertEvent(
    accessToken: string,
    calendarId: string,
    event: GoogleEventWriteBody,
  ): Promise<GoogleCalendarEvent>;
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
    super(
      "Google Calendar sync token is invalid or expired (HTTP 410) -- a full resync is required",
    );
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

/**
 * Per-request deadline (Checkpoint 9.5). Without one a stalled TCP connection
 * holds a push job open until pg-boss's own expiry redelivers it, and the
 * hung attempt keeps running in the same process alongside the retry. A
 * timed-out request surfaces as a DOMException named `TimeoutError`, which
 * `classifyCalendarProviderError` maps to `network_error` -- the same
 * transient class as a refused connection, so pg-boss retries it.
 */
export const GOOGLE_FETCH_TIMEOUT_MS = 20_000;

async function googleFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${CALENDAR_API_BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
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
        items?: Array<{ id: string; summary: string; primary?: boolean; accessRole?: string }>;
      };
      return {
        items: (body.items ?? []).map((item) => ({
          id: item.id,
          summary: item.summary,
          primary: item.primary,
          accessRole: clampGoogleCalendarAccessRole(item.accessRole),
        })),
      };
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
      const response = await googleFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          body: JSON.stringify(event),
        },
      );
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
