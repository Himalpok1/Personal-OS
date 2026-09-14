import type {
  GoogleCalendarClient,
  GoogleCalendarEvent,
  GoogleEventWriteBody,
  ListCalendarsResult,
  ListEventsResult,
} from "./google-calendar-client.js";
import { GoogleCalendarApiError, GoogleSyncTokenExpiredError } from "./google-calendar-client.js";

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

/**
 * One scripted failure for a write method (Checkpoint 9.5). `error` is what
 * the call rejects with. `afterRemoteWrite: true` models the lost-response
 * case -- the fake applies the write to its remote store FIRST and then
 * throws, exactly as a request that reached Google and timed out on the way
 * back does -- which is the scenario the push job's insert-409-update path
 * exists for.
 */
export interface FakeWriteFailure {
  error: Error;
  afterRemoteWrite?: boolean;
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
  /**
   * The `id` the caller supplied on each insertEvent, in call order
   * (`undefined` where none was sent). Checkpoint 9.5: the push job must send
   * a link-derived id so a lost response cannot produce a duplicate.
   */
  readonly insertedIds: Array<string | undefined>;
  /**
   * The fake's remote store: every event that currently "exists" on Google,
   * keyed by `${calendarId}/${eventId}`. Inserts add, updates replace,
   * deletes remove. Lets a test assert "exactly one remote event" rather
   * than only counting calls.
   */
  readonly remoteEvents: Map<string, GoogleCalendarEvent>;
  /** Push another scripted response onto a calendar's listEvents queue mid-test. */
  enqueueListEventsResponse(
    calendarId: string,
    response: FakeListEventsResponse | typeof FAKE_SYNC_TOKEN_EXPIRED,
  ): void;
  /** Script the NEXT insertEvent call to fail (FIFO; one entry per failing call). */
  queueInsertFailure(failure: FakeWriteFailure | Error): void;
  /** Script the NEXT updateEvent call to fail. */
  queueUpdateFailure(failure: FakeWriteFailure | Error): void;
  /** Script the NEXT deleteEvent call to fail. */
  queueDeleteFailure(failure: FakeWriteFailure | Error): void;
  /** Convenience: the next insert fails with a GoogleCalendarApiError of this HTTP status. */
  failInsertOnce(httpStatus: number, googleReason?: string): void;
  /** Convenience: the next update fails with a GoogleCalendarApiError of this HTTP status. */
  failUpdateOnce(httpStatus: number, googleReason?: string): void;
}

let fakeEventCounter = 0;

