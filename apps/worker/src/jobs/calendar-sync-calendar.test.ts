import { encryptSecret } from "@personal-os/ai-providers";
import {
  createFakeCalDavClient,
  createFakeGoogleCalendarClient,
  localEventToVCalendar,
  applyExceptionToVCalendar,
  FAKE_SYNC_TOKEN_EXPIRED,
  type FakeGoogleCalendarClient,
  type GoogleCalendarEvent,
} from "@personal-os/calendar-providers";
import {
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  eventExternalLinks,
  events,
  occurrences,
  type Db,
} from "@personal-os/db";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import {
  createCalendarSyncCalendarDeadLetterHandler,
  runCalendarSync,
  type CalendarSyncCalendarJobData,
} from "./calendar-sync-calendar.js";
import {
  createCalendarPushEventHandler,
  desiredCaldavResourceHref,
  desiredGoogleEventId,
} from "./calendar-push-event.js";
import { buildEventRecurrenceRule, expandRecurrenceInRange } from "@personal-os/core";
import { EVENT_DESCRIPTION_MAX_CHARS } from "@personal-os/schema";
import { env } from "../env.js";
import { setLogSink } from "../logger.js";

const GOOGLE_CALENDAR_ID = "primary";
const CALDAV_CALENDAR_URL = "/calendars/users/testuser/personal/";

async function insertCaldavConnection(
  db: Db,
  overrides: Partial<typeof calendarConnections.$inferInsert> = {},
): Promise<string> {
  const pwSecret = encryptSecret("fake-password", env.CREDENTIALS_ENCRYPTION_KEY);
  const [row] = await db
    .insert(calendarConnections)
    .values({
      provider: "caldav",
      serverUrl: "https://caldav.example.com",
      username: "testuser",
      authType: "basic",
      principalUrl: "/principals/users/testuser/",
      calendarHomeSetUrl: "/calendars/users/testuser/",
      passwordCiphertext: pwSecret.ciphertext,
      passwordIv: pwSecret.iv,
      passwordAuthTag: pwSecret.authTag,
      status: "active",
      ...overrides,
    })
    .returning({ id: calendarConnections.id });
  return row!.id;
}

async function insertCaldavCalendar(
  db: Db,
  connectionId: string,
  overrides: Partial<typeof calendarConnectionCalendars.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(calendarConnectionCalendars)
    .values({
      connectionId,
      caldavCalendarUrl: CALDAV_CALENDAR_URL,
      summary: "Personal",
      syncEnabled: true,
      ...overrides,
    })
    .returning({ id: calendarConnectionCalendars.id });
  return row!.id;
}

async function insertConnection(
  db: Db,
  overrides: Partial<typeof calendarConnections.$inferInsert> = {},
): Promise<string> {
  const accessSecret = encryptSecret("fake-access-token", env.CREDENTIALS_ENCRYPTION_KEY);
  const refreshSecret = encryptSecret("fake-refresh-token", env.CREDENTIALS_ENCRYPTION_KEY);
  const [row] = await db
    .insert(calendarConnections)
    .values({
      provider: "google",
      googleAccountEmail: "user@example.com",
      googleAccountId: `account-${Math.random()}`,
      accessTokenCiphertext: accessSecret.ciphertext,
      accessTokenIv: accessSecret.iv,
      accessTokenAuthTag: accessSecret.authTag,
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      refreshTokenCiphertext: refreshSecret.ciphertext,
      refreshTokenIv: refreshSecret.iv,
      refreshTokenAuthTag: refreshSecret.authTag,
      grantedScope: "https://www.googleapis.com/auth/calendar",
      status: "active",
      ...overrides,
    })
    .returning({ id: calendarConnections.id });
  return row!.id;
}

async function insertCalendar(
  db: Db,
  connectionId: string,
  overrides: Partial<typeof calendarConnectionCalendars.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(calendarConnectionCalendars)
    .values({
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      summary: "Primary",
      syncEnabled: true,
      ...overrides,
    })
    .returning({ id: calendarConnectionCalendars.id });
  return row!.id;
}

function oneOffEvent(overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    id: "g-event-1",
    status: "confirmed",
    summary: "Dentist",
    start: { dateTime: "2026-09-01T15:00:00-05:00", timeZone: "America/Chicago" },
    end: { dateTime: "2026-09-01T15:30:00-05:00", timeZone: "America/Chicago" },
    etag: '"etag-1"',
    updated: "2026-08-01T00:00:00.000Z",
    iCalUID: "ical-1@google.com",
    ...overrides,
  };
}

function masterEvent(overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    id: "g-master-1",
    status: "confirmed",
    summary: "Standup",
    start: { dateTime: "2026-09-07T09:00:00-05:00", timeZone: "America/Chicago" },
    end: { dateTime: "2026-09-07T09:30:00-05:00", timeZone: "America/Chicago" },
    recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=1"],
    etag: '"etag-master"',
    updated: "2026-08-01T00:00:00.000Z",
    iCalUID: "ical-master@google.com",
    ...overrides,
  };
}

async function runSync(
  db: Db,
  client: FakeGoogleCalendarClient,
  calendarConnectionCalendarId: string,
  connectionId: string,
) {
  const data: CalendarSyncCalendarJobData = { connectionId, calendarConnectionCalendarId };
  await runCalendarSync({ db, client }, data);
}

