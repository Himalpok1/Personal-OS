import type { GoogleCalendarClient, GoogleCalendarEvent, ListCalendarsResult, ListEventsResult } from "./google-calendar-client.js";
import { GoogleSyncTokenExpiredError } from "./google-calendar-client.js";

/**
 * A single scripted response to the next matching `listEvents` call for a
 * given calendar. Enqueue one of these per expected call, in call order.
 */
export interface FakeListEventsResponse {
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** Enqueue this instead of a response to make the next matching call throw GoogleSyncTokenExpiredError. */
export const FAKE_SYNC_TOKEN_EXPIRED = Symbol("FAKE_SYNC_TOKEN_EXPIRED");

export interface GoogleCalendarClientFixtures {
  /** Calendars returned by every `listCalendars` call. */
  calendars?: ListCalendarsResult["items"];
  /**
   * Per-calendar FIFO queues of scripted `listEvents` responses. Each call
   * to `listEvents(calendarId, ...)` dequeues the next entry for that
   * calendar. Queue exhaustion throws, so tests fail loudly on an
   * unexpected extra call rather than silently returning empty results.
   */
  listEventsQueues?: Record<string, Array<FakeListEventsResponse | typeof FAKE_SYNC_TOKEN_EXPIRED>>;
}

export interface FakeGoogleCalendarClient extends GoogleCalendarClient {
  /** Every insertEvent/updateEvent/deleteEvent call, in order, for test assertions. */
  readonly writeCalls: Array<
    | { kind: "insert"; calendarId: string; event: unknown }
    | { kind: "update"; calendarId: string; eventId: string; event: unknown }
    | { kind: "delete"; calendarId: string; eventId: string }
  >;
  /** Every listEvents call's params, in order, for test assertions. */
  readonly listEventsCalls: Array<{ calendarId: string; syncToken?: string; pageToken?: string }>;
  /** Push another scripted response onto a calendar's listEvents queue mid-test. */
  enqueueListEventsResponse(
    calendarId: string,
    response: FakeListEventsResponse | typeof FAKE_SYNC_TOKEN_EXPIRED,
  ): void;
}

let fakeEventCounter = 0;

function makeFakeEvent(overrides: Partial<GoogleCalendarEvent> & { id?: string }): GoogleCalendarEvent {
  fakeEventCounter += 1;
  return {
    id: overrides.id ?? `fake-event-${fakeEventCounter}`,
    status: "confirmed",
    etag: `"fake-etag-${fakeEventCounter}"`,
    updated: new Date().toISOString(),
    iCalUID: `fake-ical-${fakeEventCounter}@google.com`,
    ...overrides,
  };
}

/**
 * In-memory fake implementation of {@link GoogleCalendarClient} for unit
 * tests. `listCalendars` always returns the fixed `fixtures.calendars` list.
 * `listEvents` dequeues scripted responses per-calendar in call order.
 * `insertEvent`/`updateEvent`/`deleteEvent` are recorded to `writeCalls` and
 * return a synthesized event echoing the input (insert/update) or resolve
 * with no value (delete) -- there is no real server state to mutate.
 */
export function createFakeGoogleCalendarClient(fixtures: GoogleCalendarClientFixtures = {}): FakeGoogleCalendarClient {
  const queues: Record<string, Array<FakeListEventsResponse | typeof FAKE_SYNC_TOKEN_EXPIRED>> = {};
  for (const [calendarId, queue] of Object.entries(fixtures.listEventsQueues ?? {})) {
    queues[calendarId] = [...queue];
  }

  const writeCalls: FakeGoogleCalendarClient["writeCalls"] = [];
  const listEventsCalls: FakeGoogleCalendarClient["listEventsCalls"] = [];

  return {
    writeCalls,
    listEventsCalls,

    enqueueListEventsResponse(calendarId, response) {
      const existing = queues[calendarId];
      if (existing) {
        existing.push(response);
      } else {
        queues[calendarId] = [response];
      }
    },

    listCalendars(): Promise<ListCalendarsResult> {
      return Promise.resolve({ items: fixtures.calendars ?? [] });
    },

    listEvents(_accessToken, params): Promise<ListEventsResult> {
      listEventsCalls.push({
        calendarId: params.calendarId,
        syncToken: params.syncToken,
        pageToken: params.pageToken,
      });
      const queue = queues[params.calendarId];
      const next = queue?.shift();
      if (next === undefined) {
        return Promise.reject(
          new Error(
            `createFakeGoogleCalendarClient: no scripted listEvents response queued for calendar "${params.calendarId}"`,
          ),
        );
      }
      if (next === FAKE_SYNC_TOKEN_EXPIRED) {
        return Promise.reject(new GoogleSyncTokenExpiredError());
      }
      return Promise.resolve({
        items: next.items,
        nextPageToken: next.nextPageToken,
        nextSyncToken: next.nextSyncToken,
      });
    },

    insertEvent(_accessToken, calendarId, event): Promise<GoogleCalendarEvent> {
      writeCalls.push({ kind: "insert", calendarId, event });
      return Promise.resolve(makeFakeEvent({ ...event }));
    },

    updateEvent(_accessToken, calendarId, eventId, event): Promise<GoogleCalendarEvent> {
      writeCalls.push({ kind: "update", calendarId, eventId, event });
      return Promise.resolve(makeFakeEvent({ id: eventId, ...event }));
    },

    deleteEvent(_accessToken, calendarId, eventId): Promise<void> {
      writeCalls.push({ kind: "delete", calendarId, eventId });
      return Promise.resolve();
    },
  };
}