function makeFakeEvent(
  overrides: Partial<GoogleCalendarEvent> & { id?: string },
): GoogleCalendarEvent {
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

function toFailure(failure: FakeWriteFailure | Error): FakeWriteFailure {
  return failure instanceof Error ? { error: failure } : failure;
}

/**
 * In-memory fake implementation of {@link GoogleCalendarClient} for unit
 * tests. `listCalendars` always returns the fixed `fixtures.calendars` list.
 * `listEvents` dequeues scripted responses per-calendar in call order.
 * `insertEvent`/`updateEvent`/`deleteEvent` are recorded to `writeCalls`,
 * applied to `remoteEvents`, and return a synthesized event echoing the
 * input (insert/update) or resolve with no value (delete).
 *
 * Checkpoint 9.5 semantics the push job relies on:
 *   - an insert whose `id` is already present in the remote store rejects
 *     with a `GoogleCalendarApiError` of HTTP 409 (reason `duplicate`),
 *     exactly as Google does for a client-supplied id that is taken;
 *   - per-method failure queues (`queueInsertFailure`, ...) script the next
 *     call to reject, optionally AFTER the remote write has been applied.
 */
export function createFakeGoogleCalendarClient(
  fixtures: GoogleCalendarClientFixtures = {},
): FakeGoogleCalendarClient {
  const queues: Record<string, Array<FakeListEventsResponse | typeof FAKE_SYNC_TOKEN_EXPIRED>> = {};
  for (const [calendarId, queue] of Object.entries(fixtures.listEventsQueues ?? {})) {
    queues[calendarId] = [...queue];
  }

  const writeCalls: FakeGoogleCalendarClient["writeCalls"] = [];
  const listEventsCalls: FakeGoogleCalendarClient["listEventsCalls"] = [];
  const insertedIds: FakeGoogleCalendarClient["insertedIds"] = [];
  const remoteEvents: FakeGoogleCalendarClient["remoteEvents"] = new Map();
  const insertFailures: FakeWriteFailure[] = [];
  const updateFailures: FakeWriteFailure[] = [];
  const deleteFailures: FakeWriteFailure[] = [];

  const remoteKey = (calendarId: string, eventId: string): string => `${calendarId}/${eventId}`;

  return {
    writeCalls,
    listEventsCalls,
    insertedIds,
    remoteEvents,

    enqueueListEventsResponse(calendarId, response) {
      const existing = queues[calendarId];
      if (existing) {
        existing.push(response);
      } else {
        queues[calendarId] = [response];
      }
    },

    queueInsertFailure(failure) {
      insertFailures.push(toFailure(failure));
    },
    queueUpdateFailure(failure) {
      updateFailures.push(toFailure(failure));
    },
    queueDeleteFailure(failure) {
      deleteFailures.push(toFailure(failure));
    },
    failInsertOnce(httpStatus, googleReason) {
      insertFailures.push({
        error: new GoogleCalendarApiError(
          `fake insert HTTP ${httpStatus}`,
          httpStatus,
          googleReason,
        ),
      });
    },
    failUpdateOnce(httpStatus, googleReason) {
      updateFailures.push({
        error: new GoogleCalendarApiError(
          `fake update HTTP ${httpStatus}`,
          httpStatus,
          googleReason,
        ),
      });
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
      insertedIds.push(event.id);

      const failure = insertFailures.shift();
      if (failure && !failure.afterRemoteWrite) {
        return Promise.reject(failure.error);
      }

      if (event.id !== undefined && remoteEvents.has(remoteKey(calendarId, event.id))) {
        // Google's answer to a client-supplied id that already exists.
        return Promise.reject(
          new GoogleCalendarApiError("The requested identifier already exists.", 409, "duplicate"),
        );
      }

      const created = makeFakeEvent({ ...event });
      remoteEvents.set(remoteKey(calendarId, created.id), created);
      if (failure) return Promise.reject(failure.error);
      return Promise.resolve(created);
    },

    updateEvent(_accessToken, calendarId, eventId, event): Promise<GoogleCalendarEvent> {
      writeCalls.push({ kind: "update", calendarId, eventId, event });

      const failure = updateFailures.shift();
      if (failure && !failure.afterRemoteWrite) {
        return Promise.reject(failure.error);
      }

      const existing = remoteEvents.get(remoteKey(calendarId, eventId));
      // PATCH semantics: unspecified fields keep their remote value. The `id`
      // key is stripped from the patch body so an update can never rename.
      const patch: GoogleEventWriteBody = { ...event };
      delete patch.id;
      const updated = makeFakeEvent({ ...(existing ?? {}), ...patch, id: eventId });
      remoteEvents.set(remoteKey(calendarId, eventId), updated);
      if (failure) return Promise.reject(failure.error);
      return Promise.resolve(updated);
    },

    deleteEvent(_accessToken, calendarId, eventId): Promise<void> {
      writeCalls.push({ kind: "delete", calendarId, eventId });

      const failure = deleteFailures.shift();
      if (failure && !failure.afterRemoteWrite) {
        return Promise.reject(failure.error);
      }
      remoteEvents.delete(remoteKey(calendarId, eventId));
      if (failure) return Promise.reject(failure.error);
      return Promise.resolve();
    },
  };
}