describe("calendar.google.sync-calendar", () => {
  let db: Db;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
  });

  it("full sync creates a local event + event_external_links row from a one-off event", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);
    const client = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [oneOffEvent()], nextSyncToken: "sync-token-1" }],
      },
    });

    await runSync(db, client, calendarId, connectionId);

    const eventRows = await db.select().from(events);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]?.title).toBe("Dentist");

    const [link] = await db.select().from(eventExternalLinks);
    expect(link?.googleEventId).toBe("g-event-1");
    expect(link?.connectionId).toBe(connectionId);
    expect(link?.lastSyncedLocalUpdatedAt?.getTime()).toBe(eventRows[0]?.updatedAt.getTime());

    const [calRow] = await db
      .select()
      .from(calendarConnectionCalendars)
      .where(eq(calendarConnectionCalendars.id, calendarId));
    expect(calRow?.nextSyncToken).toBe("sync-token-1");
    expect(calRow?.lastFullSyncAt).not.toBeNull();
  });

  it("full sync creates a recurring local event from a master with UNTIL/COUNT stripped", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);
    const client = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [masterEvent()], nextSyncToken: "sync-token-2" }],
      },
    });

    await runSync(db, client, calendarId, connectionId);

    const [eventRow] = await db.select().from(events);
    expect(eventRow?.rrule).toBe("RRULE:FREQ=WEEKLY;INTERVAL=1");
    expect(eventRow?.recurrenceTimezone).toBe("America/Chicago");
  });

  it("incremental sync applies a remote-only change (remote wins when local untouched)", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);
    const client1 = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [oneOffEvent()], nextSyncToken: "existing-token" }],
      },
    });
    // Seed via a full sync first (no stored token yet in this fresh calendar row).
    await runSync(db, client1, calendarId, connectionId);

    const client2 = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [
          {
            items: [
              oneOffEvent({
                summary: "Dentist (rescheduled)",
                updated: "2026-08-05T00:00:00.000Z",
              }),
            ],
            nextSyncToken: "next-token",
          },
        ],
      },
    });
    await runSync(db, client2, calendarId, connectionId);

    const [eventRow] = await db.select().from(events);
    expect(eventRow?.title).toBe("Dentist (rescheduled)");

    const [calRow] = await db
      .select()
      .from(calendarConnectionCalendars)
      .where(eq(calendarConnectionCalendars.id, calendarId));
    expect(calRow?.nextSyncToken).toBe("next-token");
  });

  it("a local-only change is left alone (not overwritten) on the next sync", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);
    const client1 = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [oneOffEvent()], nextSyncToken: "token-a" }],
      },
    });
    await runSync(db, client1, calendarId, connectionId);

    const [eventRow] = await db.select().from(events);
    await db
      .update(events)
      .set({ title: "Dentist (locally renamed)", updatedAt: new Date() })
      .where(eq(events.id, eventRow!.id));

    const client2 = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [oneOffEvent()], nextSyncToken: "token-b" }],
      },
    });
    await runSync(db, client2, calendarId, connectionId);

    const [updatedRow] = await db.select().from(events).where(eq(events.id, eventRow!.id));
    expect(updatedRow?.title).toBe("Dentist (locally renamed)");
  });

  it("410 GoogleSyncTokenExpiredError falls back to a full resync and reconciles a remote-deleted event", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);

    // Seed two events via a first full sync.
    const seedClient = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [
          {
            items: [
              oneOffEvent({ id: "g-event-1" }),
              oneOffEvent({ id: "g-event-2", summary: "Lunch" }),
            ],
            nextSyncToken: "stale-token",
          },
        ],
      },
    });
    await runSync(db, seedClient, calendarId, connectionId);
    expect(await db.select().from(events)).toHaveLength(2);

    // Incremental sync with the now-stale token: 410, then a full resync
    // that only mentions g-event-1 -- g-event-2 must be archived (soft
    // deleted) and its link removed by reconciliation.
    const resyncClient = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [
          FAKE_SYNC_TOKEN_EXPIRED,
          { items: [oneOffEvent({ id: "g-event-1" })], nextSyncToken: "fresh-token" },
        ],
      },
    });
    await runSync(db, resyncClient, calendarId, connectionId);

    const allEvents = await db.select().from(events);
    const lunch = allEvents.find((e) => e.title === "Lunch");
    expect(lunch?.archivedAt).not.toBeNull();

    const links = await db.select().from(eventExternalLinks);
    expect(links.map((l) => l.googleEventId)).toEqual(["g-event-1"]);

    const [calRow] = await db
      .select()
      .from(calendarConnectionCalendars)
      .where(eq(calendarConnectionCalendars.id, calendarId));
    expect(calRow?.nextSyncToken).toBe("fresh-token");
  });

  it("never advances the stored syncToken when the apply pass throws mid-batch", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId, { nextSyncToken: "token-before" });

    // A malformed all-day event (missing start.date/end.date on an
    // all-day-shaped item) makes translateFields throw inside the DB
    // transaction -- the whole transaction (including the syncToken
    // commit) must roll back.
    const badEvent: GoogleCalendarEvent = {
      id: "g-bad",
      status: "confirmed",
      summary: "Broken",
      start: { date: "2026-09-01" },
      // end.date deliberately omitted
      etag: '"etag-bad"',
      updated: "2026-08-01T00:00:00.000Z",
      iCalUID: "ical-bad@google.com",
    };
    const client = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [badEvent], nextSyncToken: "token-after" }],
      },
    });

    await expect(runSync(db, client, calendarId, connectionId)).rejects.toThrow();

    const [calRow] = await db
      .select()
      .from(calendarConnectionCalendars)
      .where(eq(calendarConnectionCalendars.id, calendarId));
    expect(calRow?.nextSyncToken).toBe("token-before");
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it("detaches a single occurrence of a recurring master into its own local event", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);

    const masterClient = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [masterEvent()], nextSyncToken: "token-master" }],
      },
    });
    await runSync(db, masterClient, calendarId, connectionId);
    const [masterRow] = await db.select().from(events);
    expect(masterRow?.recurrenceExdates ?? []).toHaveLength(0);

    const instanceEvent: GoogleCalendarEvent = {
      id: "g-instance-1",
      status: "confirmed",
      summary: "Standup (moved)",
      start: { dateTime: "2026-09-14T10:00:00-05:00", timeZone: "America/Chicago" },
      end: { dateTime: "2026-09-14T10:30:00-05:00", timeZone: "America/Chicago" },
      recurringEventId: "g-master-1",
      originalStartTime: { dateTime: "2026-09-14T09:00:00-05:00", timeZone: "America/Chicago" },
      etag: '"etag-instance"',
      updated: "2026-08-02T00:00:00.000Z",
      iCalUID: "ical-instance@google.com",
    };
    const instanceClient = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [instanceEvent], nextSyncToken: "token-instance" }],
      },
    });
    await runSync(db, instanceClient, calendarId, connectionId);

    const allEvents = await db.select().from(events);
    const child = allEvents.find((e) => e.title === "Standup (moved)");
    expect(child?.parentEventId).toBe(masterRow!.id);
    expect(child?.originalStartAt?.toISOString()).toBe(
      new Date("2026-09-14T09:00:00-05:00").toISOString(),
    );

    const [parentAfter] = await db.select().from(events).where(eq(events.id, masterRow!.id));
    expect(parentAfter?.recurrenceExdates).toContain("2026-09-14");

    const [instanceRow] = await db.select().from(calendarEventInstances);
    expect(instanceRow?.mappingStatus).toBe("detached");
    expect(instanceRow?.localDetachedEventId).toBe(child!.id);
  });

  it("cancels a single occurrence of a recurring master without creating a local child", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);

    const masterClient = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [masterEvent()], nextSyncToken: "token-master" }],
      },
    });
    await runSync(db, masterClient, calendarId, connectionId);
    const [masterRow] = await db.select().from(events);

    // Pre-seed a matching pre-generated occurrence, mirroring what the
    // nightly expand-due-date-window job would have produced.
    await db.insert(occurrences).values({
      parentType: "event",
      parentId: masterRow!.id,
      occursAt: new Date("2026-09-21T09:00:00-05:00"),
      occursLocal: new Date("2026-09-21T09:00:00"),
      status: "scheduled",
      lazyGenerated: false,
    });

    const cancelledInstance: GoogleCalendarEvent = {
      id: "g-instance-cancelled",
      status: "cancelled",
      recurringEventId: "g-master-1",
      originalStartTime: { dateTime: "2026-09-21T09:00:00-05:00", timeZone: "America/Chicago" },
      etag: '"etag-cancel"',
      updated: "2026-08-02T00:00:00.000Z",
      iCalUID: "ical-cancel@google.com",
    };
    const instanceClient = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [cancelledInstance], nextSyncToken: "token-cancel" }],
      },
    });
    await runSync(db, instanceClient, calendarId, connectionId);

    const [instanceRow] = await db.select().from(calendarEventInstances);
    expect(instanceRow?.mappingStatus).toBe("cancelled");
    expect(instanceRow?.localDetachedEventId).toBeNull();

    const [parentAfter] = await db.select().from(events).where(eq(events.id, masterRow!.id));
    expect(parentAfter?.recurrenceExdates).toContain("2026-09-21");

    const remainingOccurrences = await db
      .select()
      .from(occurrences)
      .where(and(eq(occurrences.parentType, "event"), eq(occurrences.parentId, masterRow!.id)));
    expect(remainingOccurrences).toHaveLength(0);
  });

  it("archives a standalone event that Google reports as cancelled", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);
    const client1 = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [oneOffEvent()], nextSyncToken: "token-1" }],
      },
    });
    await runSync(db, client1, calendarId, connectionId);

    const client2 = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [
          {
            items: [
              {
                id: "g-event-1",
                status: "cancelled",
                etag: '"etag-2"',
                updated: "2026-08-03T00:00:00.000Z",
                iCalUID: "ical-1@google.com",
              },
            ],
            nextSyncToken: "token-2",
          },
        ],
      },
    });
    await runSync(db, client2, calendarId, connectionId);

    const [eventRow] = await db.select().from(events);
    expect(eventRow?.archivedAt).not.toBeNull();
    expect(await db.select().from(eventExternalLinks)).toHaveLength(0);
  });

  it("no-ops when the connection is not active (status stopping mechanism)", async () => {
    const connectionId = await insertConnection(db, { status: "needs_reauth" });
    const calendarId = await insertCalendar(db, connectionId);
    const client = createFakeGoogleCalendarClient({
      listEventsQueues: {
        [GOOGLE_CALENDAR_ID]: [{ items: [oneOffEvent()], nextSyncToken: "token" }],
      },
    });
    await runSync(db, client, calendarId, connectionId);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(client.listEventsCalls).toHaveLength(0);
  });

  it("dead-letter handler records the failure on the connection", async () => {
    const connectionId = await insertConnection(db);
    const calendarId = await insertCalendar(db, connectionId);
    const handler = createCalendarSyncCalendarDeadLetterHandler(db);
    await handler([
      {
        id: "job-1",
        name: "calendar.google.sync-calendar",
        data: { connectionId, calendarConnectionCalendarId: calendarId },
      } as never,
    ]);
    const [row] = await db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.id, connectionId));
    expect(row?.lastSyncError).toBe("retries_exhausted");
  });

  describe("deterministic conflict resolution and baseline invariants", () => {
    it("remote wins when remote updated timestamp is later than local edit timestamp, advances baseline, and suppresses echo", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);

      const baseDate = new Date("2026-08-01T10:00:00.000Z");

      // Seed event at baseline
      const initialClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [
                oneOffEvent({
                  summary: "Initial Summary",
                  updated: baseDate.toISOString(),
                }),
              ],
              nextSyncToken: "token-base",
            },
          ],
        },
      });
      await runSync(db, initialClient, calendarId, connectionId);

      const [initialLocal] = await db.select().from(events);
      expect(initialLocal?.title).toBe("Initial Summary");

      // Fix baseline to baseDate explicitly
      await db.update(events).set({ updatedAt: baseDate }).where(eq(events.id, initialLocal!.id));
      await db
        .update(eventExternalLinks)
        .set({ lastSyncedLocalUpdatedAt: baseDate, googleUpdatedAt: baseDate })
        .where(eq(eventExternalLinks.eventId, initialLocal!.id));

      // Local edit at baseDate + 2 hours
      const localEditTime = new Date(baseDate.getTime() + 2 * 3600_000);
      await db
        .update(events)
        .set({ title: "Local Edit", updatedAt: localEditTime })
        .where(eq(events.id, initialLocal!.id));

      // Remote edit at baseDate + 4 hours (LATER than local)
      const remoteEditTimeStr = new Date(baseDate.getTime() + 4 * 3600_000).toISOString();
      const conflictClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [
                oneOffEvent({
                  summary: "Remote Edit (Later)",
                  updated: remoteEditTimeStr,
                }),
              ],
              nextSyncToken: "token-after-remote-win",
            },
          ],
        },
      });

      // Execute sync
      await runSync(db, conflictClient, calendarId, connectionId);

      // Remote wins
      const [afterConflict] = await db.select().from(events).where(eq(events.id, initialLocal!.id));
      expect(afterConflict?.title).toBe("Remote Edit (Later)");

      // Both baselines advance
      const [link] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, initialLocal!.id));
      expect(link?.googleUpdatedAt?.toISOString()).toBe(remoteEditTimeStr);
      expect(link?.lastSyncedLocalUpdatedAt?.getTime()).toBe(afterConflict!.updatedAt.getTime());

      // Immediate re-sync with same remote event produces no echo or mutation
      const reSyncClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [
                oneOffEvent({
                  summary: "Remote Edit (Later)",
                  updated: remoteEditTimeStr,
                }),
              ],
              nextSyncToken: "token-stable",
            },
          ],
        },
      });
      await runSync(db, reSyncClient, calendarId, connectionId);

      const [afterReSync] = await db.select().from(events).where(eq(events.id, initialLocal!.id));
      expect(afterReSync?.title).toBe("Remote Edit (Later)");
      expect(afterReSync?.updatedAt.getTime()).toBe(afterConflict!.updatedAt.getTime());
    });

    it("local wins when local updated timestamp is later than remote edit timestamp, advances baseline, and suppresses echo", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);

      const baseDate = new Date("2026-08-01T10:00:00.000Z");

      // Seed event at baseline
      const initialClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [
                oneOffEvent({
                  summary: "Initial Title",
                  updated: baseDate.toISOString(),
                }),
              ],
              nextSyncToken: "token-base",
            },
          ],
        },
      });
      await runSync(db, initialClient, calendarId, connectionId);

      const [initialLocal] = await db.select().from(events);

      // Fix baseline to baseDate explicitly
      await db.update(events).set({ updatedAt: baseDate }).where(eq(events.id, initialLocal!.id));
      await db
        .update(eventExternalLinks)
        .set({ lastSyncedLocalUpdatedAt: baseDate, googleUpdatedAt: baseDate })
        .where(eq(eventExternalLinks.eventId, initialLocal!.id));

      // Remote edit at baseDate + 2 hours
      const remoteEditTimeStr = new Date(baseDate.getTime() + 2 * 3600_000).toISOString();
      // Local edit at baseDate + 5 hours (LATER than remote)
      const localEditTime = new Date(baseDate.getTime() + 5 * 3600_000);
      await db
        .update(events)
        .set({ title: "Local Title (Wins)", updatedAt: localEditTime })
        .where(eq(events.id, initialLocal!.id));

      const conflictClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [
                oneOffEvent({
                  summary: "Remote Title (Earlier)",
                  updated: remoteEditTimeStr,
                }),
              ],
              nextSyncToken: "token-after-local-win",
            },
          ],
        },
      });

      await runSync(db, conflictClient, calendarId, connectionId);

      // Local title is preserved
      const [afterConflict] = await db.select().from(events).where(eq(events.id, initialLocal!.id));
      expect(afterConflict?.title).toBe("Local Title (Wins)");

      // Immediate re-sync with same remote event leaves local intact with no ping-pong
      const reSyncClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [
                oneOffEvent({
                  summary: "Remote Title (Earlier)",
                  updated: remoteEditTimeStr,
                }),
              ],
              nextSyncToken: "token-stable-2",
            },
          ],
        },
      });
      await runSync(db, reSyncClient, calendarId, connectionId);

      const [afterReSync] = await db.select().from(events).where(eq(events.id, initialLocal!.id));
      expect(afterReSync?.title).toBe("Local Title (Wins)");
    });

    it("simultaneous local edit vs remote delete archives local event (remote delete policy)", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);

      const initialClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [
                oneOffEvent({
                  id: "g-del-1",
                  summary: "To be deleted on Google",
                  updated: "2026-08-01T10:00:00.000Z",
                }),
              ],
              nextSyncToken: "token-del-base",
            },
          ],
        },
      });
      await runSync(db, initialClient, calendarId, connectionId);

      const [initialLocal] = await db.select().from(events);
      // Local side edits the event
      await db
        .update(events)
        .set({ title: "Local edit before remote delete", updatedAt: new Date() })
        .where(eq(events.id, initialLocal!.id));

      // Remote side deletes the event
      const deleteClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [
                {
                  id: "g-del-1",
                  status: "cancelled",
                  etag: '"etag-del"',
                  updated: "2026-08-02T12:00:00.000Z",
                  iCalUID: "ical-del-1@google.com",
                },
              ],
              nextSyncToken: "token-after-delete",
            },
          ],
        },
      });
      await runSync(db, deleteClient, calendarId, connectionId);

      // Local event is archived (soft-deleted), not hard deleted, link is removed
      const [archivedEvent] = await db.select().from(events).where(eq(events.id, initialLocal!.id));
      expect(archivedEvent?.archivedAt).not.toBeNull();
      const links = await db.select().from(eventExternalLinks);
      expect(links).toHaveLength(0);

      // Subsequent sync does not resurrect or duplicate it
      const emptyClient = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [],
              nextSyncToken: "token-empty",
            },
          ],
        },
      });
      await runSync(db, emptyClient, calendarId, connectionId);
      const remainingLinks = await db.select().from(eventExternalLinks);
      expect(remainingLinks).toHaveLength(0);
    });
  });

  describe("CalDAV calendar sync", () => {
    it("imports one-off timed, all-day, and recurring master events on initial sync", async () => {
      const connectionId = await insertCaldavConnection(db);
      const calendarId = await insertCaldavCalendar(db, connectionId);

      const fakeClient = createFakeCalDavClient();
      const auth = { username: "testuser", password: "fake-password" };

      // 1. One-off timed event
      const timedIcs = localEventToVCalendar({
        title: "Doctor Appointment",
        allDay: false,
        startsAt: new Date("2026-08-21T14:00:00.000Z"),
        endsAt: new Date("2026-08-21T15:00:00.000Z"),
        timezone: "America/Chicago",
      });
      await fakeClient.putEvent(`${CALDAV_CALENDAR_URL}event1.ics`, timedIcs, undefined, auth, {
        ifNoneMatch: true,
      });

      // 2. All-day event
      const allDayIcs = localEventToVCalendar({
        title: "Vacation",
        allDay: true,
        startDate: "2026-08-22",
        endDate: "2026-08-24",
        timezone: "UTC",
      });
      await fakeClient.putEvent(`${CALDAV_CALENDAR_URL}event2.ics`, allDayIcs, undefined, auth, {
        ifNoneMatch: true,
      });

      // 3. Recurring master
      const recurringIcs = localEventToVCalendar({
        title: "Weekly Planning",
        allDay: false,
        startsAt: new Date("2026-08-21T16:00:00.000Z"),
        endsAt: new Date("2026-08-21T17:00:00.000Z"),
        timezone: "America/Chicago",
        rrule: "FREQ=WEEKLY;BYDAY=FR",
      });
      await fakeClient.putEvent(`${CALDAV_CALENDAR_URL}event3.ics`, recurringIcs, undefined, auth, {
        ifNoneMatch: true,
      });

      const googleStub = createFakeGoogleCalendarClient();
      await runCalendarSync(
        { db, client: googleStub, caldavClient: fakeClient },
        { connectionId, calendarConnectionCalendarId: calendarId },
      );

      const importedEvents = await db.select().from(events);
      expect(importedEvents).toHaveLength(3);

      const timed = importedEvents.find((e) => e.title === "Doctor Appointment");
      expect(timed).toBeDefined();
      expect(timed?.allDay).toBe(false);

      const allDay = importedEvents.find((e) => e.title === "Vacation");
      expect(allDay).toBeDefined();
      expect(allDay?.allDay).toBe(true);
      expect(allDay?.startDate).toBe("2026-08-22");
      expect(allDay?.endDate).toBe("2026-08-24");

      const recurring = importedEvents.find((e) => e.title === "Weekly Planning");
      expect(recurring).toBeDefined();
      expect(recurring?.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");

      const links = await db.select().from(eventExternalLinks);
      expect(links).toHaveLength(3);
      for (const link of links) {
        expect(link.caldavCalendarUrl).toBe(CALDAV_CALENDAR_URL);
        expect(link.caldavResourceUrl).toBeDefined();
        expect(link.caldavEtag).toBeDefined();
        expect(link.syncStatus).toBe("synced");
      }

      // Check sync token updated
      const [cal] = await db
        .select()
        .from(calendarConnectionCalendars)
        .where(eq(calendarConnectionCalendars.id, calendarId));
      expect(cal?.nextSyncToken).toBeDefined();
    });

    it("syncs detached and cancelled recurrence exceptions via single resource model (RFC 4791)", async () => {
      const connectionId = await insertCaldavConnection(db);
      const calendarId = await insertCaldavCalendar(db, connectionId);

      const fakeClient = createFakeCalDavClient();
      const auth = { username: "testuser", password: "fake-password" };

      // Recurring series with detached exception on 2026-08-28
      const masterIcs = localEventToVCalendar({
        title: "Team Standup",
        allDay: false,
        startsAt: new Date("2026-08-21T14:00:00.000Z"),
        endsAt: new Date("2026-08-21T14:30:00.000Z"),
        timezone: "America/Chicago",
        rrule: "FREQ=WEEKLY;BYDAY=FR",
      });

      const seriesWithException = applyExceptionToVCalendar(masterIcs, {
        kind: "detach",
        originalStartInstant: new Date("2026-08-28T14:00:00.000Z"),
        fields: {
          title: "Team Standup (Moved)",
          allDay: false,
          startsAt: new Date("2026-08-28T15:00:00.000Z"),
          endsAt: new Date("2026-08-28T15:30:00.000Z"),
          timezone: "America/Chicago",
        },
      });

      await fakeClient.putEvent(
        `${CALDAV_CALENDAR_URL}standup.ics`,
        seriesWithException,
        undefined,
        auth,
        { ifNoneMatch: true },
      );

      const googleStub = createFakeGoogleCalendarClient();
      await runCalendarSync(
        { db, client: googleStub, caldavClient: fakeClient },
        { connectionId, calendarConnectionCalendarId: calendarId },
      );

      const allEvents = await db.select().from(events);
      expect(allEvents).toHaveLength(2); // Master + detached exception

      const master = allEvents.find((e) => e.parentEventId === null);
      const detached = allEvents.find((e) => e.parentEventId !== null);

      expect(master?.title).toBe("Team Standup");
      expect(detached?.title).toBe("Team Standup (Moved)");
      expect(detached?.parentEventId).toBe(master?.id);

      const instances = await db.select().from(calendarEventInstances);
      expect(instances).toHaveLength(1);
      expect(instances[0]!.mappingStatus).toBe("detached");
      expect(instances[0]!.localDetachedEventId).toBe(detached?.id);
    });

    it("handles invalid sync-token by resetting cursor and reconciling fully", async () => {
      const connectionId = await insertCaldavConnection(db);
      const calendarId = await insertCaldavCalendar(db, connectionId, {
        nextSyncToken: "stale-sync-token",
      });

      const fakeClient = createFakeCalDavClient();
      const auth = { username: "testuser", password: "fake-password" };

      await fakeClient.putEvent(
        `${CALDAV_CALENDAR_URL}meeting.ics`,
        localEventToVCalendar({
          title: "Strategy Meeting",
          allDay: false,
          startsAt: new Date("2026-08-25T10:00:00.000Z"),
          endsAt: new Date("2026-08-25T11:00:00.000Z"),
          timezone: "America/Chicago",
        }),
        undefined,
        auth,
        { ifNoneMatch: true },
      );

      fakeClient.forceInvalidSyncToken = true;

      const googleStub = createFakeGoogleCalendarClient();
      await runCalendarSync(
        { db, client: googleStub, caldavClient: fakeClient },
        { connectionId, calendarConnectionCalendarId: calendarId },
      );

      // Event should still be imported successfully through fallback full reconciliation!
      const allEvents = await db.select().from(events);
      expect(allEvents).toHaveLength(1);
      expect(allEvents[0]!.title).toBe("Strategy Meeting");
    });
  });

  // =========================================================================
  // Checkpoint 9.5: every inbound insert is origin='external'; a both-changed
  // tie parks the link as `conflict` instead of overwriting the local edit;
  // needs_reauth goes through the shared transition.
  // =========================================================================
  // Checkpoint 9.6 (ADR-065): provider text is bounded at translation, and
  // the job reports how many fields that cut -- ONE counts-only line per
  // pass, only when the count is non-zero, never the text.
  describe("Checkpoint 9.6 -- text bounds are logged as a count", () => {
    let sink: Array<Record<string, unknown>>;
    let restore: () => void;

    beforeEach(() => {
      sink = [];
      restore = setLogSink({ write: (_level, record) => sink.push(record) });
    });
    afterEach(() => restore());

    const bounded = () => sink.filter((record) => record["event"] === "calendar.sync.text_bounded");

    it("Google: an over-long description is stored at the bound and counted once, ids and counts only", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const description = "agenda ".repeat(700); // 4,900 chars > EVENT_DESCRIPTION_MAX_CHARS
      const client = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [oneOffEvent({ description }), oneOffEvent({ id: "g-event-2" })],
              nextSyncToken: "sync-token-1",
            },
          ],
        },
      });

      await runSync(db, client, calendarId, connectionId);

      const rows = await db.select().from(events);
      const stored = rows.find((row) => row.description !== null);
      expect(stored?.description).toHaveLength(EVENT_DESCRIPTION_MAX_CHARS);

      const lines = bounded();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ connectionId, truncatedFields: 1 });
      // Nothing but the connection id and the count rides on the line.
      const json = JSON.stringify(sink);
      expect(json).not.toContain("agenda agenda");
      expect(json).not.toContain("Dentist");
    });

    it("Google: a pass that bounds nothing emits no line", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const client = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [{ items: [oneOffEvent()], nextSyncToken: "sync-token-1" }],
        },
      });

      await runSync(db, client, calendarId, connectionId);

      expect(bounded()).toEqual([]);
    });

    it("CalDAV: an over-long DESCRIPTION is stored at the bound and counted once", async () => {
      const connectionId = await insertCaldavConnection(db);
      const calendarId = await insertCaldavCalendar(db, connectionId);
      const fakeClient = createFakeCalDavClient();
      const auth = { username: "testuser", password: "fake-password" };
      const ics = localEventToVCalendar({
        title: "Board meeting",
        description: "minutes ".repeat(700),
        allDay: false,
        startsAt: new Date("2026-08-21T14:00:00.000Z"),
        endsAt: new Date("2026-08-21T15:00:00.000Z"),
        timezone: "America/Chicago",
      });
      await fakeClient.putEvent(`${CALDAV_CALENDAR_URL}long.ics`, ics, undefined, auth, {
        ifNoneMatch: true,
      });

      await runCalendarSync(
        { db, client: createFakeGoogleCalendarClient(), caldavClient: fakeClient },
        { connectionId, calendarConnectionCalendarId: calendarId },
      );

      const [row] = await db.select().from(events);
      expect(row?.description).toHaveLength(EVENT_DESCRIPTION_MAX_CHARS);
      const lines = bounded();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ connectionId, truncatedFields: 1 });
      expect(JSON.stringify(sink)).not.toContain("minutes minutes");
    });
  });

  describe("Checkpoint 9.5 -- ownership and conflict contract", () => {
    it("every `.insert(events)` in calendar-sync-calendar.ts builds its row through localEventFieldsToInsert, which sets origin: 'external'", () => {
      // A source-level pin over the four insert sites, so a fifth added
      // without the shared builder fails here rather than defaulting silently
      // (the column default is also 'external', which is the safe direction --
      // but an explicit builder is what the runtime assertions below rely on).
      const source = readFileSync(
        path.resolve(import.meta.dirname, "calendar-sync-calendar.ts"),
        "utf8",
      );
      const inserts = [
        ...source.matchAll(/\.insert\(events\)\s*\.values\(([\s\S]*?)\)\s*\.returning/g),
      ];
      expect(inserts.length).toBeGreaterThanOrEqual(4);
      for (const match of inserts) {
        expect(match[1]).toContain("localEventFieldsToInsert(");
      }
      expect(source).toContain('origin: "external"');
    });

    it("Google one-off, Google master, and Google detached child are all inserted with origin 'external'", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const instanceEvent: GoogleCalendarEvent = {
        id: "g-instance-1",
        status: "confirmed",
        summary: "Standup (moved)",
        start: { dateTime: "2026-09-14T10:00:00-05:00", timeZone: "America/Chicago" },
        end: { dateTime: "2026-09-14T10:30:00-05:00", timeZone: "America/Chicago" },
        recurringEventId: "g-master-1",
        originalStartTime: { dateTime: "2026-09-14T09:00:00-05:00", timeZone: "America/Chicago" },
        etag: '"etag-instance"',
        updated: "2026-08-02T00:00:00.000Z",
        iCalUID: "ical-instance@google.com",
      };
      const client = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            { items: [oneOffEvent(), masterEvent(), instanceEvent], nextSyncToken: "t" },
          ],
        },
      });
      await runSync(db, client, calendarId, connectionId);

      const rows = await db.select().from(events);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.origin)).toEqual(["external", "external", "external"]);
      expect(rows.some((r) => r.parentEventId !== null)).toBe(true);
    });

    it("CalDAV master and detached child are inserted with origin 'external'", async () => {
      const connectionId = await insertCaldavConnection(db);
      const calendarId = await insertCaldavCalendar(db, connectionId);
      const fakeClient = createFakeCalDavClient();
      const auth = { username: "testuser", password: "fake-password" };
      const masterIcs = localEventToVCalendar({
        title: "Team Standup",
        allDay: false,
        startsAt: new Date("2026-08-21T14:00:00.000Z"),
        endsAt: new Date("2026-08-21T14:30:00.000Z"),
        timezone: "America/Chicago",
        rrule: "FREQ=WEEKLY;BYDAY=FR",
      });
      const withException = applyExceptionToVCalendar(masterIcs, {
        kind: "detach",
        originalStartInstant: new Date("2026-08-28T14:00:00.000Z"),
        fields: {
          title: "Team Standup (Moved)",
          allDay: false,
          startsAt: new Date("2026-08-28T15:00:00.000Z"),
          endsAt: new Date("2026-08-28T15:30:00.000Z"),
          timezone: "America/Chicago",
        },
      });
      await fakeClient.putEvent(
        `${CALDAV_CALENDAR_URL}standup.ics`,
        withException,
        undefined,
        auth,
        {
          ifNoneMatch: true,
        },
      );
      await runCalendarSync(
        { db, client: createFakeGoogleCalendarClient(), caldavClient: fakeClient },
        { connectionId, calendarConnectionCalendarId: calendarId },
      );
      const rows = await db.select().from(events);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.origin === "external")).toBe(true);
    });

    it("a both-changed tie (identical millisecond timestamps) marks the Google link `conflict` and does NOT apply the remote edit", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const baseDate = new Date("2026-08-01T10:00:00.000Z");
      const seed = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            { items: [oneOffEvent({ updated: baseDate.toISOString() })], nextSyncToken: "t0" },
          ],
        },
      });
      await runSync(db, seed, calendarId, connectionId);
      const [local] = await db.select().from(events);
      await db.update(events).set({ updatedAt: baseDate }).where(eq(events.id, local!.id));
      await db
        .update(eventExternalLinks)
        .set({ lastSyncedLocalUpdatedAt: baseDate, googleUpdatedAt: baseDate })
        .where(eq(eventExternalLinks.eventId, local!.id));

      // Both sides edit at the SAME instant -- decideConflict has no winner.
      const tie = new Date(baseDate.getTime() + 3600_000);
      await db
        .update(events)
        .set({ title: "Local Edit", updatedAt: tie })
        .where(eq(events.id, local!.id));
      const remote = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [oneOffEvent({ summary: "Remote Edit", updated: tie.toISOString() })],
              nextSyncToken: "t1",
            },
          ],
        },
      });
      await runSync(db, remote, calendarId, connectionId);

      const [after] = await db.select().from(events).where(eq(events.id, local!.id));
      expect(after?.title).toBe("Local Edit");
      expect(after?.updatedAt.getTime()).toBe(tie.getTime());
      const [link] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, local!.id));
      expect(link?.syncStatus).toBe("conflict");
      expect(link?.lastSyncError).toBe("conflict");
      // Baselines are NOT advanced: nothing was reconciled.
      expect(link?.googleUpdatedAt?.getTime()).toBe(baseDate.getTime());
      expect(link?.lastSyncedLocalUpdatedAt?.getTime()).toBe(baseDate.getTime());
    });

    it("a both-changed tie on a detached instance marks the instance row `conflict` and keeps the local child", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const baseDate = new Date("2026-08-01T10:00:00.000Z");
      const instance = (overrides: Partial<GoogleCalendarEvent>): GoogleCalendarEvent => ({
        id: "g-instance-1",
        status: "confirmed",
        summary: "Standup (moved)",
        start: { dateTime: "2026-09-14T10:00:00-05:00", timeZone: "America/Chicago" },
        end: { dateTime: "2026-09-14T10:30:00-05:00", timeZone: "America/Chicago" },
        recurringEventId: "g-master-1",
        originalStartTime: { dateTime: "2026-09-14T09:00:00-05:00", timeZone: "America/Chicago" },
        etag: '"etag-instance"',
        updated: baseDate.toISOString(),
        iCalUID: "ical-instance@google.com",
        ...overrides,
      });
      const seed = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [{ items: [masterEvent(), instance({})], nextSyncToken: "t0" }],
        },
      });
      await runSync(db, seed, calendarId, connectionId);
      const child = (await db.select().from(events)).find((e) => e.parentEventId !== null)!;
      await db.update(events).set({ updatedAt: baseDate }).where(eq(events.id, child.id));
      await db
        .update(calendarEventInstances)
        .set({ lastSyncedLocalUpdatedAt: baseDate, googleUpdatedAt: baseDate })
        .where(eq(calendarEventInstances.localDetachedEventId, child.id));

      const tie = new Date(baseDate.getTime() + 3600_000);
      await db
        .update(events)
        .set({ title: "Local child edit", updatedAt: tie })
        .where(eq(events.id, child.id));
      const remote = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [instance({ summary: "Remote child edit", updated: tie.toISOString() })],
              nextSyncToken: "t1",
            },
          ],
        },
      });
      await runSync(db, remote, calendarId, connectionId);

      const [after] = await db.select().from(events).where(eq(events.id, child.id));
      expect(after?.title).toBe("Local child edit");
      const [instanceRow] = await db
        .select()
        .from(calendarEventInstances)
        .where(eq(calendarEventInstances.localDetachedEventId, child.id));
      expect(instanceRow?.syncStatus).toBe("conflict");
      expect(instanceRow?.lastSyncError).toBe("conflict");
    });

    describe("needs_reauth through the shared transition", () => {
      afterEach(() => vi.unstubAllGlobals());

      it("a permanent OAuth failure during sync mints the ADR-058 key once and never re-stamps updated_at on a retry", async () => {
        const connectionId = await insertConnection(db, {
          accessTokenExpiresAt: new Date(Date.now() - 60_000),
        });
        const calendarId = await insertCalendar(db, connectionId);
        const { devices } = await import("@personal-os/db");
        await db.insert(devices).values({
          name: "Device",
          platform: "android",
          tokenHash: `hash-${Math.random()}`,
          pushToken: "ExponentPushToken[x]",
          notifyAlerts: true,
          notificationsEnabled: true,
        });
        vi.stubGlobal(
          "fetch",
          vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(
                new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
              ),
            ),
        );
        const boss = { send: vi.fn() };
        const client = createFakeGoogleCalendarClient();
        const data: CalendarSyncCalendarJobData = {
          connectionId,
          calendarConnectionCalendarId: calendarId,
        };

        await runCalendarSync({ db, client, boss: boss as unknown as PgBoss }, data);
        const [first] = await db
          .select()
          .from(calendarConnections)
          .where(eq(calendarConnections.id, connectionId));
        expect(first?.status).toBe("needs_reauth");
        expect(first?.lastSyncError).toBe("auth_expired");
        const keys = () =>
          boss.send.mock.calls.map((c) => c[1] as { dedupeKey?: string }).map((p) => p.dedupeKey);
        expect(keys()).toEqual([
          `calendar-needs-reauth:${connectionId}:${first!.updatedAt.toISOString()}`,
        ]);

        // A retry finds the connection already needs_reauth and returns early
        // (runCalendarSync no-ops on a non-active connection), so nothing
        // moves: same timestamp, no second key.
        await runCalendarSync({ db, client, boss: boss as unknown as PgBoss }, data);
        const [second] = await db
          .select()
          .from(calendarConnections)
          .where(eq(calendarConnections.id, connectionId));
        expect(second!.updatedAt.getTime()).toBe(first!.updatedAt.getTime());
        expect(new Set(keys()).size).toBe(1);
      });
    });
  });

  // =========================================================================
  // Fixer review findings (Checkpoint 9.5): our own pushed event must never be
  // imported as a duplicate, archived by a stale listing, or re-anchored.
  // =========================================================================
  describe("fixer review findings", () => {
    const fakeJob = (eventId: string) =>
      ({ id: "job-p", name: "calendar.google.push-event", data: { eventId } }) as never;

    async function insertLocalLinkedEvent(
      connectionId: string,
      eventValues: Partial<typeof events.$inferInsert> = {},
    ) {
      const [eventRow] = await db
        .insert(events)
        .values({
          title: "Owner authored",
          origin: "local",
          timezone: "America/Chicago",
          startsAt: new Date("2026-09-07T09:00:00-05:00"),
          endsAt: new Date("2026-09-07T09:30:00-05:00"),
          ...eventValues,
        })
        .returning();
      const [link] = await db
        .insert(eventExternalLinks)
        .values({
          eventId: eventRow!.id,
          connectionId,
          googleCalendarId: GOOGLE_CALENDAR_ID,
          googleEventId: null,
          syncStatus: "pending_push",
        })
        .returning();
      return { event: eventRow!, link: link! };
    }

    async function readLink(eventId: string) {
      const [link] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, eventId));
      return link;
    }

    it("BLOCKER-1: a sync running inside the push retry window ADOPTS the pending link instead of importing a duplicate, and the retry then finishes cleanly", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const { event, link } = await insertLocalLinkedEvent(connectionId);
      const client = createFakeGoogleCalendarClient();
      const push = createCalendarPushEventHandler(db, client);

      // Attempt 1: the insert reached Google; the response was lost.
      client.queueInsertFailure({
        error: Object.assign(new Error("timeout"), { name: "TimeoutError" }),
        afterRemoteWrite: true,
      });
      await expect(push([fakeJob(event.id)])).rejects.toThrow();
      const desired = desiredGoogleEventId(link.id);
      const remote = client.remoteEvents.get(`${GOOGLE_CALENDAR_ID}/${desired}`)!;
      expect(remote).toBeDefined();
      expect((await readLink(event.id))!.googleEventId).toBeNull();

      // The 15-minute sync lists the event no link claims yet.
      client.enqueueListEventsResponse(GOOGLE_CALENDAR_ID, {
        items: [remote],
        nextSyncToken: "t1",
      });
      await runSync(db, client, calendarId, connectionId);

      // Before the fix: a SECOND events row (origin external) and a second
      // link claiming the id -- and the retry below dead-lettered on 23505.
      expect(await db.select().from(events)).toHaveLength(1);
      const adopted = (await readLink(event.id))!;
      expect(adopted.googleEventId).toBe(desired);
      expect(adopted.syncStatus).toBe("pending_push");
      expect(adopted.googleEtag).toBe(remote.etag);
      expect(adopted.lastSyncedLocalUpdatedAt?.getTime()).toBe(event.updatedAt.getTime());
      const [row] = await db.select().from(events);
      expect(row?.origin).toBe("local");
      expect(row?.title).toBe("Owner authored");

      // The retry: update in place, no duplicate, link synced.
      await push([fakeJob(event.id)]);
      expect(client.writeCalls.map((c) => c.kind)).toEqual(["insert", "update"]);
      expect(client.remoteEvents.size).toBe(1);
      expect(await db.select().from(events)).toHaveLength(1);
      expect(await db.select().from(eventExternalLinks)).toHaveLength(1);
      expect((await readLink(event.id))!.syncStatus).toBe("synced");
    });

    it("BLOCKER-1: a CANCELLED remote event matching a pending link archives and unlinks it (someone deleted our just-created event)", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const { event, link } = await insertLocalLinkedEvent(connectionId);
      const client = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [
            {
              items: [oneOffEvent({ id: desiredGoogleEventId(link.id), status: "cancelled" })],
              nextSyncToken: "t",
            },
          ],
        },
      });
      await runSync(db, client, calendarId, connectionId);
      const [row] = await db.select().from(events);
      expect(row?.id).toBe(event.id);
      expect(row?.archivedAt).not.toBeNull();
      expect(await db.select().from(eventExternalLinks)).toHaveLength(0);
    });

    it("MAJOR-C: a full-sync reconcile does NOT archive a link whose push completed after the listing began", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const { event } = await insertLocalLinkedEvent(connectionId);
      const client = createFakeGoogleCalendarClient({
        listEventsQueues: { [GOOGLE_CALENDAR_ID]: [{ items: [], nextSyncToken: "t" }] },
      });
      // The push lands DURING the listing: after listStartedAt, before reconcile.
      const push = createCalendarPushEventHandler(db, client);
      const originalList = client.listEvents.bind(client);
      client.listEvents = async (token, params) => {
        const page = await originalList(token, params);
        await push([fakeJob(event.id)]);
        return page;
      };

      await runSync(db, client, calendarId, connectionId);

      const link = (await readLink(event.id))!;
      expect(link.googleEventId).not.toBeNull();
      expect(link.syncStatus).toBe("synced");
      const [row] = await db.select().from(events);
      expect(row?.archivedAt).toBeNull();
      expect(await db.select().from(eventExternalLinks)).toHaveLength(1);
    });

    it("MAJOR-C: a link synced BEFORE the listing and absent from it is still archived", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const { event } = await insertLocalLinkedEvent(connectionId);
      await db
        .update(eventExternalLinks)
        .set({
          googleEventId: "g-gone",
          syncStatus: "synced",
          updatedAt: new Date(Date.now() - 60_000),
        })
        .where(eq(eventExternalLinks.eventId, event.id));
      const client = createFakeGoogleCalendarClient({
        listEventsQueues: { [GOOGLE_CALENDAR_ID]: [{ items: [], nextSyncToken: "t" }] },
      });
      await runSync(db, client, calendarId, connectionId);
      const [row] = await db.select().from(events);
      expect(row?.archivedAt).not.toBeNull();
      expect(await db.select().from(eventExternalLinks)).toHaveLength(0);
    });

    it("MAJOR-D: a local all-day daily series (Dec 28-31, Chicago) pushed and echoed back through apply_remote still expands to 4 instances with its zones untouched", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const { event } = await insertLocalLinkedEvent(connectionId, {
        allDay: true,
        startsAt: null,
        endsAt: null,
        startDate: "2026-12-28",
        endDate: "2026-12-28",
        timezone: "America/Chicago",
        recurrenceTimezone: "America/Chicago",
        rrule: "FREQ=DAILY",
        recurrenceUntil: new Date("2026-12-31T23:59:59.999-06:00"),
      });
      const countInstances = async () => {
        const [row] = await db.select().from(events).where(eq(events.id, event.id));
        const rule = buildEventRecurrenceRule(row!);
        expect(rule).not.toBeNull();
        return expandRecurrenceInRange(
          rule!,
          new Date("2026-12-01T00:00:00Z"),
          new Date("2027-01-31T00:00:00Z"),
        ).length;
      };
      expect(await countInstances()).toBe(4);

      const client = createFakeGoogleCalendarClient();
      await createCalendarPushEventHandler(db, client)([fakeJob(event.id)]);
      const [remote] = [...client.remoteEvents.values()];
      expect(remote?.recurrence).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261231"]);
      expect(remote?.start).toEqual({ date: "2026-12-28" }); // no timeZone, as Google sends

      // The echo, made strictly newer so decideConflict applies it.
      client.enqueueListEventsResponse(GOOGLE_CALENDAR_ID, {
        items: [{ ...remote!, updated: new Date(Date.now() + 60_000).toISOString() }],
        nextSyncToken: "t",
      });
      await runSync(db, client, calendarId, connectionId);

      const [after] = await db.select().from(events).where(eq(events.id, event.id));
      expect((await readLink(event.id))!.syncStatus).toBe("synced");
      expect(after?.timezone).toBe("America/Chicago");
      expect(after?.recurrenceTimezone).toBe("America/Chicago");
      expect(after?.recurrenceUntil?.toISOString()).toBe("2027-01-01T05:59:59.999Z");
      expect(await countInstances()).toBe(4);
    });

    it("MINOR-6: a detached child delivered by Google inherits its parent's origin (local parent -> local child)", async () => {
      const connectionId = await insertConnection(db);
      const calendarId = await insertCalendar(db, connectionId);
      const { event: parent } = await insertLocalLinkedEvent(connectionId, {
        rrule: "FREQ=WEEKLY",
        recurrenceTimezone: "America/Chicago",
      });
      await db
        .update(eventExternalLinks)
        .set({ googleEventId: "g-local-master", syncStatus: "synced" })
        .where(eq(eventExternalLinks.eventId, parent.id));
      const instanceEvent: GoogleCalendarEvent = {
        id: "g-local-instance",
        status: "confirmed",
        summary: "Moved by a guest",
        start: { dateTime: "2026-09-14T10:00:00-05:00", timeZone: "America/Chicago" },
        end: { dateTime: "2026-09-14T10:30:00-05:00", timeZone: "America/Chicago" },
        recurringEventId: "g-local-master",
        originalStartTime: { dateTime: "2026-09-14T09:00:00-05:00", timeZone: "America/Chicago" },
        etag: '"etag-instance"',
        updated: "2026-08-02T00:00:00.000Z",
        iCalUID: "ical-instance@google.com",
      };
      const client = createFakeGoogleCalendarClient({
        listEventsQueues: {
          [GOOGLE_CALENDAR_ID]: [{ items: [instanceEvent], nextSyncToken: "t" }],
        },
      });
      await runSync(db, client, calendarId, connectionId);
      const child = (await db.select().from(events)).find((e) => e.parentEventId === parent.id);
      expect(child).toBeDefined();
      expect(child?.origin).toBe("local");
    });

    it("MINOR-6: a CalDAV detached child inherits its parent's origin too", async () => {
      const connectionId = await insertCaldavConnection(db);
      const calendarId = await insertCaldavCalendar(db, connectionId);
      const fakeClient = createFakeCalDavClient();
      const auth = { username: "testuser", password: "fake-password" };
      const href = `${CALDAV_CALENDAR_URL}local-series.ics`;
      const masterIcs = localEventToVCalendar({
        title: "Local series",
        allDay: false,
        startsAt: new Date("2026-08-21T14:00:00.000Z"),
        endsAt: new Date("2026-08-21T14:30:00.000Z"),
        timezone: "America/Chicago",
        rrule: "FREQ=WEEKLY;BYDAY=FR",
      });
      const put = await fakeClient.putEvent(href, masterIcs, undefined, auth, {
        ifNoneMatch: true,
      });
      const [parent] = await db
        .insert(events)
        .values({
          title: "Local series",
          origin: "local",
          timezone: "America/Chicago",
          startsAt: new Date("2026-08-21T14:00:00.000Z"),
          endsAt: new Date("2026-08-21T14:30:00.000Z"),
          rrule: "FREQ=WEEKLY;BYDAY=FR",
          recurrenceTimezone: "America/Chicago",
        })
        .returning();
      await db.insert(eventExternalLinks).values({
        eventId: parent!.id,
        connectionId,
        caldavCalendarUrl: CALDAV_CALENDAR_URL,
        caldavResourceUrl: href,
        caldavEtag: put.etag,
        lastSyncedLocalUpdatedAt: parent!.updatedAt,
        syncStatus: "synced",
      });
      // A guest detaches one occurrence on the server.
      const withException = applyExceptionToVCalendar(masterIcs, {
        kind: "detach",
        originalStartInstant: new Date("2026-08-28T14:00:00.000Z"),
        fields: {
          title: "Local series (moved)",
          allDay: false,
          startsAt: new Date("2026-08-28T15:00:00.000Z"),
          endsAt: new Date("2026-08-28T15:30:00.000Z"),
          timezone: "America/Chicago",
        },
      });
      await fakeClient.putEvent(href, withException, put.etag, auth);
      await runCalendarSync(
        { db, client: createFakeGoogleCalendarClient(), caldavClient: fakeClient },
        { connectionId, calendarConnectionCalendarId: calendarId },
      );
      const child = (await db.select().from(events)).find((e) => e.parentEventId === parent!.id);
      expect(child).toBeDefined();
      expect(child?.origin).toBe("local");
    });

    it("BLOCKER-2 (inbound): a CalDAV resource at a pending link's deterministic href is ADOPTED, never imported as a duplicate", async () => {
      const connectionId = await insertCaldavConnection(db);
      const calendarId = await insertCaldavCalendar(db, connectionId);
      const [eventRow] = await db
        .insert(events)
        .values({
          title: "Owner authored",
          origin: "local",
          timezone: "America/Chicago",
          startsAt: new Date("2026-08-25T14:00:00.000Z"),
          endsAt: new Date("2026-08-25T15:00:00.000Z"),
        })
        .returning();
      const [link] = await db
        .insert(eventExternalLinks)
        .values({
          eventId: eventRow!.id,
          connectionId,
          caldavCalendarUrl: CALDAV_CALENDAR_URL,
          syncStatus: "pending_push",
        })
        .returning();
      // The push's first attempt created the resource and lost the response.
      const fakeClient = createFakeCalDavClient();
      const href = desiredCaldavResourceHref(CALDAV_CALENDAR_URL, link!.id);
      const put = await fakeClient.putEvent(
        href,
        localEventToVCalendar({
          title: "Owner authored",
          allDay: false,
          startsAt: eventRow!.startsAt!,
          endsAt: eventRow!.endsAt!,
          timezone: "America/Chicago",
          uid: `${link!.id}@personal-os.local`,
        }),
        undefined,
        { username: "testuser", password: "fake-password" },
        { ifNoneMatch: true },
      );

      await runCalendarSync(
        { db, client: createFakeGoogleCalendarClient(), caldavClient: fakeClient },
        { connectionId, calendarConnectionCalendarId: calendarId },
      );

      expect(await db.select().from(events)).toHaveLength(1);
      const [after] = await db.select().from(eventExternalLinks);
      expect(after?.id).toBe(link!.id);
      expect(after?.caldavResourceUrl).toBe(href);
      expect(after?.caldavEtag).toBe(put.etag);
      expect(after?.caldavIcalUid).toBe(`${link!.id}@personal-os.local`);
      expect(after?.syncStatus).toBe("pending_push");
      expect(after?.lastSyncedLocalUpdatedAt?.getTime()).toBe(eventRow!.updatedAt.getTime());
    });
  });
});
