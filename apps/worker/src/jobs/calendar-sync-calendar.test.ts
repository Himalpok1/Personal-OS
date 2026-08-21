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
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import {
  createCalendarSyncCalendarDeadLetterHandler,
  runCalendarSync,
  type CalendarSyncCalendarJobData,
} from "./calendar-sync-calendar.js";
import { env } from "../env.js";

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
    expect(row?.lastSyncError).toContain("retries exhausted");
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
});
